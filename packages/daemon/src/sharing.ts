import { randomBytes, randomUUID } from 'node:crypto';
import {
  checkVersion,
  decodeViewerMessage,
  deriveInviteSecrets,
  encodeControl,
  formatInviteCode,
  generateInviteCode,
  openSignal,
  PROTOCOL_VERSION,
  ProtocolError,
  sealSignal,
  SignallingClient,
  type HostMessage,
  type IceServer,
  type InviteSecrets,
  type Participant,
  type ViewerMessage,
} from '@claude-share/protocol';
import type { ClaudeStatus, SharingState } from '@claude-share/protocol';

export type { ClaudeStatus, SharingState };
import type { StreamHub, ViewerFeed } from './stream-hub.ts';

export const MAX_VIEWERS = 20;

export interface HostSharingOptions {
  signallingUrl: string;
  hostUsername: string;
  hub: StreamHub;
  /** Public key that verifies the session's stream frames, sent to viewers in `welcome`. */
  sessionPublicKey: string;
  terminalSize(): { cols: number; rows: number };
  claudeStatus(): ClaudeStatus;
  createPeerConnection(config: RTCConfiguration): RTCPeerConnection;
  WebSocket?: typeof WebSocket;
  viewerLimit?: number;
  helloTimeoutMs?: number;
  signallingRetryDelaysMs?: number[];
  onChange?(state: SharingState): void;
}

interface Viewer {
  id: string;
  username: string;
  peerId: string;
  resumeToken: string;
  joinedAt: number;
  pc: RTCPeerConnection;
  control: RTCDataChannel;
  feed: ViewerFeed | undefined;
}

/** A viewer that left; kept so it can take its old place when it reconnects. */
interface Departed {
  id: string;
  joinedAt: number;
}

interface PendingPeer {
  pc: RTCPeerConnection;
  control: RTCDataChannel;
  stream: RTCDataChannel;
  secrets: InviteSecrets;
  helloTimer?: ReturnType<typeof setTimeout>;
  /** Connection messages are applied one at a time, in arrival order. */
  signals: Promise<void>;
}

/**
 * Shares a hosted session with viewers: invite code, signalling, one WebRTC connection per viewer
 * (control and stream channels), the viewer handshake, the participant list, and removing viewers.
 */
export class HostSharing {
  private readonly options: HostSharingOptions;
  private readonly signalling: SignallingClient;
  private readonly viewers = new Map<string, Viewer>();
  private readonly pending = new Map<string, PendingPeer>();
  private readonly departed = new Map<string, Departed>();
  private code = generateInviteCode();
  private secrets: Promise<InviteSecrets>;
  private iceServers: IceServer[] = [];
  private limit: number;
  private signallingState: SharingState['signalling'] = 'connecting';
  private closed = false;

  constructor(options: HostSharingOptions) {
    this.options = options;
    this.limit = clampLimit(options.viewerLimit ?? MAX_VIEWERS);
    this.secrets = deriveInviteSecrets(this.code);
    this.signalling = new SignallingClient({
      url: options.signallingUrl,
      ...(options.WebSocket ? { WebSocket: options.WebSocket } : {}),
      ...(options.signallingRetryDelaysMs ? { retryDelaysMs: options.signallingRetryDelaysMs } : {}),
    });
    this.signalling.onStatus((status) => {
      if (status === 'connected') void this.announce();
      else if (status === 'disconnected') this.setSignalling('unavailable');
    });
    this.signalling.onEvent((event) => {
      switch (event.type) {
        case 'hosting':
          this.iceServers = event.iceServers;
          return this.setSignalling('available');
        case 'peer-joined':
          return void this.offer(event.peerId);
        case 'peer-left':
          return this.dropPending(event.peerId);
        case 'signal':
          return this.handleSignal(event.from, event.data);
        case 'error':
          // A room id collision is practically impossible; take a new code and try again.
          if (event.reason === 'room-taken') return void this.revoke();
          return;
      }
    });
  }

