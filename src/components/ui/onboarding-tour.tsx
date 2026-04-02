"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Code2,
  MessageSquareText,
  ScanSearch,
  UploadCloud,
  X,
  type LucideIcon,
} from "lucide-react";

interface OnboardingTourProps {
  onComplete?: () => void;
  forceShow?: boolean;
}

type TooltipPlacement = "top" | "bottom" | "left" | "right" | "center";

interface TargetCandidate {
  selector?: string;
  text?: string;
  closest?: string;
}

interface TourStepDefinition {
  id: string;
  title: string;
  description: string;
  note: string;
  icon: LucideIcon;
  preferredPlacement: Exclude<TooltipPlacement, "center">;
  gradient: string;
  iconClasses: string;
  candidates: TargetCandidate[];
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

interface BoxSize {
  width: number;
  height: number;
}

const STORAGE_KEY = "datalens:onboarding-tour-complete";
const VIEWPORT_PADDING = 24;
const TOOLTIP_GAP = 20;
const TOOLTIP_MAX_WIDTH = 400;
const DEFAULT_PANEL_SIZE: BoxSize = { width: 400, height: 332 };
const SPOTLIGHT_PADDING = 14;

const SEARCHABLE_TEXT_SELECTOR = [
  "button",
  "[role='button']",
  "a",
  "h1",
  "h2",
  "h3",
  "h4",
  "p",
  "span",
].join(", ");

const overlayVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] as const },
  },
  exit: {
    opacity: 0,
    transition: { duration: 0.18, ease: [0.4, 0, 1, 1] as const },
  },
};

const spotlightVariants: Variants = {
  hidden: { opacity: 0, scale: 0.94 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.34, ease: [0.16, 1, 0.3, 1] as const },
  },
  exit: {
    opacity: 0,
    scale: 0.97,
    transition: { duration: 0.16, ease: [0.4, 0, 1, 1] as const },
  },
};

const panelVariants: Variants = {
  hidden: { opacity: 0, y: 18, scale: 0.96 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.32, ease: [0.16, 1, 0.3, 1] as const },
  },
  exit: {
    opacity: 0,
    y: 10,
    scale: 0.98,
    transition: { duration: 0.18, ease: [0.4, 0, 1, 1] as const },
  },
};

