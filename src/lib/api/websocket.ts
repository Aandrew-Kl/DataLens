export interface ProgressUpdate {
  percent: number;
  label?: string;
  stage?: string;
  total?: number;
  raw?: Record<string, unknown>;
}

export type SocketMessage = unknown;
export type SocketMessageHandler = (message: SocketMessage) => void;
export type ProgressHandler = (update: ProgressUpdate) => void;
export type ConnectionStateHandler = (connected: boolean) => void;

const DEFAULT_WEBSOCKET_URL =
  process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000/ws/data-stream";
const BASE_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 15_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function normalizePercent(value: unknown): number | null {
  const numeric = asNumber(value);
  if (numeric === null) {
    return null;
  }

  if (numeric >= 0 && numeric <= 1) {
    return clampPercent(numeric * 100);
  }

  if (numeric > 100) {
    return clampPercent(numeric);
  }

  return clampPercent(numeric);
}

export function parseProgressUpdate(message: unknown): ProgressUpdate | null {
  const record = asRecord(message);
  if (!record) {
    return null;
  }

  const payload: Record<string, unknown> =
    asRecord(record.payload) ?? record;
  const eventType =
    asString(record.type) ??
    asString(record.event) ??
    asString(record.kind) ??
    asString(record.name);

  const kind = eventType?.toLowerCase();
  if (
    kind !== "progress" &&
    kind !== "profiling" &&
    kind !== "profile" &&
    kind !== "update"
  ) {
    if (!(("progress" in payload) || ("value" in payload) || ("percent" in payload))) {
      return null;
    }
  }

  const percent = normalizePercent(
    (payload.percent ?? payload.progress ?? payload.pct ?? payload.value) as unknown,
  );

  if (percent === null) {
    return null;
  }

  const label = asString(payload.label) ?? asString(payload.message) ?? asString(payload.status);
  const stage = asString(payload.stage) ?? asString(payload.phase);
  const total = asNumber(payload.total) ?? undefined;

  return {
    percent,
    label: label ?? undefined,
    stage: stage ?? undefined,
    total,
    raw: payload,
  };
}

export class DataLensSocket {
  private socket: WebSocket | null = null;
  private reconnectTimerId: number | null = null;
  private reconnectAttempts = 0;
  private shouldReconnect = true;
  private isManualDisconnect = false;
  private lastToken: string | null = null;
  private lastDatasetId: string | null = null;
  private _isConnected = false;

  private readonly url: string;
  private readonly messageHandlers = new Set<SocketMessageHandler>();
  private readonly progressHandlers = new Set<ProgressHandler>();
  private readonly connectionHandlers = new Set<ConnectionStateHandler>();

  public get isConnected(): boolean {
    return this._isConnected;
  }

  public constructor(url = DEFAULT_WEBSOCKET_URL) {
    this.url = url;
  }

  public connect(token?: string, datasetId?: string): void {
    if (typeof window === "undefined") {
      return;
    }

    if (typeof token === "string" && token.length > 0) {
      this.lastToken = token;
    }
    if (typeof datasetId === "string" && datasetId.length > 0) {
      this.lastDatasetId = datasetId;
    }

    this.shouldReconnect = true;
    this.isManualDisconnect = false;

    if (this.socket) {
      const state = this.socket.readyState;
      if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) {
        return;
      }

      this.detachSocket(this.socket);
      this.socket = null;
    }

    this.clearReconnectTimer();
    const ws = new WebSocket(this.urlWithConnectionParams());
    this.socket = ws;
    this.bindSocket(ws);
  }

  public onMessage(callback: SocketMessageHandler): void {
    this.messageHandlers.add(callback);
  }

  public onProgress(callback: ProgressHandler): void {
    this.progressHandlers.add(callback);
  }

  public onConnectionStateChange(callback: ConnectionStateHandler): void {
    this.connectionHandlers.add(callback);
  }

  public send(data: unknown): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const payload = this.toJsonString(data);
    if (payload === null) {
      return;
    }

    this.socket.send(payload);
  }

  public disconnect(): void {
    this.shouldReconnect = false;
    this.isManualDisconnect = true;
    this.clearReconnectTimer();

    if (this.socket) {
      if (
        this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING
      ) {
        this.socket.close(1000, "Client disconnect");
      }

      this.detachSocket(this.socket);
      this.socket = null;
    }

    this.setConnected(false);
  }

  private bindSocket(socket: WebSocket): void {
    socket.onopen = () => {
      this.reconnectAttempts = 0;
      this.setConnected(true);
    };

    socket.onmessage = (event) => {
      const message = this.parseIncoming(event.data);
      for (const handler of this.messageHandlers) {
        handler(message);
      }

      const progress = parseProgressUpdate(message);
      if (progress) {
        for (const handler of this.progressHandlers) {
          handler(progress);
        }
      }
    };

    socket.onerror = () => {
      // Reconnection and state transitions are handled by the close event.
    };

    socket.onclose = () => {
      this.setConnected(false);
      this.detachSocket(socket);

      if (this.shouldReconnect && !this.isManualDisconnect) {
        this.scheduleReconnect();
      }
    };
  }

  private detachSocket(socket: WebSocket): void {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) {
      return;
    }

    const delay = Math.min(
      MAX_RETRY_DELAY_MS,
      BASE_RETRY_DELAY_MS * Math.pow(2, this.reconnectAttempts),
    );

    this.reconnectAttempts = this.reconnectAttempts + 1;
    this.clearReconnectTimer();

    this.reconnectTimerId = window.setTimeout(() => {
      if (!this.shouldReconnect || this.isManualDisconnect) {
        return;
      }
      this.connect(this.lastToken ?? undefined, this.lastDatasetId ?? undefined);
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimerId !== null) {
      window.clearTimeout(this.reconnectTimerId);
      this.reconnectTimerId = null;
    }
  }

  private parseIncoming(payload: MessageEvent<
    string | Blob | ArrayBuffer | SharedArrayBuffer
  >["data"]): SocketMessage {
    if (typeof payload === "string") {
      const text = payload.trim();
      if (text.length === 0) {
        return text;
      }

      const first = text.charAt(0);
      if (first !== "{" && first !== "[") {
        return text;
      }

      try {
        return JSON.parse(text) as SocketMessage;
      } catch {
        return text;
      }
    }

    return payload;
  }

  private toJsonString(value: unknown): string | null {
    try {
      const payload = JSON.stringify(value);
      return typeof payload === "string" ? payload : null;
    } catch {
      return null;
    }
  }

  private setConnected(connected: boolean): void {
    if (this._isConnected === connected) {
      return;
    }

    this._isConnected = connected;
    for (const handler of this.connectionHandlers) {
      handler(connected);
    }
  }

  private urlWithConnectionParams(): string {
    const search = new URLSearchParams();

    if (this.lastToken) {
      search.set("token", this.lastToken);
    }

    if (this.lastDatasetId) {
      search.set("dataset_id", this.lastDatasetId);
    }

    if (search.toString().length === 0) {
      return this.url;
    }

    const separator = this.url.includes("?") ? "&" : "?";
    return `${this.url}${separator}${search.toString()}`;
  }
}
