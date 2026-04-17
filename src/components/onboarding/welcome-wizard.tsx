"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Circle, Copy } from "lucide-react";
import SampleDatasetsGallery from "@/components/onboarding/sample-datasets-gallery";
import {
  FEATURES,
  FooterButton,
  OLLAMA_INSTALL,
  SQL_TEMPLATES,
  StepHeader,
  STEP_TITLES,
} from "@/components/onboarding/welcome-wizard-parts";
import { useToast } from "@/components/ui/toast";
import { profileTable } from "@/lib/duckdb/profiler";
import { generateId } from "@/lib/utils/formatters";
import { useDatasetStore } from "@/stores/dataset-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
const slideVariants = {
  enter: (direction: number) => ({ opacity: 0, x: direction > 0 ? 36 : -36 }),
  center: { opacity: 1, x: 0 },
  exit: (direction: number) => ({ opacity: 0, x: direction > 0 ? -36 : 36 }),
};

interface WelcomeWizardProps {
  open: boolean;
  onClose: () => void;
}

type OllamaState = "idle" | "checking" | "ready" | "missing";

export default function WelcomeWizard({ open, onClose }: WelcomeWizardProps) {
  const { toast } = useToast();
  const addDataset = useDatasetStore((state) => state.addDataset);
  const setActiveDataset = useDatasetStore((state) => state.setActiveDataset);
  const setProfileData = useWorkspaceStore((state) => state.setProfileData);
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [ollamaState, setOllamaState] = useState<OllamaState>("idle");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyTimeoutRef = useRef<number | null>(null);
  const lastStep = STEP_TITLES.length - 1;

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!open || step !== 2) return;

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 1500);
    let cancelled = false;

    void fetch("http://localhost:11434/api/tags", { signal: controller.signal })
      .then((response) => {
        if (!cancelled) {
          setOllamaState(response.ok ? "ready" : "missing");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOllamaState("missing");
        }
      })
      .finally(() => window.clearTimeout(timeoutId));

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [open, step]);

  const moveToStep = useCallback(
    (nextStep: number) => {
      setDirection(nextStep > step ? 1 : -1);
      if (nextStep === 2) {
        setOllamaState("checking");
      }
      setStep(nextStep);
    },
    [step],
  );

  useEffect(() => {
    if (!open) return;

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === "ArrowLeft" && step > 0) {
        event.preventDefault();
        moveToStep(Math.max(0, step - 1));
        return;
      }

      if (event.key === "ArrowRight" && step < lastStep) {
        event.preventDefault();
        moveToStep(Math.min(lastStep, step + 1));
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        if (step === lastStep) {
          onClose();
          return;
        }
        moveToStep(Math.min(lastStep, step + 1));
      }
    };

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [lastStep, moveToStep, onClose, open, step]);

  const goBack = () => {
    moveToStep(Math.max(0, step - 1));
  };

  const goForward = () => {
    if (step === lastStep) {
      onClose();
      return;
    }
    moveToStep(Math.min(lastStep, step + 1));
  };

  const handleCopy = async (id: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopiedId(id);
    if (copyTimeoutRef.current) {
      window.clearTimeout(copyTimeoutRef.current);
    }
    copyTimeoutRef.current = window.setTimeout(() => setCopiedId(null), 1500);
  };

  const handleDatasetLoaded = async ({
    tableName,
    fileName,
    rowCount,
    columnCount,
  }: {
    tableName: string;
    fileName: string;
    rowCount: number;
    columnCount: number;
    columns: string[];
  }) => {
    const id = generateId();
    const profiles = await profileTable(tableName);
    addDataset({
      id,
      name: tableName,
      fileName,
      rowCount,
      columnCount: columnCount || profiles.length,
      columns: profiles,
      uploadedAt: Date.now(),
      sizeBytes: 0,
    });
    setActiveDataset(id);
    setProfileData(profiles);
    toast("Dataset loaded!", "success", 2400);
    onClose();
  };

  const body = [
    <div key="welcome" className="space-y-6">
      <StepHeader
        title={STEP_TITLES[0]}
        subtitle="Privacy-first analytics — your data never leaves this browser."
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {FEATURES.map(({ icon: Icon, label, description }) => (
          <div
            key={label}
            className="rounded-2xl border border-white/20 bg-white/65 p-4 shadow-[0_18px_40px_-28px_rgba(15,23,42,0.5)] dark:border-white/10 dark:bg-slate-950/40"
          >
            <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/20 bg-white/75 text-slate-700 dark:border-white/10 dark:bg-slate-900/70 dark:text-slate-200">
              <Icon className="h-5 w-5" />
            </div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{label}</h3>
            <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">
              {description}
            </p>
          </div>
        ))}
      </div>
    </div>,
    <div key="datasets" className="space-y-5">
      <StepHeader title={STEP_TITLES[1]} />
      <SampleDatasetsGallery onDatasetLoaded={handleDatasetLoaded} />
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Or upload your own CSV/JSON/Excel anytime from the sidebar.
      </p>
    </div>,
    <div key="ollama" className="space-y-5">
      <StepHeader title={STEP_TITLES[2]} />
      <div className="rounded-2xl border border-white/20 bg-white/65 p-5 dark:border-white/10 dark:bg-slate-950/40">
        <div className="flex items-center gap-3">
          {ollamaState === "ready" ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          ) : (
            <Circle className="h-5 w-5 text-slate-400" />
          )}
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
            {ollamaState === "ready"
              ? "Ollama detected — you're all set."
              : ollamaState === "checking"
                ? "Checking for Ollama on localhost…"
                : "Ollama not detected yet."}
          </p>
        </div>
        {ollamaState !== "ready" ? (
          <div className="mt-4 rounded-2xl border border-white/20 bg-slate-950 p-4 text-sm text-slate-100 dark:border-white/10">
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
                Install
              </span>
              <button
                type="button"
                onClick={() => void handleCopy("ollama", OLLAMA_INSTALL)}
                className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-semibold transition hover:bg-white/20"
              >
                <Copy className="h-3.5 w-3.5" />
                {copiedId === "ollama" ? "Copied!" : "Copy"}
              </button>
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-6">
              <code>{OLLAMA_INSTALL}</code>
            </pre>
          </div>
        ) : null}
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        DataLens works fine without Ollama — it falls back to a rule-based SQL
        generator.
      </p>
    </div>,
    <div key="queries" className="space-y-5">
      <StepHeader title={STEP_TITLES[3]} />
      <div className="space-y-4">
        {SQL_TEMPLATES.map((template) => (
          <article
            key={template.id}
            className="rounded-2xl border border-white/20 bg-white/65 p-4 dark:border-white/10 dark:bg-slate-950/40"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  {template.title}
                </h3>
                <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">
                  {template.description}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleCopy(template.id, template.code)}
                className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-white/70 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-white dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:bg-slate-900"
              >
                <Copy className="h-3.5 w-3.5" />
                {copiedId === template.id ? "Copied!" : "Copy"}
              </button>
            </div>
            <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-950 p-4 text-xs leading-6 text-slate-100">
              <code>{template.code}</code>
            </pre>
          </article>
        ))}
      </div>
    </div>,
  ][step];

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button
            type="button"
            aria-label="Close welcome wizard"
            className="absolute inset-0 bg-slate-950/30 backdrop-blur-md"
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="welcome-wizard-title"
            className="relative flex max-h-[85vh] w-full max-w-[640px] flex-col overflow-hidden rounded-[1.75rem] border border-white/15 bg-white/80 shadow-[0_40px_120px_-50px_rgba(15,23,42,0.8)] backdrop-blur-2xl dark:bg-slate-900/80"
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/15 px-6 py-4 dark:border-white/10">
              <div className="flex gap-2">
                {STEP_TITLES.map((label, index) => (
                  <span
                    key={label}
                    className={`h-2.5 w-10 rounded-full transition ${
                      index === step
                        ? "bg-slate-950 dark:bg-white"
                        : "bg-slate-300/70 dark:bg-slate-700/80"
                    }`}
                  />
                ))}
              </div>
              <p className="text-xs font-medium uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                {step + 1} / {STEP_TITLES.length}
              </p>
            </div>

            <div className="min-h-[420px] flex-1 overflow-y-auto px-6 py-6">
              <AnimatePresence custom={direction} mode="wait">
                <motion.div
                  key={step}
                  custom={direction}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.24, ease: "easeOut" }}
                >
                  <div id="welcome-wizard-title">{body}</div>
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="flex items-center justify-between border-t border-white/15 px-6 py-4 dark:border-white/10">
              {step === 0 ? (
                <FooterButton onClick={onClose} variant="ghost">
                  Skip tour
                </FooterButton>
              ) : (
                <FooterButton onClick={goBack} variant="ghost">
                  ← Back
                </FooterButton>
              )}
              <FooterButton onClick={goForward} variant="primary">
                {step === lastStep ? "Done 🚀" : "Next →"}
              </FooterButton>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