const TOUR_STEPS: TourStepDefinition[] = [
  {
    id: "upload-data",
    title: "Upload Data",
    description:
      "Drop a CSV, TSV, JSON, or Excel file into DataLens and it will profile the dataset locally so you can start exploring immediately.",
    note: "If you have not loaded a dataset yet, this tour will point to the landing upload area.",
    icon: UploadCloud,
    preferredPlacement: "bottom",
    gradient: "from-sky-500 via-cyan-500 to-teal-400",
    iconClasses:
      "bg-sky-500/12 text-sky-600 ring-1 ring-sky-500/20 dark:bg-sky-400/12 dark:text-sky-300 dark:ring-sky-400/20",
    candidates: [
      { selector: '[data-tour="upload-data"]' },
      { selector: 'button[title="Upload new dataset"]' },
      { text: "Upload Dataset", closest: "button" },
      { text: "New Dataset", closest: "button" },
      { text: "Drop your data here", closest: '[class*="rounded-2xl"]' },
      { text: "Upload New Dataset", closest: '[class*="rounded-2xl"]' },
    ],
  },
  {
    id: "explore-profile",
    title: "Explore Profile",
    description:
      "The profile view summarizes columns, types, completeness, and distributions so you can understand quality issues before you query or visualize anything.",
    note: "After a dataset is loaded, this usually maps to the Profile tab in the workspace header.",
    icon: ScanSearch,
    preferredPlacement: "bottom",
    gradient: "from-indigo-500 via-violet-500 to-fuchsia-500",
    iconClasses:
      "bg-indigo-500/12 text-indigo-600 ring-1 ring-indigo-500/20 dark:bg-indigo-400/12 dark:text-indigo-300 dark:ring-indigo-400/20",
    candidates: [
      { selector: '[data-tour="explore-profile"]' },
      { text: "Profile", closest: "button" },
      { text: "Column Profiles", closest: "div" },
      { text: "Data Profiling", closest: '[class*="rounded-xl"]' },
    ],
  },
  {
    id: "ask-ai-questions",
    title: "Ask AI Questions",
    description:
      "Use natural language to ask questions about your data. DataLens generates SQL, runs it locally, and can surface tables plus chart suggestions.",
    note: "This step highlights the Ask AI workspace entry point or the matching landing-page feature card.",
    icon: MessageSquareText,
    preferredPlacement: "bottom",
    gradient: "from-emerald-500 via-teal-500 to-cyan-400",
    iconClasses:
      "bg-emerald-500/12 text-emerald-600 ring-1 ring-emerald-500/20 dark:bg-emerald-400/12 dark:text-emerald-300 dark:ring-emerald-400/20",
    candidates: [
      { selector: '[data-tour="ask-ai-questions"]' },
      { text: "Ask AI", closest: "button" },
      { text: "Ask Your Data", closest: "div" },
      { text: "Natural Language Queries", closest: '[class*="rounded-xl"]' },
    ],
  },
  {
    id: "write-sql",
    title: "Write SQL",
    description:
      "Open the SQL editor when you want full control. It gives you a dedicated workspace for writing, refining, and executing DuckDB queries directly in the browser.",
    note: "The SQL editor becomes especially useful once you know the schema and want exact control over joins, filters, and aggregations.",
    icon: Code2,
    preferredPlacement: "bottom",
    gradient: "from-amber-500 via-orange-500 to-rose-500",
    iconClasses:
      "bg-amber-500/12 text-amber-600 ring-1 ring-amber-500/20 dark:bg-amber-400/12 dark:text-amber-300 dark:ring-amber-400/20",
    candidates: [
      { selector: '[data-tour="write-sql"]' },
      { text: "SQL Editor", closest: "button" },
      { text: "SQL Editor", closest: "div" },
    ],
  },
  {
    id: "build-charts",
    title: "Build Charts",
    description:
      "Use the charts workspace to assemble visualizations, compare metrics, and turn query results into polished visuals without leaving the app.",
    note: "If the charts tab is not visible yet, the tour falls back to the chart-related feature card on the landing experience.",
    icon: BarChart3,
    preferredPlacement: "bottom",
    gradient: "from-pink-500 via-fuchsia-500 to-violet-500",
    iconClasses:
      "bg-pink-500/12 text-pink-600 ring-1 ring-pink-500/20 dark:bg-pink-400/12 dark:text-pink-300 dark:ring-pink-400/20",
    candidates: [
      { selector: '[data-tour="build-charts"]' },
      { text: "Charts", closest: "button" },
      { text: "Chart Builder", closest: "div" },
      { text: "Auto-Dashboards", closest: '[class*="rounded-xl"]' },
    ],
  },
];