  start(): void {
    this.signalling.connect();
    this.notify();
  }

  get state(): SharingState {
    return {
      inviteCode: formatInviteCode(this.code),
      signalling: this.signallingState,
      viewerLimit: this.limit,
      participants: this.participants(),
    };
  }

  /** Replaces the invite code. Viewers already in the session stay connected. */
  async revoke(): Promise<void> {
    this.code = generateInviteCode();
    this.secrets = deriveInviteSecrets(this.code);
    for (const peerId of [...this.pending.keys()]) this.dropPending(peerId);
    await this.announce();
    for (const viewer of this.viewers.values()) this.send(viewer.control, { type: 'rejoin-code', code: this.code });
    this.notify();
  }

  /** Disconnects a viewer and replaces the invite code so it cannot rejoin with the old one. */
  async remove(viewerId: string): Promise<void> {
    const viewer = this.viewers.get(viewerId);
    if (!viewer) return;
    this.viewers.delete(viewerId);
    this.send(viewer.control, { type: 'refused', reason: 'removed', message: 'The host removed you from this session.' });
    this.closeViewer(viewer, 200);
    this.signalling.send({ type: 'kick', peerId: viewer.peerId });
    this.broadcastParticipants();
    await this.revoke();
  }

  /** Sets how many viewers may be in the session (1 to 20). Viewers already in it stay. */
  setViewerLimit(limit: number): void {
    this.limit = clampLimit(limit);
    this.notify();
  }

  broadcastStatus(claude: ClaudeStatus): void {
    for (const viewer of this.viewers.values()) this.send(viewer.control, { type: 'status', claude });
  }

  broadcastResize(cols: number, rows: number): void {
    for (const viewer of this.viewers.values()) this.send(viewer.control, { type: 'resize', cols, rows });
  }

