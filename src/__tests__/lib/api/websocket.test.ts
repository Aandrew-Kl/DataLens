import { DataLensSocket, parseProgressUpdate } from '@/lib/api/websocket';

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;


  public readyState = MockWebSocket.CONNECTING;
  public onopen: ((event?: Event) => void) | null = null;
  public onclose: ((event?: CloseEvent) => void) | null = null;
  public onmessage: ((event: MessageEvent) => void) | null = null;

  public readonly send = jest.fn();
  public readonly close = jest.fn();

  public constructor(public readonly url: string) {
    createdSockets.push(this);
  }
}

const createdSockets: MockWebSocket[] = [];
const originalWebSocket = globalThis.WebSocket;

describe('parseProgressUpdate', () => {
  it('returns null for non-object input', () => {
    expect(parseProgressUpdate(null)).toBeNull();
    expect(parseProgressUpdate('not an object')).toBeNull();
    expect(parseProgressUpdate(123)).toBeNull();
  });

  it('returns null when no percent found', () => {
    expect(parseProgressUpdate({ type: 'progress' })).toBeNull();
  });

  it('parses progress with type:"progress" and percent field', () => {
    expect(parseProgressUpdate({ type: 'progress', percent: 50 })).toEqual({
      percent: 50,
      raw: { type: 'progress', percent: 50 },
    });
  });

  it('parses nested payload.percent', () => {
    expect(
      parseProgressUpdate({ type: 'progress', payload: { percent: 25 } }),
    ).toEqual({
      percent: 25,
      raw: { percent: 25 },
    });
  });

  it('normalizes 0-1 values to 0-100', () => {
    expect(parseProgressUpdate({ type: 'progress', percent: 0.25 })).toEqual({
      percent: 25,
      raw: { type: 'progress', percent: 0.25 },
    });
  });
});

describe('DataLensSocket', () => {
  beforeEach(() => {
    createdSockets.length = 0;
    globalThis.WebSocket = MockWebSocket as unknown as typeof globalThis.WebSocket;
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    jest.clearAllMocks();
  });

  it('constructor sets url', () => {
    const socket = new DataLensSocket('ws://localhost:8000/test');

    expect((socket as unknown as { url: string }).url).toBe('ws://localhost:8000/test');
  });

  it('isConnected is false initially', () => {
    const socket = new DataLensSocket('ws://localhost:8000/test');

    expect(socket.isConnected).toBe(false);
  });

  it('disconnect sets isConnected false', () => {
    const socket = new DataLensSocket('ws://localhost:8000/test');

    socket.connect();
    const ws = createdSockets[0];

    expect(ws).toBeDefined();

    ws.readyState = MockWebSocket.OPEN;
    ws.onopen?.(new Event('open'));

    expect(socket.isConnected).toBe(true);

    socket.disconnect();

    expect(socket.isConnected).toBe(false);
  });

  it('appends both token and dataset_id to the handshake URL', () => {
    const socket = new DataLensSocket('ws://localhost:8000/test');

    socket.connect('token-123', 'dataset-456');

    expect(createdSockets[0]?.url).toBe(
      'ws://localhost:8000/test?token=token-123&dataset_id=dataset-456',
    );
  });
});
