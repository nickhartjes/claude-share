import { decodeSignallingEvent, type SignallingEvent, type SignallingRequest } from './signalling.ts';

export type SignallingStatus = 'connecting' | 'connected' | 'disconnected';

export interface SignallingClientOptions {
  url: string;
  /** WebSocket implementation; defaults to the global one (browsers, Node 22+). */
  WebSocket?: typeof WebSocket;
  /** Reconnect after the connection drops, waiting these delays in turn (the last one repeats). */
  retryDelaysMs?: number[];
}

/**
 * WebSocket connection to the signalling service. Reconnects on its own after a drop until closed;
 * owners re-announce themselves (host or join) when the status becomes `connected` again.
 */
export class SignallingClient {
  private readonly options: SignallingClientOptions;
  private readonly eventListeners = new Set<(event: SignallingEvent) => void>();
  private readonly statusListeners = new Set<(status: SignallingStatus) => void>();
  private socket: WebSocket | undefined;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  private currentStatus: SignallingStatus = 'disconnected';

  constructor(options: SignallingClientOptions) {
    this.options = options;
  }

  get status(): SignallingStatus {
    return this.currentStatus;
  }

  onEvent(listener: (event: SignallingEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onStatus(listener: (status: SignallingStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  connect(): void {
    if (this.closed || this.socket) return;
    const Impl = this.options.WebSocket ?? WebSocket;
    this.setStatus('connecting');
    const socket = new Impl(this.options.url);
    this.socket = socket;
    socket.onopen = () => {
      this.attempt = 0;
      this.setStatus('connected');
    };
    socket.onmessage = (message) => {
      if (typeof message.data !== 'string') return;
      let event: SignallingEvent;
      try {
        event = decodeSignallingEvent(message.data);
      } catch {
        return;
      }
      for (const listener of this.eventListeners) listener(event);
    };
    socket.onclose = () => {
      this.socket = undefined;
      this.setStatus('disconnected');
      if (!this.closed) this.scheduleRetry();
    };
    socket.onerror = () => socket.close();
  }

  /** Sends a request. Returns false if not connected; the owner re-sends after reconnecting. */
  send(request: SignallingRequest): boolean {
    // 1 = OPEN; compared by value because the implementation may be injected.
    if (this.socket?.readyState !== 1) return false;
    this.socket.send(JSON.stringify(request));
    return true;
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.retryTimer);
    this.socket?.close();
    this.socket = undefined;
  }

  private scheduleRetry(): void {
    const delays = this.options.retryDelaysMs ?? [1000, 2000, 5000, 10_000, 30_000];
    const delay = delays[Math.min(this.attempt, delays.length - 1)] ?? 30_000;
    this.attempt++;
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  private setStatus(status: SignallingStatus): void {
    if (status === this.currentStatus) return;
    this.currentStatus = status;
    for (const listener of this.statusListeners) listener(status);
  }
}