  /** Ends sharing: tells every viewer the session ended and disconnects them. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const viewer of this.viewers.values()) {
      this.send(viewer.control, { type: 'session-ended' });
      this.closeViewer(viewer, 200);
    }
    this.viewers.clear();
    for (const peerId of [...this.pending.keys()]) this.dropPending(peerId);
    this.signalling.close();
  }

  private async announce(): Promise<void> {
    const { room } = await this.secrets;
    this.signalling.send({ type: 'host', room });
  }

  private async offer(peerId: string): Promise<void> {
    if (this.closed) return;
    const secrets = await this.secrets;
    const pc = this.options.createPeerConnection({ iceServers: this.iceServers.map(toRtcIceServer) });
    const control = pc.createDataChannel('control', { ordered: true });
    const stream = pc.createDataChannel('stream', { ordered: true });
    stream.binaryType = 'arraybuffer';
    const peer: PendingPeer = { pc, control, stream, secrets, signals: Promise.resolve() };
    this.pending.set(peerId, peer);

    const signal = async (payload: unknown) => {
      const data = await sealSignal(secrets.authKey, { direction: 'host-to-viewer', peerId }, payload);
      this.signalling.send({ type: 'signal', to: peerId, data });
    };
    pc.onicecandidate = (event) => {
      if (event.candidate) void signal({ candidate: event.candidate.toJSON() });
    };
    control.onopen = () => {
      peer.helloTimer = setTimeout(() => this.dropPending(peerId), this.options.helloTimeoutMs ?? 10_000);
    };
    control.onmessage = (message) => {
      if (!this.pending.has(peerId)) return;
      clearTimeout(peer.helloTimer);
      // Check the version before validating the rest: another version may shape `hello`
      // differently, and that viewer should still learn why it cannot join.
      const version = checkVersion(PROTOCOL_VERSION, helloVersion(String(message.data)));
      if (!version.ok) {
        this.send(control, { type: 'refused', reason: version.reason, message: version.message });
        return this.dropPending(peerId, 200);
      }
      let hello: ViewerMessage;
      try {
        hello = decodeViewerMessage(String(message.data));
      } catch (error) {
        if (error instanceof ProtocolError) return this.dropPending(peerId);
        throw error;
      }
      if (hello.type !== 'hello') return this.dropPending(peerId);
      void this.admit(peerId, peer, hello);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.dropPending(peerId);
    };

    const description = await pc.createOffer();
    await pc.setLocalDescription(description);
    await signal({ description: pc.localDescription?.toJSON() ?? description });
  }

  private handleSignal(from: string, sealed: unknown): void {
    const peer = this.pending.get(from);
    if (!peer) return;
    // In order: a candidate must not be applied before the description it belongs to.
    peer.signals = peer.signals.then(async () => {
      const payload = (await openSignal(peer.secrets.authKey, { direction: 'viewer-to-host', peerId: from }, sealed)) as
        | { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }
        | undefined;
      // Not sealed with the invite code's key: not from the viewer, or tampered with on the way.
      if (!payload) return this.dropPending(from);
      try {
        if (payload.description) await peer.pc.setRemoteDescription(payload.description);
        else if (payload.candidate) await peer.pc.addIceCandidate(payload.candidate);
      } catch {
        // A connection being torn down rejects late messages; nothing to do.
      }
    });
  }

  private async admit(peerId: string, peer: PendingPeer, hello: Extract<ViewerMessage, { type: 'hello' }>): Promise<void> {
    const refuse = (message: Extract<HostMessage, { type: 'refused' }>) => {
      this.send(peer.control, message);
      this.dropPending(peerId, 200);
    };
    // A reconnecting viewer takes its old place; it does not count as a new viewer.
    const resumed = hello.resumeToken ? this.resume(hello.resumeToken) : undefined;
    if (!resumed && this.viewers.size >= this.limit) {
      return refuse({ type: 'refused', reason: 'session-full', message: 'This session is full.' });
    }

    this.pending.delete(peerId);
    const viewer: Viewer = {
      id: resumed?.id ?? randomUUID(),
      username: hello.username,
      peerId,
      resumeToken: randomBytes(24).toString('base64url'),
      joinedAt: resumed?.joinedAt ?? Date.now(),
      pc: peer.pc,
      control: peer.control,
      feed: undefined,
    };
    this.viewers.set(viewer.id, viewer);

    peer.pc.onconnectionstatechange = () => {
      if (peer.pc.connectionState === 'failed' || peer.pc.connectionState === 'closed') this.depart(viewer);
    };
    peer.control.onclose = () => this.depart(viewer);
    peer.control.onmessage = (message) => {
      let request: ViewerMessage;
      try {
        request = decodeViewerMessage(String(message.data));
      } catch {
        return;
      }
      if (request.type === 'resend') viewer.feed?.resend(request.fromOutputSeq);
      else if (request.type === 'leave') this.depart(viewer, false);
    };

    const { cols, rows } = this.options.terminalSize();
    this.send(peer.control, {
      type: 'welcome',
      protocolVersion: PROTOCOL_VERSION,
      viewerId: viewer.id,
      sessionPublicKey: this.options.sessionPublicKey,
      cols,
      rows,
      resumeToken: viewer.resumeToken,
    });
    this.send(peer.control, { type: 'rejoin-code', code: this.code });
    this.send(peer.control, { type: 'status', claude: this.options.claudeStatus() });
    this.broadcastParticipants();

    const stream = peer.stream;
    const result = await this.options.hub.attach(
      {
        send: (bytes) => {
          if (stream.readyState === 'open') trySend(stream, bytes as Uint8Array<ArrayBuffer>);
        },
        bufferedAmount: () => stream.bufferedAmount,
      },
      { lastOutputSeq: hello.lastOutputSeq, lastEventSeq: hello.lastEventSeq },
    );
    if (!result.ok) {
      this.send(peer.control, { type: 'session-ended' });
      return;
    }
    if (this.viewers.get(viewer.id) === viewer) viewer.feed = result;
    else result.detach();
  }

  /** Looks up and consumes a resume token. */
  private resume(token: string): Departed | undefined {
    for (const viewer of this.viewers.values()) {
      if (viewer.resumeToken === token) {
        // Its old connection has not been noticed as gone yet; replace it.
        this.viewers.delete(viewer.id);
        viewer.feed?.detach();
        viewer.pc.close();
        return { id: viewer.id, joinedAt: viewer.joinedAt };
      }
    }
    const departed = this.departed.get(token);
    this.departed.delete(token);
    return departed;
  }

