"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, GripVertical } from "lucide-react";

import { clamp } from "@/lib/utils/formatters";

const GLASS_PANEL_CLASS =
  "bg-white/75 backdrop-blur-2xl dark:bg-slate-950/45 border border-white/20";
const COLLAPSED_SIZE = 8;
const DEFAULT_MIN_SIZE = 12;
const DEFAULT_MAX_SIZE = 88;

export type ResizablePanelsDirection = "horizontal" | "vertical";

export interface ResizablePanelConfig {
  id: string;
  title: string;
  children: ReactNode;
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
  collapsible?: boolean;
  collapsedSize?: number;
}

interface ResizablePanelsProps {
  panels: ResizablePanelConfig[];
  direction?: ResizablePanelsDirection;
  className?: string;
  onSizesChange?: (sizes: number[]) => void;
}

interface ActiveResize {
  index: number;
  startPosition: number;
  startSizes: number[];
}

function getPointerPosition(
  event: Pick<PointerEvent, "clientX" | "clientY" | "pageX" | "pageY">,
  horizontal: boolean,
) {
  if (horizontal) {
    return event.clientX ?? event.pageX ?? 0;
  }

  return event.clientY ?? event.pageY ?? 0;
}

function getPanelMinSize(panel: ResizablePanelConfig) {
  return clamp(panel.minSize ?? DEFAULT_MIN_SIZE, 0, 100);
}

function getPanelMaxSize(panel: ResizablePanelConfig) {
  return clamp(panel.maxSize ?? DEFAULT_MAX_SIZE, 0, 100);
}

function getCollapsedSize(panel: ResizablePanelConfig) {
  return clamp(panel.collapsedSize ?? COLLAPSED_SIZE, 0, 100);
}

function normalizeSizes(panels: ResizablePanelConfig[]) {
  if (!panels.length) {
    return [];
  }

  const rawSizes = panels.map((panel) => panel.defaultSize ?? 100 / panels.length);
  const total = rawSizes.reduce((sum, size) => sum + size, 0);

  if (total <= 0) {
    return panels.map(() => 100 / panels.length);
  }

  return rawSizes.map((size) => (size / total) * 100);
}

function distributeDelta(
  sizes: number[],
  panels: ResizablePanelConfig[],
  sourceIndex: number,
  targetSize: number,
) {
  const currentSize = sizes[sourceIndex] ?? 0;
  const delta = targetSize - currentSize;

  if (Math.abs(delta) < 0.001) {
    return sizes;
  }

  const nextSizes = [...sizes];
  nextSizes[sourceIndex] = targetSize;

  if (delta < 0) {
    const growableIndexes = nextSizes
      .map((size, index) => ({ index, size }))
      .filter(({ index }) => index !== sourceIndex)
      .map(({ index }) => index);

    if (!growableIndexes.length) {
      nextSizes[sourceIndex] = currentSize;
      return nextSizes;
    }

    const extraPerPanel = Math.abs(delta) / growableIndexes.length;
    for (const index of growableIndexes) {
      const panelMax = getPanelMaxSize(panels[index]);
      nextSizes[index] = clamp(nextSizes[index] + extraPerPanel, 0, panelMax);
    }
  } else {
    let remaining = delta;

    for (let index = 0; index < nextSizes.length; index += 1) {
      if (index === sourceIndex) {
        continue;
      }

      const panel = panels[index];
      const minSize = panel.collapsible !== false ? getCollapsedSize(panel) : getPanelMinSize(panel);
      const available = nextSizes[index] - minSize;
      const consumed = Math.min(available, remaining);
      nextSizes[index] -= consumed;
      remaining -= consumed;

      if (remaining <= 0.001) {
        break;
      }
    }

    if (remaining > 0.001) {
      nextSizes[sourceIndex] = currentSize + (delta - remaining);
    }
  }

  const total = nextSizes.reduce((sum, size) => sum + size, 0);
  if (total === 0) {
    return normalizeSizes(panels);
  }

  return nextSizes.map((size) => (size / total) * 100);
}

function DividerHandle({
  direction,
  index,
  active,
  onPointerDown,
}: {
  direction: ResizablePanelsDirection;
  index: number;
  active: boolean;
  onPointerDown: (index: number, event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const orientation = direction === "horizontal" ? "vertical" : "horizontal";

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={`relative flex shrink-0 items-center justify-center ${
        direction === "horizontal" ? "w-4" : "h-4"
      }`}
    >
      <button
        type="button"
        aria-label={`Resize divider ${index + 1}`}
        className={`group flex items-center justify-center rounded-full ${GLASS_PANEL_CLASS} text-slate-500 shadow-sm transition-colors hover:text-slate-700 dark:text-slate-300 dark:hover:text-slate-100 ${
          direction === "horizontal" ? "h-14 w-3 cursor-col-resize" : "h-3 w-14 cursor-row-resize"
        } ${active ? "ring-2 ring-cyan-400/70" : ""}`}
        onPointerDown={(event) => onPointerDown(index, event)}
      >
        <GripVertical
          className={`${direction === "horizontal" ? "h-4 w-4 rotate-0" : "h-4 w-4 rotate-90"}`}
        />
      </button>
    </div>
  );
}

function PanelHeaderButton({
  collapsed,
  direction,
  onClick,
  title,
}: {
  collapsed: boolean;
  direction: ResizablePanelsDirection;
  onClick: () => void;
  title: string;
}) {
  const Icon =
    direction === "horizontal"
      ? collapsed
        ? ChevronRight
        : ChevronLeft
      : collapsed
        ? ChevronDown
        : ChevronUp;

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-xl border border-white/20 bg-white/60 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-white dark:bg-slate-900/50 dark:text-slate-100 dark:hover:bg-slate-900"
      aria-label={`${collapsed ? "Expand" : "Collapse"} ${title} panel`}
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{collapsed ? "Expand" : "Collapse"}</span>
    </button>
  );
}

