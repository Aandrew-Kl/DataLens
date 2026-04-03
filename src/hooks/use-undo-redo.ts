"use client";

import { useCallback, useRef, useState } from "react";

const MAX_HISTORY = 50;

function cloneState<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function isDeepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  if (left instanceof Date && right instanceof Date) {
    return left.getTime() === right.getTime();
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return false;
    }

    return left.every((value, index) => isDeepEqual(value, right[index]));
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);

    if (leftKeys.length !== rightKeys.length) {
      return false;
    }

    return leftKeys.every((key) => isDeepEqual(left[key], right[key]));
  }

  return false;
}

export function useUndoRedo<T>(initialState: T): {
  state: T;
  setState: (value: T) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
} {
  const [state, setCurrentState] = useState<T>(() => cloneState(initialState));
  const historyRef = useRef<T[]>([]);
  const futureRef = useRef<T[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const setState = useCallback((value: T) => {
    setCurrentState((current) => {
      if (isDeepEqual(current, value)) {
        return current;
      }

      const nextHistory = [...historyRef.current, cloneState(current)].slice(-MAX_HISTORY);
      historyRef.current = nextHistory;
      futureRef.current = [];
      setCanUndo(nextHistory.length > 0);
      setCanRedo(false);
      return cloneState(value);
    });
  }, []);

  const undo = useCallback(() => {
    setCurrentState((current) => {
      const previous = historyRef.current.at(-1);
      if (typeof previous === "undefined") {
        return current;
      }

      historyRef.current = historyRef.current.slice(0, -1);
      futureRef.current = [cloneState(current), ...futureRef.current].slice(0, MAX_HISTORY);
      setCanUndo(historyRef.current.length > 0);
      setCanRedo(futureRef.current.length > 0);
      return cloneState(previous);
    });
  }, []);

  const redo = useCallback(() => {
    setCurrentState((current) => {
      const [next, ...remainingFuture] = futureRef.current;
      if (typeof next === "undefined") {
        return current;
      }

      historyRef.current = [...historyRef.current, cloneState(current)].slice(-MAX_HISTORY);
      futureRef.current = remainingFuture;
      setCanUndo(historyRef.current.length > 0);
      setCanRedo(futureRef.current.length > 0);
      return cloneState(next);
    });
  }, []);

  return {
    state,
    setState,
    undo,
    redo,
    canUndo,
    canRedo,
  };
}