const ARROW_CLASS_NAMES: Record<Exclude<TooltipPlacement, "center">, string> = {
  top: "left-1/2 top-full -translate-x-1/2 -translate-y-1/2",
  bottom: "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2",
  left: "left-full top-1/2 -translate-x-1/2 -translate-y-1/2",
  right: "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2",
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function getElementPriority(element: Element): number {
  const tagName = element.tagName.toLowerCase();

  switch (tagName) {
    case "button":
      return 0;
    case "a":
      return 1;
    case "h1":
    case "h2":
    case "h3":
    case "h4":
      return 2;
    case "p":
      return 3;
    default:
      return 4;
  }
}

function findElementByText(text: string): HTMLElement | null {
  if (typeof document === "undefined") return null;

  const target = normalizeText(text);
  const elements = Array.from(
    document.querySelectorAll<HTMLElement>(SEARCHABLE_TEXT_SELECTOR),
  );

  const exactMatches = elements.filter((element) => {
    const content = normalizeText(element.textContent ?? "");
    return content === target;
  });

  if (exactMatches.length > 0) {
    exactMatches.sort((a, b) => getElementPriority(a) - getElementPriority(b));
    return exactMatches[0];
  }

  const partialMatches = elements.filter((element) => {
    const content = normalizeText(element.textContent ?? "");
    return content.includes(target);
  });

  if (partialMatches.length === 0) {
    return null;
  }

  partialMatches.sort((a, b) => getElementPriority(a) - getElementPriority(b));
  return partialMatches[0];
}

function resolveCandidate(candidate: TargetCandidate): HTMLElement | null {
  if (typeof document === "undefined") return null;

  let element: HTMLElement | null = null;

  if (candidate.selector) {
    element = document.querySelector<HTMLElement>(candidate.selector);
  } else if (candidate.text) {
    element = findElementByText(candidate.text);
  }

  if (!element) {
    return null;
  }

  if (!candidate.closest) {
    return element;
  }

  if (candidate.closest === "button") {
    return element.closest<HTMLElement>("button, [role='button'], a") ?? element;
  }

  return element.closest<HTMLElement>(candidate.closest) ?? element;
}

function resolveTarget(step: TourStepDefinition): HTMLElement | null {
  for (const candidate of step.candidates) {
    const element = resolveCandidate(candidate);
    if (element) {
      return element;
    }
  }

  return null;
}

function toTargetRect(element: HTMLElement): TargetRect {
  const rect = element.getBoundingClientRect();

  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    right: rect.right,
    bottom: rect.bottom,
  };
}

function resolvePlacement(
  preferredPlacement: Exclude<TooltipPlacement, "center">,
  rect: TargetRect | null,
  viewport: ViewportSize,
  panelSize: BoxSize,
): TooltipPlacement {
  if (!rect || viewport.width === 0 || viewport.height === 0) {
    return "center";
  }

  const available = {
    top: rect.top - VIEWPORT_PADDING,
    bottom: viewport.height - rect.bottom - VIEWPORT_PADDING,
    left: rect.left - VIEWPORT_PADDING,
    right: viewport.width - rect.right - VIEWPORT_PADDING,
  };

  const required = {
    top: panelSize.height + TOOLTIP_GAP,
    bottom: panelSize.height + TOOLTIP_GAP,
    left: panelSize.width + TOOLTIP_GAP,
    right: panelSize.width + TOOLTIP_GAP,
  };

  if (available[preferredPlacement] >= required[preferredPlacement]) {
    return preferredPlacement;
  }

  const opposite: Record<Exclude<TooltipPlacement, "center">, Exclude<TooltipPlacement, "center">> = {
    top: "bottom",
    bottom: "top",
    left: "right",
    right: "left",
  };

  const oppositePlacement = opposite[preferredPlacement];
  if (available[oppositePlacement] >= required[oppositePlacement]) {
    return oppositePlacement;
  }

  const ranked = (
    Object.entries(available) as Array<[Exclude<TooltipPlacement, "center">, number]>
  ).sort((first, second) => second[1] - first[1]);

  return ranked[0]?.[1] > 0 ? ranked[0][0] : "center";
}