  private depart(viewer: Viewer, canResume = true): void {
    if (this.viewers.get(viewer.id) !== viewer) return;
    this.viewers.delete(viewer.id);
    if (canResume) this.departed.set(viewer.resumeToken, { id: viewer.id, joinedAt: viewer.joinedAt });
    this.closeViewer(viewer, 0);
    this.broadcastParticipants();
  }

  private closeViewer(viewer: Viewer, delayMs: number): void {
    viewer.feed?.detach();
    // A short delay lets a final message (removed, session ended) reach the viewer first.
    setTimeout(() => viewer.pc.close(), delayMs);
  }

  private dropPending(peerId: string, delayMs = 0): void {
    const peer = this.pending.get(peerId);
    if (!peer) return;
    this.pending.delete(peerId);
    clearTimeout(peer.helloTimer);
    setTimeout(() => peer.pc.close(), delayMs);
  }

  private participants(): Participant[] {
    const people = [
      { id: 'host', username: this.options.hostUsername, role: 'host' as const, joinedAt: 0 },
      ...[...this.viewers.values()].map((v) => ({ id: v.id, username: v.username, role: 'viewer' as const, joinedAt: v.joinedAt })),
    ].sort((a, b) => a.joinedAt - b.joinedAt);
    return withLabels(people);
  }

  private broadcastParticipants(): void {
    const participants = this.participants();
    for (const viewer of this.viewers.values()) this.send(viewer.control, { type: 'participants', participants });
    this.notify();
  }

  private send(channel: RTCDataChannel, message: HostMessage): void {
    if (channel.readyState === 'open') trySend(channel, encodeControl(message));
  }

  private setSignalling(state: SharingState['signalling']): void {
    if (this.signallingState === state) return;
    this.signallingState = state;
    this.notify();
  }

  private notify(): void {
    this.options.onChange?.(this.state);
  }
}

/**
 * Sends on a data channel that may close at any moment: its state can still read `open` just
 * before the send fails. A lost message to a viewer that is going away does not matter.
 */
function trySend(channel: RTCDataChannel, data: string | Uint8Array<ArrayBuffer>): void {
  try {
    channel.send(data as string);
  } catch {
    // The channel closed; the connection state handlers clean up.
  }
}

/** The protocol version a viewer's first message claims, read without validating the rest. */
function helloVersion(text: string): number {
  try {
    const version = (JSON.parse(text) as { protocolVersion?: unknown } | null)?.protocolVersion;
    return typeof version === 'number' ? version : 0;
  } catch {
    return 0;
  }
}

function clampLimit(limit: number): number {
  return Math.min(MAX_VIEWERS, Math.max(1, Math.floor(limit)));
}

function toRtcIceServer(server: IceServer): RTCIceServer {
  return {
    urls: server.urls,
    ...(server.username !== undefined ? { username: server.username } : {}),
    ...(server.credential !== undefined ? { credential: server.credential } : {}),
  };
}

/** Adds a suffix to usernames that more than one participant uses, in joining order: `sam`, `sam (2)`. */
export function withLabels(people: Array<{ id: string; username: string; role: 'host' | 'viewer' }>): Participant[] {
  const counts = new Map<string, number>();
  for (const person of people) counts.set(person.username, (counts.get(person.username) ?? 0) + 1);
  const seen = new Map<string, number>();
  return people.map(({ id, username, role }) => {
    const n = (seen.get(username) ?? 0) + 1;
    seen.set(username, n);
    return { id, username, role, label: (counts.get(username) ?? 0) > 1 && n > 1 ? `${username} (${n})` : username };
  });
}