export default function ResizablePanels({
  panels,
  direction = "horizontal",
  className,
  onSizesChange,
}: ResizablePanelsProps) {
  const isHorizontal = direction === "horizontal";
  const [sizes, setSizes] = useState(() => normalizeSizes(panels));
  const [activeResize, setActiveResize] = useState<ActiveResize | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const previousExpandedSizes = useRef<Record<string, number>>({});

  const panelSizes = useMemo(() => {
    if (sizes.length === panels.length) {
      return sizes;
    }
    return normalizeSizes(panels);
  }, [panels, sizes]);

  const updateSizes = useCallback(
    (updater: number[] | ((current: number[]) => number[])) => {
      setSizes((current) => {
        const next = typeof updater === "function" ? updater(current) : updater;
        onSizesChange?.(next);
        return next;
      });
    },
    [onSizesChange],
  );

  const handleTogglePanel = useCallback(
    (index: number) => {
      updateSizes((current) => {
        const currentSize = current[index] ?? 0;
        const panel = panels[index];
        const collapsedSize = getCollapsedSize(panel);
        const isCollapsed = currentSize <= collapsedSize + 0.5;

        if (!isCollapsed) {
          previousExpandedSizes.current[panel.id] = currentSize;
          return distributeDelta(current, panels, index, collapsedSize);
        }

        const restoredSize = clamp(
          previousExpandedSizes.current[panel.id] ?? panel.defaultSize ?? 100 / panels.length,
          getPanelMinSize(panel),
          getPanelMaxSize(panel),
        );

        return distributeDelta(current, panels, index, restoredSize);
      });
    },
    [panels, updateSizes],
  );

  const handlePointerDown = useCallback(
    (index: number, event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      const startPosition = getPointerPosition(event.nativeEvent, isHorizontal);
      setActiveResize({
        index,
        startPosition,
        startSizes: panelSizes,
      });
    },
    [isHorizontal, panelSizes],
  );

  useEffect(() => {
    if (!activeResize) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const containerRect = containerRef.current?.getBoundingClientRect();
      const containerSize = isHorizontal
        ? containerRect?.width || window.innerWidth || 1
        : containerRect?.height || window.innerHeight || 1;
      const currentPosition = getPointerPosition(event, isHorizontal);
      const deltaPercent =
        ((currentPosition - activeResize.startPosition) / Math.max(containerSize, 1)) * 100;
      const leftIndex = activeResize.index;
      const rightIndex = activeResize.index + 1;
      const pairTotal =
        (activeResize.startSizes[leftIndex] ?? 0) + (activeResize.startSizes[rightIndex] ?? 0);

      const leftPanel = panels[leftIndex];
      const rightPanel = panels[rightIndex];
      const leftMin = leftPanel.collapsible !== false ? getCollapsedSize(leftPanel) : getPanelMinSize(leftPanel);
      const leftMax = getPanelMaxSize(leftPanel);
      const rightMin = rightPanel.collapsible !== false ? getCollapsedSize(rightPanel) : getPanelMinSize(rightPanel);
      const rightMax = getPanelMaxSize(rightPanel);

      let nextLeft = clamp((activeResize.startSizes[leftIndex] ?? 0) + deltaPercent, leftMin, leftMax);
      let nextRight = pairTotal - nextLeft;

      if (nextRight < rightMin) {
        nextRight = rightMin;
        nextLeft = pairTotal - rightMin;
      } else if (nextRight > rightMax) {
        nextRight = rightMax;
        nextLeft = pairTotal - rightMax;
      }

      updateSizes((current) => {
        const next = [...current];
        next[leftIndex] = nextLeft;
        next[rightIndex] = nextRight;
        return next;
      });
    };

    const handlePointerUp = () => {
      setActiveResize(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [activeResize, isHorizontal, panels, updateSizes]);

  const containerClasses = [
    "flex min-h-[18rem] min-w-0 gap-2 rounded-3xl p-3",
    GLASS_PANEL_CLASS,
    isHorizontal ? "flex-row" : "flex-col",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div ref={containerRef} className={containerClasses} data-testid="resizable-panels">
      {panels.map((panel, index) => {
        const panelSize = panelSizes[index] ?? 100 / Math.max(panels.length, 1);
        const collapsedSize = getCollapsedSize(panel);
        const collapsed = panel.collapsible !== false && panelSize <= collapsedSize + 0.5;
        const dimensionLabel = isHorizontal ? "width" : "height";

        return (
          <Fragment key={panel.id}>
            <div
              className={`flex min-w-0 min-h-0 overflow-hidden rounded-2xl ${GLASS_PANEL_CLASS}`}
              style={{
                flexBasis: `${panelSize}%`,
                flexDirection: "column",
              }}
              data-testid={`panel-${panel.id}`}
            >
              <div className="flex items-center justify-between gap-3 border-b border-white/20 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {panel.title}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {panelSize.toFixed(0)}% {dimensionLabel}
                  </p>
                </div>
                {panel.collapsible !== false ? (
                  <PanelHeaderButton
                    collapsed={collapsed}
                    direction={direction}
                    onClick={() => handleTogglePanel(index)}
                    title={panel.title}
                  />
                ) : null}
              </div>

              <div
                className={`min-h-0 flex-1 overflow-auto p-4 ${
                  collapsed ? "pointer-events-none opacity-0" : "opacity-100"
                } transition-opacity`}
              >
                {panel.children}
              </div>
            </div>
            {index < panels.length - 1 ? (
              <DividerHandle
                direction={direction}
                index={index}
                active={activeResize?.index === index}
                onPointerDown={handlePointerDown}
              />
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}
