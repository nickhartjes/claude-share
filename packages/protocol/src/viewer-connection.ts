import { decodeHostMessage, encodeControl, type HostMessage, type Participant, type ViewerMessage } from './control.ts';
import { ProtocolError } from './errors.ts';
import { deriveInviteSecrets, parseInviteCode, type InviteSecrets } from './invite.ts';
import { openSignal, sealSignal } from './signal-auth.ts';
import type { IceServer } from './signalling.ts';
import { SignallingClient } from './signalling-client.ts';
import { createVerifier } from './signing.ts';
import { StreamReader, type TerminalSink } from './stream-reader.ts';
import type { TimelineEvent } from './timeline.ts';
import { PROTOCOL_VERSION } from './version.ts';

// The viewer's side of a shared session: join with an invite code, receive the stream read-only, and
// reconnect on its own after a network drop. Written against the standard WebRTC and WebSocket APIs,
// so it runs in the app's renderer and, with node-datachannel's polyfill, in Node tests.

export type FailureReason =
  | 'invalid-code'
  | 'rate-limited'
  | 'session-full'
  | 'outdated'
  | 'removed'
  | 'unreachable'
  | 'connection-failed';

export type ViewerState =
  | { kind: 'connecting' }
  | { kind: 'live' }
  | { kind: 'reconnecting'; attempt: number }
  | { kind: 'ended' }
  | { kind: 'failed'; reason: FailureReason; message: string };

export type ClaudeStatus = Extract<HostMessage, { type: 'status' }>['claude'];

export interface ViewerConnectionOptions {
  signallingUrl: string;
  /** Invite code as the user typed it. */
  code: string;
  username: string;
  terminal: TerminalSink;
  createPeerConnection(config: RTCConfiguration): RTCPeerConnection;
  WebSocket?: typeof WebSocket;
  onState(state: ViewerState): void;
  onEvent?(seq: number, event: TimelineEvent): void;
  onParticipants?(participants: Participant[], self: string): void;
  onStatus?(claude: ClaudeStatus): void;
  onResize?(cols: number, rows: number): void;
  /** Delay before each reconnect attempt; reconnecting stops after the last one. */
  reconnectDelaysMs?: number[];
  /** How long to wait for the host to answer before an attempt counts as failed. */
  connectTimeoutMs?: number;
  /** For tests: pretend to speak another protocol version. */
  protocolVersion?: number;
}

const toBytes = (data: unknown): Uint8Array | undefined =>
  data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : undefined;

