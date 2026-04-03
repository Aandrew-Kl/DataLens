"use client";

import { useRef, useState } from "react";
import type { CSSProperties, RefObject, UIEvent as ReactUIEvent } from "react";

export interface UseVirtualScrollOptions {
  totalItems: number;
  itemHeight: number;
  containerHeight: number;
  overscan?: number;
}

export interface UseVirtualScrollResult {
  visibleItems: { index: number; offsetTop: number }[];
  totalHeight: number;
  containerProps: {
    ref: RefObject<HTMLDivElement | null>;
    onScroll: (e: ReactUIEvent<HTMLDivElement>) => void;
    style: CSSProperties;
  };
  innerProps: {
    style: CSSProperties;
  };
  scrollToIndex: (index: number) => void;
}

const DEFAULT_OVERSCAN = 2;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getSafePositiveInteger(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.floor(value);
}

export function useVirtualScroll(
  options: UseVirtualScrollOptions,
): UseVirtualScrollResult {
  const {
    totalItems,
    itemHeight,
    containerHeight,
    overscan = DEFAULT_OVERSCAN,
  } = options;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const safeTotalItems = getSafePositiveInteger(totalItems);
  const safeItemHeight = itemHeight > 0 ? itemHeight : 1;
  const safeContainerHeight = Math.max(0, containerHeight);
  const safeOverscan = Math.max(0, Math.floor(overscan));
  const totalHeight = safeTotalItems * safeItemHeight;
  const maxScrollTop = Math.max(0, totalHeight - safeContainerHeight);
  const normalizedScrollTop = clamp(scrollTop, 0, maxScrollTop);
  const firstVisibleIndex = Math.floor(normalizedScrollTop / safeItemHeight);
  const visibleCount = Math.ceil(safeContainerHeight / safeItemHeight);
  const startIndex = clamp(firstVisibleIndex - safeOverscan, 0, safeTotalItems);
  const endIndexExclusive = clamp(
    firstVisibleIndex + visibleCount + safeOverscan,
    0,
    safeTotalItems,
  );

  const visibleItems =
    safeTotalItems === 0
      ? []
      : Array.from(
          { length: Math.max(0, endIndexExclusive - startIndex) },
          (_, offset) => {
            const index = startIndex + offset;
            return {
              index,
              offsetTop: index * safeItemHeight,
            };
          },
        );

  const onScroll = (event: ReactUIEvent<HTMLDivElement>): void => {
    setScrollTop(clamp(event.currentTarget.scrollTop, 0, maxScrollTop));
  };

  const scrollToIndex = (index: number): void => {
    if (safeTotalItems === 0) {
      setScrollTop(0);
      return;
    }

    const clampedIndex = clamp(Math.floor(index), 0, safeTotalItems - 1);
    const nextScrollTop = clamp(clampedIndex * safeItemHeight, 0, maxScrollTop);

    if (containerRef.current) {
      containerRef.current.scrollTop = nextScrollTop;
    }

    setScrollTop(nextScrollTop);
  };

  return {
    visibleItems,
    totalHeight,
    containerProps: {
      ref: containerRef,
      onScroll,
      style: {
        height: safeContainerHeight,
        overflowY: "auto",
        position: "relative",
      },
    },
    innerProps: {
      style: {
        height: totalHeight,
        position: "relative",
      },
    },
    scrollToIndex,
  };
}
