"use client";

import { useId, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

export interface UseKeyboardNavigationOptions {
  rows: number;
  cols: number;
  onSelect?: (row: number, col: number) => void;
  onEscape?: () => void;
  wrap?: boolean;
}

export interface UseKeyboardNavigationResult {
  activeRow: number;
  activeCol: number;
  setActive: (row: number, col: number) => void;
  containerProps: {
    tabIndex: number;
    role: string;
    onKeyDown: (e: ReactKeyboardEvent) => void;
    "aria-activedescendant": string;
  };
  getCellProps: (row: number, col: number) => {
    id: string;
    role: string;
    "aria-selected": boolean;
    tabIndex: number;
  };
}

interface GridPosition {
  col: number;
  row: number;
}

const EMPTY_POSITION: GridPosition = {
  row: -1,
  col: -1,
};

function hasCells(rows: number, cols: number): boolean {
  return rows > 0 && cols > 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizePosition(position: GridPosition, rows: number, cols: number): GridPosition {
  if (!hasCells(rows, cols)) {
    return EMPTY_POSITION;
  }

  return {
    row: clamp(position.row, 0, rows - 1),
    col: clamp(position.col, 0, cols - 1),
  };
}

function wrapValue(value: number, max: number): number {
  if (max <= 0) {
    return 0;
  }

  const remainder = value % max;
  return remainder < 0 ? remainder + max : remainder;
}

function getCellId(gridId: string, row: number, col: number): string {
  return `${gridId}-cell-${row}-${col}`;
}

export function useKeyboardNavigation(
  options: UseKeyboardNavigationOptions,
): UseKeyboardNavigationResult {
  const { rows, cols, onSelect, onEscape, wrap = false } = options;
  const gridId = useId();
  const [position, setPosition] = useState<GridPosition>(() =>
    hasCells(rows, cols) ? { row: 0, col: 0 } : EMPTY_POSITION,
  );

  const activePosition = normalizePosition(position, rows, cols);

  const setActive = (row: number, col: number): void => {
    setPosition(normalizePosition({ row, col }, rows, cols));
  };

  const moveTo = (row: number, col: number): void => {
    if (!hasCells(rows, cols)) {
      return;
    }

    if (wrap) {
      setPosition({
        row: wrapValue(row, rows),
        col: wrapValue(col, cols),
      });
      return;
    }

    setPosition(
      normalizePosition(
        {
          row,
          col,
        },
        rows,
        cols,
      ),
    );
  };

  const onKeyDown = (event: ReactKeyboardEvent): void => {
    if (!hasCells(rows, cols)) {
      return;
    }

    const { row, col } = activePosition;

    switch (event.key) {
      case "ArrowUp":
        event.preventDefault();
        moveTo(row - 1, col);
        break;
      case "ArrowDown":
        event.preventDefault();
        moveTo(row + 1, col);
        break;
      case "ArrowLeft":
        event.preventDefault();
        moveTo(row, col - 1);
        break;
      case "ArrowRight":
        event.preventDefault();
        moveTo(row, col + 1);
        break;
      case "Home":
        event.preventDefault();
        moveTo(row, 0);
        break;
      case "End":
        event.preventDefault();
        moveTo(row, cols - 1);
        break;
      case "Enter":
      case " ":
      case "Spacebar":
        event.preventDefault();
        onSelect?.(row, col);
        break;
      case "Escape":
        event.preventDefault();
        onEscape?.();
        break;
      default:
        break;
    }
  };

  return {
    activeRow: activePosition.row,
    activeCol: activePosition.col,
    setActive,
    containerProps: {
      tabIndex: hasCells(rows, cols) ? 0 : -1,
      role: "grid",
      onKeyDown,
      "aria-activedescendant":
        activePosition.row >= 0 && activePosition.col >= 0
          ? getCellId(gridId, activePosition.row, activePosition.col)
          : "",
    },
    getCellProps: (row: number, col: number) => ({
      id: getCellId(gridId, row, col),
      role: "gridcell",
      "aria-selected": activePosition.row === row && activePosition.col === col,
      tabIndex: -1,
    }),
  };
}