function getPanelStyle(
  placement: TooltipPlacement,
  rect: TargetRect | null,
  viewport: ViewportSize,
  panelSize: BoxSize,
): CSSProperties {
  const availableWidth =
    viewport.width > 0
      ? Math.max(viewport.width - VIEWPORT_PADDING * 2, 240)
      : TOOLTIP_MAX_WIDTH;
  const width = Math.min(TOOLTIP_MAX_WIDTH, availableWidth);
  const safePanelSize = {
    width: Math.min(panelSize.width, width),
    height: panelSize.height,
  };

  if (!rect || placement === "center" || viewport.width === 0 || viewport.height === 0) {
    return {
      left: "50%",
      top: "50%",
      width,
      transform: "translate(-50%, -50%)",
    };
  }

  const centeredLeft = clamp(
    rect.left + rect.width / 2 - safePanelSize.width / 2,
    VIEWPORT_PADDING,
    viewport.width - safePanelSize.width - VIEWPORT_PADDING,
  );
  const centeredTop = clamp(
    rect.top + rect.height / 2 - safePanelSize.height / 2,
    VIEWPORT_PADDING,
    viewport.height - safePanelSize.height - VIEWPORT_PADDING,
  );

  switch (placement) {
    case "top":
      return {
        left: centeredLeft,
        top: clamp(
          rect.top - safePanelSize.height - TOOLTIP_GAP,
          VIEWPORT_PADDING,
          viewport.height - safePanelSize.height - VIEWPORT_PADDING,
        ),
        width,
      };
    case "bottom":
      return {
        left: centeredLeft,
        top: clamp(
          rect.bottom + TOOLTIP_GAP,
          VIEWPORT_PADDING,
          viewport.height - safePanelSize.height - VIEWPORT_PADDING,
        ),
        width,
      };
    case "left":
      return {
        left: clamp(
          rect.left - safePanelSize.width - TOOLTIP_GAP,
          VIEWPORT_PADDING,
          viewport.width - safePanelSize.width - VIEWPORT_PADDING,
        ),
        top: centeredTop,
        width,
      };
    case "right":
      return {
        left: clamp(
          rect.right + TOOLTIP_GAP,
          VIEWPORT_PADDING,
          viewport.width - safePanelSize.width - VIEWPORT_PADDING,
        ),
        top: centeredTop,
        width,
      };
    default:
      return {
        left: "50%",
        top: "50%",
        width,
        transform: "translate(-50%, -50%)",
      };
  }
}

function getSpotlightStyle(rect: TargetRect | null): CSSProperties | undefined {
  if (!rect) {
    return undefined;
  }

  return {
    top: rect.top - SPOTLIGHT_PADDING,
    left: rect.left - SPOTLIGHT_PADDING,
    width: rect.width + SPOTLIGHT_PADDING * 2,
    height: rect.height + SPOTLIGHT_PADDING * 2,
  };
}

function getGlowStyle(rect: TargetRect | null): CSSProperties | undefined {
  if (!rect) {
    return undefined;
  }

  return {
    top: rect.top - SPOTLIGHT_PADDING * 2,
    left: rect.left - SPOTLIGHT_PADDING * 2,
    width: rect.width + SPOTLIGHT_PADDING * 4,
    height: rect.height + SPOTLIGHT_PADDING * 4,
  };
}

