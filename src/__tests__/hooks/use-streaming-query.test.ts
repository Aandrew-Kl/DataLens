import { act, renderHook } from "@testing-library/react";

import { useStreamingQuery } from "@/hooks/use-streaming-query";
import {
  DataLensSocket,
  type ConnectionStateHandler,
  type ProgressHandler,
  type ProgressUpdate,
  type SocketMessage,
  type SocketMessageHandler,
} from "@/lib/api/websocket";

jest.mock("@/lib/api/websocket", () => {
  const actual = jest.requireActual("@/lib/api/websocket");

  return {
    ...actual,
    DataLensSocket: jest.fn(),
  };
});

interface MockSocket {
  connect: jest.Mock<void, [token?: string]>;
  disconnect: jest.Mock<void, []>;
  send: jest.Mock<void, [payload: unknown]>;
  onMessage: jest.Mock<void, [SocketMessageHandler]>;
  onProgress: jest.Mock<void, [ProgressHandler]>;
  onConnectionStateChange: jest.Mock<void, [ConnectionStateHandler]>;
  emitMessage: (message: SocketMessage) => void;
  emitProgress: (update: ProgressUpdate) => void;
  emitConnection: (connected: boolean) => void;
}

function createMockSocket(): MockSocket {
  let messageHandler: SocketMessageHandler | undefined;
  let progressHandler: ProgressHandler | undefined;
  let connectionHandler: ConnectionStateHandler | undefined;

  return {
    connect: jest.fn(),
    disconnect: jest.fn(),
    send: jest.fn(),
    onMessage: jest.fn((callback: SocketMessageHandler) => {
      messageHandler = callback;
    }),
    onProgress: jest.fn((callback: ProgressHandler) => {
      progressHandler = callback;
    }),
    onConnectionStateChange: jest.fn((callback: ConnectionStateHandler) => {
      connectionHandler = callback;
    }),
    emitMessage: (message: SocketMessage) => {
      messageHandler?.(message);
    },
    emitProgress: (update: ProgressUpdate) => {
      progressHandler?.(update);
    },
    emitConnection: (connected: boolean) => {
      connectionHandler?.(connected);
    },
  };
}

describe("useStreamingQuery", () => {
  let socket: MockSocket;

  beforeEach(() => {
    const mockedConstructor = DataLensSocket as unknown as jest.Mock;
    socket = createMockSocket();
    mockedConstructor.mockReset();
    mockedConstructor.mockImplementation(() => socket);
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("connects on mount with the stored token and disconnects on unmount", () => {
    window.localStorage.setItem("datalens_token", "secret-token");

    const { result, unmount } = renderHook(() =>
      useStreamingQuery("ws://example.test/stream"),
    );

    expect(DataLensSocket).toHaveBeenCalledWith("ws://example.test/stream");
    expect(socket.connect).toHaveBeenCalledWith("secret-token");
    expect(result.current.isConnected).toBe(false);

    unmount();

    expect(socket.disconnect).toHaveBeenCalledTimes(1);
  });

  it("rejects empty queries without sending anything", () => {
    const { result } = renderHook(() => useStreamingQuery());

    act(() => {
      result.current.execute("   ");
    });

    expect(result.current.error).toBe("Cannot execute empty query.");
    expect(result.current.isStreaming).toBe(false);
    expect(socket.send).not.toHaveBeenCalled();
  });

  it("requires an active WebSocket connection before sending a query", () => {
    const { result } = renderHook(() => useStreamingQuery());

    act(() => {
      result.current.execute("SELECT 1");
    });

    expect(result.current.error).toBe("WebSocket is not connected yet. Reconnecting...");
    expect(result.current.isStreaming).toBe(false);
    expect(socket.send).not.toHaveBeenCalled();
  });

  it("sends trimmed queries and clears prior state before a new stream begins", () => {
    const { result } = renderHook(() => useStreamingQuery());

    act(() => {
      socket.emitConnection(true);
    });

    act(() => {
      result.current.execute("SELECT 1");
      socket.emitMessage({ type: "row", row: { id: 1 } });
      socket.emitMessage({ type: "progress", progress: 0.5 });
      socket.emitMessage({ type: "error", error: "first failure" });
    });

    expect(result.current.rows).toEqual([{ id: 1 }]);
    expect(result.current.progress).toMatchObject({ percent: 50 });
    expect(result.current.error).toBe("first failure");
    expect(result.current.isStreaming).toBe(false);

    act(() => {
      result.current.execute("  SELECT 2  ");
    });

    expect(socket.send).toHaveBeenLastCalledWith({
      type: "query",
      query: "SELECT 2",
    });
    expect(result.current.rows).toEqual([]);
    expect(result.current.progress).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.isStreaming).toBe(true);
  });

  it("streams rows and progress updates from multiple WebSocket message shapes", () => {
    const { result } = renderHook(() => useStreamingQuery());

    act(() => {
      socket.emitConnection(true);
    });

    act(() => {
      result.current.execute("SELECT * FROM orders");
    });

    act(() => {
      socket.emitProgress({ percent: 25, label: "Queued" });
    });

    act(() => {
      socket.emitMessage({ type: "row", row: { id: 1 } });
    });

    act(() => {
      socket.emitMessage({ type: "rows", rows: [{ id: 2 }, { id: 3 }] });
    });

    act(() => {
      socket.emitMessage({ data: [{ id: 4 }] });
    });

    act(() => {
      socket.emitMessage({ type: "progress", progress: 0.75, stage: "streaming" });
    });

    act(() => {
      socket.emitMessage({ status: "done" });
    });

    expect(result.current.rows).toEqual([
      { id: 1 },
      { id: 2 },
      { id: 3 },
      { id: 4 },
    ]);
    expect(result.current.progress).toMatchObject({
      percent: 75,
      stage: "streaming",
    });
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("surfaces backend errors and ignores messages after the stream is no longer active", () => {
    const { result } = renderHook(() => useStreamingQuery());

    act(() => {
      socket.emitMessage({ type: "row", row: { ignored: true } });
    });

    act(() => {
      socket.emitConnection(true);
    });

    act(() => {
      result.current.execute("SELECT * FROM broken_table");
    });

    act(() => {
      socket.emitMessage({ type: "error", message: "Backend exploded" });
    });

    act(() => {
      socket.emitMessage({ type: "row", row: { ignoredAfterError: true } });
    });

    expect(result.current.rows).toEqual([]);
    expect(result.current.error).toBe("Backend exploded");
    expect(result.current.isStreaming).toBe(false);
  });
});
