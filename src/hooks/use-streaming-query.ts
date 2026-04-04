"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DataLensSocket,
  parseProgressUpdate,
  type ProgressUpdate,
  type SocketMessage,
} from "@/lib/api/websocket";

export type StreamingQueryRow = Record<string, unknown>;

export interface UseStreamingQueryState {
  rows: StreamingQueryRow[];
  isStreaming: boolean;
  progress: ProgressUpdate | null;
  error: string | null;
  isConnected: boolean;
  execute: (query: string) => void;
}

const DEFAULT_WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000/ws/data-stream";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function getMessageKind(payload: Record<string, unknown>): string {
  return (
    asString(payload.type) ??
    asString(payload.event) ??
    asString(payload.kind) ??
    asString(payload.name) ??
    ""
  ).toLowerCase();
}

function asRows(value: unknown): StreamingQueryRow[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const rows: StreamingQueryRow[] = [];
  for (const item of value) {
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      rows.push(item as Record<string, unknown>);
    }
  }

  return rows;
}

function readRows(payload: Record<string, unknown>): StreamingQueryRow[] | null {
  const kind = getMessageKind(payload);
  if (kind === "row" || kind === "record") {
    const directRow = payload.row;
    if (directRow !== null && typeof directRow === "object" && !Array.isArray(directRow)) {
      return [directRow as Record<string, unknown>];
    }
  }

  if (kind === "rows" || kind === "result" || kind === "results" || kind === "batch") {
    const rowList = payload.rows;
    const directRows = asRows(rowList);
    if (directRows) {
      return directRows;
    }
  }

  const dataRows = asRows(payload.data);
  if (dataRows) {
    return dataRows;
  }

  const payloadRows = asRows(payload.payload);
  if (payloadRows) {
    return payloadRows;
  }

  const containsOnlyMeta =
    payload.type !== undefined ||
    payload.event !== undefined ||
    payload.progress !== undefined ||
    payload.percent !== undefined ||
    payload.error !== undefined;

  if (containsOnlyMeta) {
    return null;
  }

  return [payload];
}

function readError(payload: Record<string, unknown>): string | null {
  const kind = getMessageKind(payload);

  if (kind !== "error" && kind !== "failure" && kind !== "failed") {
    if (asBoolean(payload.failed) || asBoolean(payload.error)) {
      return "Query execution failed.";
    }
    return null;
  }

  const errorMessage =
    asString(payload.error) ??
    asString(payload.message) ??
    asString(payload.detail) ??
    asString(payload.reason);

  if (errorMessage) {
    return errorMessage;
  }

  return "Query execution failed.";
}

function isDone(payload: Record<string, unknown>): boolean {
  const kind = getMessageKind(payload);
  if (kind === "complete" || kind === "completed" || kind === "done" || kind === "end") {
    return true;
  }

  if (asBoolean(payload.done)) {
    return true;
  }

  const status = asString(payload.status);
  if (!status) {
    return false;
  }

  return status.toLowerCase() === "done" || status.toLowerCase() === "complete";
}

/**
 * Hook that connects to the backend WebSocket and streams query results row by row.
 *
 * All state transitions happen inside event callbacks (not synchronously in
 * useEffect bodies) so they comply with the React 19 rules-of-hooks.
 */
export function useStreamingQuery(url = DEFAULT_WS_URL): UseStreamingQueryState {
  const socketRef = useRef<DataLensSocket | null>(null);
  const activeRef = useRef(false);

  const [rows, setRows] = useState<StreamingQueryRow[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [progress, setProgress] = useState<ProgressUpdate | null>(null);

  // Wire up socket once; all setState calls happen in the *callbacks* registered
  // on the socket, not in the effect body itself.
  useEffect(() => {
    const socket = new DataLensSocket(url);
    socketRef.current = socket;

    socket.onConnectionStateChange((connected) => {
      setIsConnected(connected);
    });

    socket.onProgress((update) => {
      if (activeRef.current) {
        setProgress(update);
      }
    });

    socket.onMessage((message: SocketMessage) => {
      if (!activeRef.current) {
        return;
      }

      const record = asRecord(message);
      if (!record) {
        return;
      }

      const error = readError(record);
      if (error) {
        setQueryError(error);
        setIsStreaming(false);
        activeRef.current = false;
        return;
      }

      if (isDone(record)) {
        setIsStreaming(false);
        activeRef.current = false;
        return;
      }

      const progressUpdate = parseProgressUpdate(message);
      if (progressUpdate) {
        setProgress(progressUpdate);
      }

      const nextRows = readRows(record);
      if (nextRows && nextRows.length > 0) {
        setRows((current) => [...current, ...nextRows]);
      }
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
    };
  }, [url]);

  const execute = useCallback(
    (query: string) => {
      const sql = query.trim();
      if (!sql) {
        setQueryError("Cannot execute empty query.");
        setIsStreaming(false);
        activeRef.current = false;
        return;
      }

      if (!isConnected) {
        setQueryError("WebSocket is not connected yet. Reconnecting...");
        return;
      }

      setRows([]);
      setQueryError(null);
      setProgress(null);
      setIsStreaming(true);
      activeRef.current = true;

      socketRef.current?.send({
        type: "query",
        query: sql,
      });
    },
    [isConnected],
  );

  return {
    rows,
    isStreaming,
    progress,
    error: queryError,
    isConnected,
    execute,
  };
}
