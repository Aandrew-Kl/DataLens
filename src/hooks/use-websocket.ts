"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DataLensSocket,
  type ProgressUpdate,
  type SocketMessage,
} from "@/lib/api/websocket";

const DEFAULT_WEBSOCKET_URL =
  process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000/ws/data-stream";

export interface UseWebSocketResult {
  isConnected: boolean;
  lastMessage: SocketMessage | null;
  sendMessage: (data: unknown) => void;
  progress: ProgressUpdate | null;
}

export function useWebSocket(url = DEFAULT_WEBSOCKET_URL): UseWebSocketResult {
  const socketRef = useRef<DataLensSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<SocketMessage | null>(null);
  const [progress, setProgress] = useState<ProgressUpdate | null>(null);

  useEffect(() => {
    const socket = new DataLensSocket(url);
    socketRef.current = socket;

    socket.onMessage((message) => {
      setLastMessage(message);
    });

    socket.onProgress((nextProgress) => {
      setProgress(nextProgress);
    });

    socket.onConnectionStateChange((connected) => {
      setIsConnected(connected);
    });

    const token =
      typeof window === "undefined"
        ? undefined
        : window.localStorage.getItem("datalens_token") ?? undefined;

    socket.connect(token);

    return () => {
      socket.disconnect();
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
      setIsConnected(false);
      setLastMessage(null);
    };
  }, [url]);

  const sendMessage = useCallback((data: unknown) => {
    socketRef.current?.send(data);
  }, []);

  return {
    isConnected,
    lastMessage,
    sendMessage,
    progress,
  };
}
