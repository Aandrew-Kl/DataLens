"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle, XCircle, AlertTriangle, Info, X } from "lucide-react";
import {
  addToast,
  subscribeToToasts,
  type ToastVariant,
} from "@/lib/ui/toast-bus";
export { addToast } from "@/lib/ui/toast-bus";

/* ─── Types ─── */
type ToastType = ToastVariant;

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration: number;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType, duration?: number) => void;
}

/* ─── Constants ─── */
const MAX_VISIBLE = 3;

const icons: Record<ToastType, typeof CheckCircle> = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const typeStyles: Record<ToastType, string> = {
  success:
    "border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/90 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-200",
  error:
    "border-red-200 dark:border-red-800/60 bg-red-50/90 dark:bg-red-950/80 text-red-800 dark:text-red-200",
  warning:
    "border-amber-200 dark:border-amber-800/60 bg-amber-50/90 dark:bg-amber-950/80 text-amber-800 dark:text-amber-200",
  info: "border-blue-200 dark:border-blue-800/60 bg-blue-50/90 dark:bg-blue-950/80 text-blue-800 dark:text-blue-200",
};

const iconColors: Record<ToastType, string> = {
  success: "text-emerald-500 dark:text-emerald-400",
  error: "text-red-500 dark:text-red-400",
  warning: "text-amber-500 dark:text-amber-400",
  info: "text-blue-500 dark:text-blue-400",
};

/* ─── Context ─── */
const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}

/* ─── Provider ─── */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, type: ToastType = "info", duration: number = 4000) => {
      addToast({ message, variant: type, duration });
    },
    [],
  );

  useEffect(
    () =>
      subscribeToToasts(({ message, variant, duration }) => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        setToasts((prev) => {
          const next = [...prev, { id, type: variant, message, duration }];
          return next.slice(-MAX_VISIBLE);
        });
        setTimeout(() => removeToast(id), duration);
      }),
    [removeToast],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}

      {/* Toast container */}
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none">
        <AnimatePresence mode="popLayout">
          {toasts.map((t) => {
            const Icon = icons[t.type];
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, x: 80, scale: 0.95 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 80, scale: 0.95 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                className={`
                  pointer-events-auto
                  flex items-start gap-3
                  min-w-[280px] max-w-sm
                  rounded-xl px-4 py-3
                  border backdrop-blur-lg
                  shadow-lg
                  ${typeStyles[t.type]}
                `}
              >
                <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${iconColors[t.type]}`} />
                <span className="text-sm font-medium flex-1">{t.message}</span>
                <button
                  onClick={() => removeToast(t.id)}
                  className="shrink-0 p-0.5 rounded hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                  aria-label="Dismiss"
                >
                  <X className="w-3.5 h-3.5 opacity-60" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
