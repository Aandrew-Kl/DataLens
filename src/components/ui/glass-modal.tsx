"use client";

import {
  useEffect,
  useEffectEvent,
  useId,
  type MouseEvent,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";

export interface GlassModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  closeOnOverlayClick?: boolean;
}

const GLASS_PANEL =
  "bg-white/75 backdrop-blur-2xl dark:bg-slate-950/45 border border-white/20";
const MOTION_EASE = [0.22, 1, 0.36, 1] as const;
const SIZE_CLASSES: Record<NonNullable<GlassModalProps["size"]>, string> = {
  sm: "max-w-md",
  md: "max-w-2xl",
  lg: "max-w-4xl",
  xl: "max-w-6xl",
};

export default function GlassModal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  closeOnOverlayClick = true,
}: GlassModalProps) {
  const titleId = useId();
  const descriptionId = useId();

  const handleEscape = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "Escape") {
      onClose();
    }
  });

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [handleEscape, open]);

  function handleOverlayClick(event: MouseEvent<HTMLDivElement>) {
    if (!closeOnOverlayClick) {
      return;
    }

    if (event.target === event.currentTarget) {
      onClose();
    }
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: MOTION_EASE }}
          onClick={handleOverlayClick}
        >
          <motion.div
            className="absolute inset-0 bg-slate-950/35 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          <motion.section
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            aria-describedby={description ? descriptionId : undefined}
            className={`relative z-10 w-full overflow-hidden rounded-[2rem] shadow-2xl shadow-slate-950/20 ${SIZE_CLASSES[size]} ${GLASS_PANEL}`}
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.24, ease: MOTION_EASE }}
          >
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/70 to-transparent dark:via-white/20" />

            <div className="flex items-start justify-between gap-4 border-b border-white/15 px-6 py-5">
              <div className="min-w-0">
                {title ? (
                  <h2
                    id={titleId}
                    className="text-xl font-semibold text-slate-950 dark:text-slate-50"
                  >
                    {title}
                  </h2>
                ) : null}
                {description ? (
                  <p
                    id={descriptionId}
                    className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300"
                  >
                    {description}
                  </p>
                ) : null}
              </div>

              <button
                type="button"
                onClick={onClose}
                className="rounded-2xl border border-white/15 bg-white/50 p-2 text-slate-500 transition hover:bg-white/80 hover:text-slate-900 dark:bg-slate-900/40 dark:text-slate-300 dark:hover:bg-slate-900/70 dark:hover:text-slate-50"
                aria-label="Close modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto px-6 py-5 text-sm text-slate-700 dark:text-slate-200">
              {children}
            </div>

            {footer ? (
              <div className="border-t border-white/15 px-6 py-4">{footer}</div>
            ) : null}
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