export default function OnboardingTour({
  onComplete,
  forceShow = false,
}: OnboardingTourProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  const [isReady, setIsReady] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [viewport, setViewport] = useState<ViewportSize>(() =>
    typeof window === "undefined"
      ? { width: 0, height: 0 }
      : { width: window.innerWidth, height: window.innerHeight },
  );
  const [panelSize, setPanelSize] = useState<BoxSize>(DEFAULT_PANEL_SIZE);

  const activeStep = TOUR_STEPS[currentStepIndex];
  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === TOUR_STEPS.length - 1;
  const progress = ((currentStepIndex + 1) / TOUR_STEPS.length) * 100;

  const placement = useMemo(
    () =>
      resolvePlacement(
        activeStep.preferredPlacement,
        targetRect,
        viewport,
        panelSize,
      ),
    [activeStep.preferredPlacement, panelSize, targetRect, viewport],
  );

  const panelStyle = useMemo(
    () => getPanelStyle(placement, targetRect, viewport, panelSize),
    [panelSize, placement, targetRect, viewport],
  );

  const spotlightStyle = useMemo(
    () => getSpotlightStyle(targetRect),
    [targetRect],
  );

  const glowStyle = useMemo(() => getGlowStyle(targetRect), [targetRect]);

  const persistCompletion = useCallback(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // Ignore storage failures and still dismiss the tour in memory.
    }
  }, []);

  const finishTour = useCallback(() => {
    persistCompletion();
    setIsVisible(false);
    onComplete?.();
  }, [onComplete, persistCompletion]);

  const handleDismiss = useCallback(() => {
    finishTour();
  }, [finishTour]);

  const handleAdvance = useCallback(() => {
    if (isLastStep) {
      finishTour();
      return;
    }

    setCurrentStepIndex((previous) =>
      Math.min(previous + 1, TOUR_STEPS.length - 1),
    );
  }, [finishTour, isLastStep]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let shouldShow = forceShow;
    if (!forceShow) {
      try {
        shouldShow = window.localStorage.getItem(STORAGE_KEY) !== "true";
      } catch {
        shouldShow = true;
      }
    }

    const frameId = window.requestAnimationFrame(() => {
      setCurrentStepIndex(0);
      setIsVisible(shouldShow);
      setIsReady(true);
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [forceShow]);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    const measurePanel = () => {
      const panel = panelRef.current;
      if (!panel) {
        return;
      }

      const nextSize = {
        width: panel.offsetWidth || DEFAULT_PANEL_SIZE.width,
        height: panel.offsetHeight || DEFAULT_PANEL_SIZE.height,
      };

      setPanelSize((previous) =>
        previous.width === nextSize.width && previous.height === nextSize.height
          ? previous
          : nextSize,
      );
    };

    measurePanel();

    if (typeof ResizeObserver === "undefined" || !panelRef.current) {
      return;
    }

    const observer = new ResizeObserver(measurePanel);
    observer.observe(panelRef.current);

    return () => observer.disconnect();
  }, [currentStepIndex, isVisible]);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    let frameId = 0;

    const updateMeasurements = () => {
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight,
      });

      const target = resolveTarget(activeStep);
      setTargetRect(target ? toTargetRect(target) : null);
    };

    const scheduleUpdate = () => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(updateMeasurements);
    };

    scheduleUpdate();

    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, true);

    const observer =
      typeof MutationObserver !== "undefined"
        ? new MutationObserver(scheduleUpdate)
        : null;

    observer?.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate, true);
      observer?.disconnect();
    };
  }, [activeStep, isVisible]);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        handleDismiss();
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        handleAdvance();
        return;
      }

      if (event.key === "ArrowLeft" && !isFirstStep) {
        event.preventDefault();
        setCurrentStepIndex((previous) => Math.max(previous - 1, 0));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleAdvance, handleDismiss, isFirstStep, isVisible]);

  if (!isReady || !isVisible) {
    return null;
  }

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[90] overflow-hidden"
        initial="hidden"
        animate="visible"
        exit="exit"
        variants={overlayVariants}
      >
        <div className="absolute inset-0 bg-slate-950/72 backdrop-blur-md" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.16),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(168,85,247,0.16),transparent_32%)]" />

        {glowStyle && (
          <motion.div
            key={`${activeStep.id}-glow`}
            className={`pointer-events-none absolute rounded-[34px] bg-gradient-to-r ${activeStep.gradient} opacity-20 blur-3xl`}
            style={glowStyle}
            variants={spotlightVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          />
        )}

        {spotlightStyle && (
          <motion.div
            key={`${activeStep.id}-spotlight`}
            className="pointer-events-none absolute rounded-[28px] border border-white/55 bg-white/[0.05] shadow-[0_0_0_9999px_rgba(2,6,23,0.72)] backdrop-blur-[2px] dark:border-sky-300/35 dark:bg-slate-900/[0.08]"
            style={spotlightStyle}
            variants={spotlightVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <div className="absolute inset-0 rounded-[28px] ring-1 ring-inset ring-white/55 dark:ring-sky-300/30" />
            <motion.div
              className={`absolute inset-0 rounded-[28px] bg-gradient-to-r ${activeStep.gradient} opacity-[0.14]`}
              animate={{ opacity: [0.1, 0.18, 0.1] }}
              transition={{
                duration: 2.2,
                repeat: Infinity,
                ease: [0.4, 0, 0.2, 1] as const,
              }}
            />
          </motion.div>
        )}

        <div
          className="pointer-events-auto absolute"
          style={panelStyle}
        >
          {placement !== "center" && (
            <div
              className={`absolute h-4 w-4 rotate-45 border border-white/20 bg-slate-950/85 ${ARROW_CLASS_NAMES[placement]}`}
            />
          )}

          <AnimatePresence mode="wait">
            <motion.div
              key={activeStep.id}
              ref={panelRef}
              initial="hidden"
              animate="visible"
              exit="exit"
              variants={panelVariants}
              className="relative overflow-hidden rounded-[28px] border border-white/16 bg-white/72 p-5 shadow-[0_24px_80px_-30px_rgba(15,23,42,0.8)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-900/78 sm:p-6"
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              aria-describedby={descriptionId}
            >
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/80 to-transparent dark:via-white/40" />
              <div
                className={`absolute -top-24 right-[-10%] h-44 w-44 rounded-full bg-gradient-to-r ${activeStep.gradient} opacity-[0.12] blur-3xl`}
              />

              <div className="relative">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${activeStep.iconClasses}`}
                    >
                      <activeStep.icon className="h-5 w-5" />
                    </div>

                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500 dark:text-slate-400">
                        DataLens Tour
                      </p>
                      <h2
                        id={titleId}
                        className="mt-1 text-xl font-semibold tracking-tight text-slate-950 dark:text-white"
                      >
                        {activeStep.title}
                      </h2>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleDismiss}
                    className="rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-900/5 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-white/5 dark:hover:text-slate-200"
                    aria-label="Close tour"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <p
                  id={descriptionId}
                  className="mt-4 text-sm leading-6 text-slate-600 dark:text-slate-300"
                >
                  {activeStep.description}
                </p>

                <div className="mt-4 rounded-2xl border border-white/45 bg-white/55 px-4 py-3 text-sm text-slate-600 shadow-sm dark:border-white/8 dark:bg-white/[0.03] dark:text-slate-300">
                  {activeStep.note}
                </div>

                <div className="mt-5">
                  <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                    <span>
                      Step {currentStepIndex + 1} of {TOUR_STEPS.length}
                    </span>
                    <span>{Math.round(progress)}%</span>
                  </div>

                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200/70 dark:bg-slate-800/80">
                    <motion.div
                      className={`h-full rounded-full bg-gradient-to-r ${activeStep.gradient}`}
                      animate={{ width: `${progress}%` }}
                      transition={{
                        duration: 0.32,
                        ease: [0.22, 1, 0.36, 1] as const,
                      }}
                    />
                  </div>

                  <div className="mt-3 grid grid-cols-5 gap-2">
                    {TOUR_STEPS.map((step, index) => (
                      <div
                        key={step.id}
                        className={`h-1.5 rounded-full transition-colors ${
                          index <= currentStepIndex
                            ? "bg-slate-900 dark:bg-slate-100"
                            : "bg-slate-200 dark:bg-slate-800"
                        }`}
                      />
                    ))}
                  </div>
                </div>

                <div className="mt-6 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      setCurrentStepIndex((previous) => Math.max(previous - 1, 0))
                    }
                    disabled={isFirstStep}
                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-200/80 bg-white/80 px-3.5 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-white disabled:cursor-not-allowed disabled:opacity-45 dark:border-slate-700/80 dark:bg-slate-950/40 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-950/60"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Back
                  </button>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleDismiss}
                      className="rounded-2xl px-3.5 py-2.5 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-900/5 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-slate-100"
                    >
                      Skip Tour
                    </button>

                    <button
                      type="button"
                      onClick={handleAdvance}
                      className={`inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r ${activeStep.gradient} px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-slate-900/20 transition-transform hover:scale-[1.01] active:scale-[0.99]`}
                    >
                      {isLastStep ? "Finish" : "Next"}
                      {!isLastStep && <ArrowRight className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
