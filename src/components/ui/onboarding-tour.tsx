"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { CSSProperties } from "react";

export interface TourStep {
  target: string;
  title: string;
  description: string;
  position: "top" | "bottom" | "left" | "right";
}

interface OnboardingTourProps {
  steps: TourStep[];
  onComplete: () => void;
}

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

interface ViewportSize {
  width: number;
  height: number;
}

const STORAGE_KEY = "datalens-onboarding-tour-complete";
const TOOLTIP_WIDTH = 320;
const TOOLTIP_GAP = 18;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getTooltipStyle(
  rect: TargetRect | null,
  position: TourStep["position"],
  viewport: ViewportSize,
): CSSProperties {
  if (!rect || viewport.width === 0 || viewport.height === 0) {
    return {
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)",
    };
  }

  const leftCenter = clamp(rect.left + rect.width / 2, 24, viewport.width - 24);
  const topCenter = clamp(rect.top + rect.height / 2, 24, viewport.height - 24);

  switch (position) {
    case "top":
      return {
        left: leftCenter,
        top: Math.max(24, rect.top - TOOLTIP_GAP),
        transform: "translate(-50%, -100%)",
      };
    case "bottom":
      return {
        left: leftCenter,
        top: Math.min(viewport.height - 24, rect.bottom + TOOLTIP_GAP),
        transform: "translate(-50%, 0)",
      };
    case "left":
      return {
        left: Math.max(24, rect.left - TOOLTIP_GAP),
        top: topCenter,
        transform: "translate(-100%, -50%)",
      };
    case "right":
      return {
        left: Math.min(viewport.width - 24, rect.right + TOOLTIP_GAP),
        top: topCenter,
        transform: "translate(0, -50%)",
      };
    default:
      return {
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
      };
  }
}

const ARROW_CLASSES: Record<TourStep["position"], string> = {
  top: "left-1/2 top-full -translate-x-1/2 -translate-y-1/2",
  bottom: "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2",
  left: "left-full top-1/2 -translate-x-1/2 -translate-y-1/2",
  right: "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2",
};

export default function OnboardingTour({
  steps,
  onComplete,
}: OnboardingTourProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [viewport, setViewport] = useState<ViewportSize>({
    width: 0,
    height: 0,
  });

  const activeStep = isVisible ? steps[currentStepIndex] : undefined;
  const isLastStep = currentStepIndex === steps.length - 1;

  const completeTour = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // localStorage unavailable
    }

    setIsVisible(false);
    onComplete();
  }, [onComplete]);

  useEffect(() => {
    if (steps.length === 0) return;

    try {
      if (localStorage.getItem(STORAGE_KEY) === "true") return;
    } catch {
      // localStorage unavailable
    }

    const frameId = requestAnimationFrame(() => {
      setCurrentStepIndex(0);
      setIsVisible(true);
    });

    return () => cancelAnimationFrame(frameId);
  }, [steps]);

  useEffect(() => {
    if (!isVisible || !activeStep) return;

    let frameId = 0;

    const updatePosition = () => {
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight,
      });

      const element = document.querySelector<HTMLElement>(activeStep.target);
      if (!element) {
        setTargetRect(null);
        return;
      }

      const rect = element.getBoundingClientRect();
      setTargetRect({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        right: rect.right,
        bottom: rect.bottom,
      });
    };

    const scheduleUpdate = () => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(updatePosition);
    };

    scheduleUpdate();

    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, true);

    const pollId = window.setInterval(scheduleUpdate, 400);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate, true);
      window.clearInterval(pollId);
    };
  }, [activeStep, isVisible]);

  useEffect(() => {
    if (!isVisible) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        completeTour();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [completeTour, isVisible]);

  const tooltipStyle = useMemo(() => {
    if (!activeStep) return {};
    return getTooltipStyle(targetRect, activeStep.position, viewport);
  }, [activeStep, targetRect, viewport]);

  if (!isVisible || !activeStep || steps.length === 0) {
    return null;
  }

  return (
    <AnimatePresence>
      <motion.div
        key={activeStep.target}
        className="pointer-events-none fixed inset-0 z-[80]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-[2px]" />

        {targetRect && (
          <motion.div
            className="absolute rounded-[24px] border border-indigo-300/70 bg-white/5 shadow-[0_0_0_9999px_rgba(2,6,23,0.56)] dark:border-indigo-400/60"
            style={{
              top: targetRect.top - 8,
              left: targetRect.left - 8,
              width: targetRect.width + 16,
              height: targetRect.height + 16,
            }}
            initial={{ opacity: 0.7, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          />
        )}

        <motion.div
          className="pointer-events-auto absolute"
          style={{
            ...tooltipStyle,
            width: `min(${TOOLTIP_WIDTH}px, calc(100vw - 32px))`,
          }}
          initial={{ opacity: 0, y: 12, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.96 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
        >
          {targetRect && (
            <div
              className={`absolute h-4 w-4 rotate-45 border border-slate-200/70 bg-white/90 dark:border-slate-700/70 dark:bg-slate-900/95 ${ARROW_CLASSES[activeStep.position]}`}
            />
          )}

          <div className="relative overflow-hidden rounded-[24px] border border-slate-200/80 bg-white/90 p-5 shadow-2xl backdrop-blur-2xl dark:border-slate-700/70 dark:bg-slate-900/95">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-indigo-400/80 to-transparent" />

            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-indigo-500 dark:text-indigo-300">
                Guided tour
              </p>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {currentStepIndex + 1} of {steps.length}
              </p>
            </div>

            <h3 className="mt-3 text-lg font-semibold text-slate-950 dark:text-white">
              {activeStep.title}
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
              {activeStep.description}
            </p>

            <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-cyan-500"
                animate={{
                  width: `${((currentStepIndex + 1) / steps.length) * 100}%`,
                }}
                transition={{ duration: 0.25, ease: "easeOut" }}
              />
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={completeTour}
                className="rounded-xl border border-slate-200/80 px-3.5 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700/70 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800/80 dark:hover:text-white"
              >
                Skip
              </button>

              <button
                type="button"
                onClick={() => {
                  if (isLastStep) {
                    completeTour();
                    return;
                  }

                  setCurrentStepIndex((previous) => previous + 1);
                }}
                className="rounded-xl bg-gradient-to-r from-indigo-500 to-cyan-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition-transform hover:scale-[1.02] active:scale-[0.99]"
              >
                {isLastStep ? "Finish" : "Next"}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