class AttemptFailed extends Error {
  readonly reason: FailureReason;
  constructor(reason: FailureReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

export class ViewerConnection {
  private readonly options: ViewerConnectionOptions;
  private code: string | undefined;
  private reader: StreamReader | undefined;
  private publicKey: string | undefined;
  private resumeToken: string | undefined;
  private viewerId: string | undefined;
  private pc: RTCPeerConnection | undefined;
  private control: RTCDataChannel | undefined;
  private finished = false;
  private everLive = false;
  private reconnecting = false;

  constructor(options: ViewerConnectionOptions) {
    this.options = options;
    this.code = parseInviteCode(options.code);
  }

  /** Joins the session. Resolves once the viewer is live, or with the reason it could not join. */
  async join(): Promise<ViewerState> {
    if (!this.code) return this.fail('invalid-code', 'That is not a valid invite code. Codes look like 7K2M-9QXH-4TPA.');
    this.options.onState({ kind: 'connecting' });
    try {
      await this.attempt();
      return { kind: 'live' };
    } catch (error) {
      if (!(error instanceof AttemptFailed)) throw error;
      return this.fail(error.reason, error.message);
    }
  }

  /** Leaves the session. */
  leave(): void {
    if (this.finished) return;
    this.finished = true;
    this.sendControl({ type: 'leave' });
    setTimeout(() => this.pc?.close(), 100);
  }

  private fail(reason: FailureReason, message: string): ViewerState {
    this.finished = true;
    this.pc?.close();
    const state: ViewerState = { kind: 'failed', reason, message };
    this.options.onState(state);
    return state;
  }

  private end(): void {
    if (this.finished) return;
    this.finished = true;
    this.pc?.close();
    this.options.onState({ kind: 'ended' });
  }

  /** One connection attempt: signalling, WebRTC, handshake. Resolves when welcomed. */
  private attempt(): Promise<void> {
    const secretsPromise = deriveInviteSecrets(this.code!);
    const signalling = new SignallingClient({
      url: this.options.signallingUrl,
      ...(this.options.WebSocket ? { WebSocket: this.options.WebSocket } : {}),
      retryDelaysMs: [60_000],
    });

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(
        () => finish(new AttemptFailed('connection-failed', 'Could not connect to the host. Check your network and try again.')),
        this.options.connectTimeoutMs ?? 30_000,
      );
      const finish = (error?: AttemptFailed) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // Signalling is only needed to set up the connection.
        signalling.close();
        if (error) {
          pc?.close();
          reject(error);
        } else resolve();
      };

      let secrets: InviteSecrets | undefined;
      let peerId: string | undefined;
      let pc: RTCPeerConnection | undefined;
      let signals: Promise<void> = Promise.resolve();
      const sendToHost = (payload: unknown) => {
        if (!secrets || !peerId) return;
        void sealSignal(secrets.authKey, { direction: 'viewer-to-host', peerId }, payload).then((data) =>
          signalling.send({ type: 'signal', to: 'host', data }),
        );
      };

      signalling.onStatus((status) => {
        if (status === 'connected') {
          void secretsPromise.then((s) => {
            secrets = s;
            signalling.send({ type: 'join', room: s.room });
          });
        } else if (status === 'disconnected' && !peerId) {
          finish(new AttemptFailed('unreachable', 'The sharing service cannot be reached. Try again in a moment.'));
        }
      });

      signalling.onEvent((event) => {
        switch (event.type) {
          case 'error':
            if (event.reason === 'unknown-room')
              return finish(new AttemptFailed('invalid-code', 'This invite code is invalid or has expired.'));
            if (event.reason === 'rate-limited') return finish(new AttemptFailed('rate-limited', event.message));
            return finish(new AttemptFailed('connection-failed', event.message));
          case 'host-left':
            return finish(new AttemptFailed('invalid-code', 'This invite code is invalid or has expired.'));
          case 'joined': {
            peerId = event.peerId;
            pc = this.createConnection(event.iceServers, sendToHost, finish);
            return;
          }
          case 'signal': {
            if (event.from !== 'host' || !pc || !secrets || !peerId) return;
            const currentPc = pc;
            const { authKey } = secrets;
            const context = { direction: 'host-to-viewer' as const, peerId };
            // In order: a candidate must not be applied before the description it belongs to.
            signals = signals.then(async () => {
              const message = (await openSignal(authKey, context, event.data)) as
                | { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }
                | undefined;
              // Not sealed with this code's key: ignore it; the host never sends unsealed messages.
              if (!message) return;
              try {
                if (message.description) {
                  await currentPc.setRemoteDescription(message.description);
                  const answer = await currentPc.createAnswer();
                  await currentPc.setLocalDescription(answer);
                  sendToHost({ description: currentPc.localDescription?.toJSON() ?? answer });
                } else if (message.candidate) {
                  await currentPc.addIceCandidate(message.candidate);
                }
              } catch {
                // A connection being torn down rejects late messages; the attempt times out or retries.
              }
            });
            return;
          }
          default:
            return;
        }
      });

      signalling.connect();
    });
  }

  /** Sets up the peer connection for one attempt; `finish` ends the attempt, successfully once welcomed. */
  private createConnection(
    iceServers: IceServer[],
    signal: (payload: unknown) => void,
    finish: (error?: AttemptFailed) => void,
  ): RTCPeerConnection {
    const pc = this.options.createPeerConnection({
      iceServers: iceServers.map((server) => ({
        urls: server.urls,
        ...(server.username !== undefined ? { username: server.username } : {}),
        ...(server.credential !== undefined ? { credential: server.credential } : {}),
      })),
    });
    this.pc?.close();
    this.pc = pc;
    // Stream frames can arrive before the welcome that creates the reader; hold them until then.
    const earlyFrames: Uint8Array[] = [];

    pc.onicecandidate = (event) => {
      if (event.candidate) signal({ candidate: event.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      if (pc !== this.pc) return;
      if (pc.connectionState === 'failed') {
        if (this.everLive) void this.reconnect();
        else finish(new AttemptFailed('connection-failed', 'Could not connect to the host. Check your network and try again.'));
      }
    };
    pc.ondatachannel = ({ channel }) => {
      if (channel.label === 'stream') {
        channel.binaryType = 'arraybuffer';
        channel.onmessage = (message) => {
          const bytes = toBytes(message.data);
          if (!bytes) return;
          if (this.reader) void this.reader.receive(bytes);
          else earlyFrames.push(bytes);
        };
        return;
      }
      if (channel.label !== 'control') return;
      this.control = channel;
      channel.onopen = () => {
        this.sendHello(channel);
      };
      channel.onclose = () => {
        if (pc === this.pc && this.everLive && !this.finished) void this.reconnect();
      };
      channel.onmessage = (message) => {
        let host: HostMessage;
        try {
          host = decodeHostMessage(String(message.data));
        } catch (error) {
          if (error instanceof ProtocolError) return;
          throw error;
        }
        void this.handleControl(host, finish, () => {
          for (const frame of earlyFrames.splice(0)) void this.reader?.receive(frame);
        });
      };
    };
    return pc;
  }

  private sendHello(channel: RTCDataChannel): void {
    const hello: ViewerMessage = {
      type: 'hello',
      protocolVersion: this.options.protocolVersion ?? PROTOCOL_VERSION,
      username: this.options.username,
      ...(this.reader?.lastOutputSeq !== undefined ? { lastOutputSeq: this.reader.lastOutputSeq } : {}),
      ...(this.reader?.lastEventSeq !== undefined ? { lastEventSeq: this.reader.lastEventSeq } : {}),
      ...(this.resumeToken ? { resumeToken: this.resumeToken } : {}),
    };
    this.control = channel;
    this.sendControl(hello);
  }

  private async handleControl(
    message: HostMessage,
    finish: (error?: AttemptFailed) => void,
    flushEarlyFrames: () => void,
  ): Promise<void> {
    switch (message.type) {
      case 'welcome': {
        // A new session key means the host started over: rebuild the reader, which then takes a snapshot.
        if (!this.reader || this.publicKey !== message.sessionPublicKey) {
          this.publicKey = message.sessionPublicKey;
          this.reader = new StreamReader(await createVerifier(message.sessionPublicKey), this.options.terminal, {
            requestResend: (fromOutputSeq) => this.sendControl({ type: 'resend', fromOutputSeq }),
            ...(this.options.onEvent ? { onEvent: this.options.onEvent } : {}),
          });
        }
        this.resumeToken = message.resumeToken;
        this.viewerId = message.viewerId;
        this.options.onResize?.(message.cols, message.rows);
        flushEarlyFrames();
        this.everLive = true;
        finish();
        this.options.onState({ kind: 'live' });
        return;
      }
      case 'refused': {
        const reason: FailureReason =
          message.reason === 'session-full'
            ? 'session-full'
            : message.reason === 'removed'
              ? 'removed'
              : message.reason === 'session-ended'
                ? 'invalid-code'
                : 'outdated';
        if (this.everLive) {
          this.fail(reason, message.message);
          return;
        }
        return finish(new AttemptFailed(reason, message.message));
      }
      case 'rejoin-code':
        this.code = parseInviteCode(message.code) ?? this.code;
        return;
      case 'participants':
        return this.options.onParticipants?.(message.participants, this.viewerId ?? '');
      case 'status':
        return this.options.onStatus?.(message.claude);
      case 'resize':
        return this.options.onResize?.(message.cols, message.rows);
      case 'session-ended':
        return this.end();
    }
  }

  private sendControl(message: ViewerMessage): void {
    if (this.control?.readyState !== 'open') return;
    try {
      this.control.send(encodeControl(message));
    } catch {
      // The channel closed between the check and the send; reconnecting takes over.
    }
  }

  /** After a network drop: try to rejoin with the latest code, resuming where the viewer left off. */
  private async reconnect(): Promise<void> {
    if (this.finished || this.reconnecting) return;
    this.reconnecting = true;
    this.pc?.close();
    const delays = this.options.reconnectDelaysMs ?? [1000, 2000, 5000, 10_000, 15_000, 30_000, 30_000, 30_000];
    for (const [i, delay] of delays.entries()) {
      if (this.finished) break;
      this.options.onState({ kind: 'reconnecting', attempt: i + 1 });
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (this.finished) break;
      try {
        await this.attempt();
        this.reconnecting = false;
        return;
      } catch (error) {
        if (!(error instanceof AttemptFailed)) throw error;
        // The room is gone: the host closed the session while this viewer was away.
        if (error.reason === 'invalid-code') {
          this.reconnecting = false;
          return this.end();
        }
        if (error.reason === 'removed' || error.reason === 'session-full' || error.reason === 'outdated') {
          this.reconnecting = false;
          this.fail(error.reason, error.message);
          return;
        }
      }
    }
    this.reconnecting = false;
    if (!this.finished) this.fail('connection-failed', 'Lost the connection to the host and could not reconnect.');
  }

}
