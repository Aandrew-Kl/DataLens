import { act, renderHook } from "@testing-library/react";

import { useWebSocket } from "@/hooks/use-websocket";
import {
  DataLensSocket,
  type ProgressUpdate,
  type SocketMessage,
} from "@/lib/api/websocket";

jest.mock("@/lib/api/websocket", () => ({
  DataLensSocket: jest.fn(),
}));

interface MockSocketInstance {
  url: string;
  connect: jest.Mock<void, [string | undefined]>;
  disconnect: jest.Mock<void, []>;
  send: jest.Mock<void, [unknown]>;
  onMessage: jest.Mock<void, [(message: SocketMessage) => void]>;
  onProgress: jest.Mock<void, [(update: ProgressUpdate) => void]>;
  onConnectionStateChange: jest.Mock<void, [(connected: boolean) => void]>;
  messageHandler?: (message: SocketMessage) => void;
  progressHandler?: (update: ProgressUpdate) => void;
  connectionHandler?: (connected: boolean) => void;
}

const DEFAULT_URL = "ws://localhost:8000/ws/data-stream";
const originalLocalStorage = window.localStorage;

function createSocketInstance(url: string): MockSocketInstance {
  const instance: MockSocketInstance = {
    url,
    connect: jest.fn(),
    disconnect: jest.fn(),
    send: jest.fn(),
    onMessage: jest.fn((callback: (message: SocketMessage) => void) => {
      instance.messageHandler = callback;
    }),
    onProgress: jest.fn((callback: (update: ProgressUpdate) => void) => {
      instance.progressHandler = callback;
    }),
    onConnectionStateChange: jest.fn((callback: (connected: boolean) => void) => {
      instance.connectionHandler = callback;
    }),
  };

  return instance;
}

describe("useWebSocket", () => {
  let storageState: Record<string, string>;
  let getItemMock: jest.Mock<string | null, [string]>;
  let socketInstances: MockSocketInstance[];

  beforeEach(() => {
    storageState = {};
    getItemMock = jest.fn((key: string) => storageState[key] ?? null);
    socketInstances = [];

    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: jest.fn(() => {
          storageState = {};
        }),
        getItem: getItemMock,
        key: jest.fn((index: number) => Object.keys(storageState)[index] ?? null),
        get length() {
          return Object.keys(storageState).length;
        },
        removeItem: jest.fn((key: string) => {
          delete storageState[key];
        }),
        setItem: jest.fn((key: string, value: string) => {
          storageState[key] = value;
        }),
      } as unknown as Storage,
    });

    const mockedSocket = DataLensSocket as jest.MockedClass<typeof DataLensSocket>;
    mockedSocket.mockReset();
    mockedSocket.mockImplementation((url = DEFAULT_URL) => {
      const instance = createSocketInstance(url);
      socketInstances.push(instance);
      return instance as unknown as DataLensSocket;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: originalLocalStorage,
    });
  });

  function getLatestSocket(): MockSocketInstance {
    const latestSocket = socketInstances.at(-1);
    if (!latestSocket) {
      throw new Error("Expected a socket instance to be created.");
    }

    return latestSocket;
  }

  it("creates the default socket and connects with the stored token", () => {
    storageState.datalens_token = "token-123";

    renderHook(() => useWebSocket());

    expect(DataLensSocket).toHaveBeenCalledWith(DEFAULT_URL);
    expect(getItemMock).toHaveBeenCalledWith("datalens_token");
    expect(getLatestSocket().connect).toHaveBeenCalledWith("token-123");
  });

  it("uses a custom URL and connects without a token when none is stored", () => {
    renderHook(() => useWebSocket("ws://example.test/socket"));

    expect(DataLensSocket).toHaveBeenCalledWith("ws://example.test/socket");
    expect(getLatestSocket().connect).toHaveBeenCalledWith(undefined);
  });

  it("updates connection, message, and progress state from socket callbacks", () => {
    const { result } = renderHook(() => useWebSocket());
    const socket = getLatestSocket();
    const message: SocketMessage = { type: "done", payload: { rows: 4 } };
    const progress: ProgressUpdate = {
      percent: 75,
      label: "Loading",
      stage: "transform",
    };

    act(() => {
      socket.connectionHandler?.(true);
      socket.messageHandler?.(message);
      socket.progressHandler?.(progress);
    });

    expect(result.current.isConnected).toBe(true);
    expect(result.current.lastMessage).toEqual(message);
    expect(result.current.progress).toEqual(progress);
  });

  it("delegates sendMessage to the active socket instance", () => {
    const { result } = renderHook(() => useWebSocket());
    const payload = { event: "ping", attempt: 1 };

    act(() => {
      result.current.sendMessage(payload);
    });

    expect(getLatestSocket().send).toHaveBeenCalledWith(payload);
  });

  it("disconnects the previous socket and reconnects when the URL changes", () => {
    const { result, rerender } = renderHook(
      ({ url }) => useWebSocket(url),
      {
        initialProps: { url: "ws://example.test/one" },
      },
    );
    const firstSocket = getLatestSocket();

    act(() => {
      firstSocket.connectionHandler?.(true);
      firstSocket.messageHandler?.({ type: "first" });
    });

    rerender({ url: "ws://example.test/two" });

    expect(firstSocket.disconnect).toHaveBeenCalledTimes(1);
    expect(DataLensSocket).toHaveBeenNthCalledWith(2, "ws://example.test/two");
    expect(result.current.isConnected).toBe(false);
    expect(result.current.lastMessage).toBeNull();
  });

  it("disconnects the socket when the hook unmounts", () => {
    const { unmount } = renderHook(() => useWebSocket());
    const socket = getLatestSocket();

    unmount();

    expect(socket.disconnect).toHaveBeenCalledTimes(1);
  });
});
