import { renderHook } from '@testing-library/react';

import {
  type ProgressUpdate,
  type SocketMessage,
} from '@/lib/api/websocket';
import { DataLensSocket } from '@/lib/api/websocket';
import { useWebSocket } from '@/hooks/use-websocket';

jest.mock('@/lib/api/websocket', () => {
  const actual = jest.requireActual('@/lib/api/websocket');

  return {
    ...actual,
    DataLensSocket: jest.fn(),
  };
});

describe('useWebSocket', () => {
  let mockInstance: {
    connect: jest.Mock;
    disconnect: jest.Mock;
    send: jest.Mock;
    onMessage: jest.Mock;
    onProgress: jest.Mock;
    onConnectionStateChange: jest.Mock;
  };

  beforeEach(() => {
    const mockedConstructor = DataLensSocket as jest.Mock;
    mockInstance = {
      connect: jest.fn(),
      disconnect: jest.fn(),
      send: jest.fn(),
      onMessage: jest.fn((callback: (message: SocketMessage) => void) => {
        void callback;
      }),
      onProgress: jest.fn((callback: (nextProgress: ProgressUpdate) => void) => {
        void callback;
      }),
      onConnectionStateChange: jest.fn((callback: (connected: boolean) => void) => {
        void callback;
      }),
    };

    mockedConstructor.mockReset();
    mockedConstructor.mockImplementation(() => mockInstance);
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('returns isConnected false initially', () => {
    const { result } = renderHook(() => useWebSocket());

    expect(result.current.isConnected).toBe(false);
  });

  it('calls socket.connect on mount', () => {
    renderHook(() => useWebSocket());

    expect(mockInstance.connect).toHaveBeenCalledTimes(1);
  });

  it('calls socket.disconnect on unmount', () => {
    const { unmount } = renderHook(() => useWebSocket());

    expect(mockInstance.disconnect).not.toHaveBeenCalled();

    unmount();

    expect(mockInstance.disconnect).toHaveBeenCalledTimes(1);
  });

  it('sendMessage calls socket.send', () => {
    const { result } = renderHook(() => useWebSocket());
    const payload = { event: 'ping' };

    result.current.sendMessage(payload);

    expect(mockInstance.send).toHaveBeenCalledWith(payload);
  });
});
