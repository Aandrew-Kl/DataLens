"use client";

import { useCallback, useEffect, useEffectEvent, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle, Info, X, XCircle } from "lucide-react";

export type NotificationType = "success" | "error" | "warning" | "info";
export type NotificationAction = { label: string; onClick: () => void };
export type Notification = {
  id: string;
  title: string;
  message: string;
  type: NotificationType;
  action?: NotificationAction;
};
export type NotificationInput = Omit<Notification, "id">;

interface NotificationCenterProps {
  notifications: Notification[];
  removeNotification: (id: string) => void;
  clearAll?: () => void;
}

interface NotificationItemProps {
  notification: Notification;
  onAction?: (notification: Notification) => void;
  onDismiss: (id: string) => void;
}

const AUTO_DISMISS_MS = 5000;
const MAX_VISIBLE = 5;

const icons: Record<NotificationType, typeof CheckCircle> = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};
const shellStyles: Record<NotificationType, string> = {
  success: "border-emerald-500/25 shadow-emerald-950/30",
  error: "border-rose-500/25 shadow-rose-950/30",
  warning: "border-amber-500/25 shadow-amber-950/30",
  info: "border-sky-500/25 shadow-sky-950/30",
};
const iconStyles: Record<NotificationType, string> = {
  success: "text-emerald-400",
  error: "text-rose-400",
  warning: "text-amber-300",
  info: "text-sky-400",
};
const actionStyles: Record<NotificationType, string> = {
  success: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/16",
  error: "border-rose-400/20 bg-rose-400/10 text-rose-200 hover:bg-rose-400/16",
  warning: "border-amber-300/20 bg-amber-300/10 text-amber-100 hover:bg-amber-300/16",
  info: "border-sky-400/20 bg-sky-400/10 text-sky-200 hover:bg-sky-400/16",
};
const progressStyles: Record<NotificationType, string> = {
  success: "bg-emerald-400",
  error: "bg-rose-400",
  warning: "bg-amber-300",
  info: "bg-sky-400",
};

function mergeClasses(...classNames: Array<string | false | null | undefined>): string {
  return classNames.filter(Boolean).join(" ");
}

function createNotificationId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const removeNotification = useCallback((id: string) => {
    setNotifications((current) =>
      current.filter((notification) => notification.id !== id),
    );
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  const addNotification = useCallback((input: NotificationInput) => {
    const notification: Notification = {
      id: createNotificationId(),
      title: input.title,
      message: input.message,
      type: input.type ?? "info",
      action: input.action,
    };
    setNotifications((current) => [...current, notification].slice(-MAX_VISIBLE));
    return notification.id;
  }, []);

  return { notifications, addNotification, removeNotification, clearAll };
}

function NotificationItem({
  notification,
  onAction,
  onDismiss,
}: NotificationItemProps) {
  const Icon = icons[notification.type];
  const dismissNotification = useEffectEvent(() => onDismiss(notification.id));

  useEffect(() => {
    const timeoutId = window.setTimeout(() => dismissNotification(), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timeoutId);
  }, [notification.id]);

  return (
    <motion.li
      layout
      initial={{ opacity: 0, x: 32, y: 18, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 24, y: 12, scale: 0.96 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      role={notification.type === "error" ? "alert" : "status"}
      className={mergeClasses(
        "pointer-events-auto relative overflow-hidden rounded-2xl border backdrop-blur-2xl shadow-2xl",
        "w-full max-w-sm bg-white/90 dark:bg-slate-950/88 dark:text-slate-100",
        shellStyles[notification.type],
      )}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/55 to-transparent dark:via-white/20" />

      <div className="flex items-start gap-3 p-4">
        <div
          className={mergeClasses(
            "mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/8 dark:bg-white/5",
            iconStyles[notification.type],
          )}
        >
          <Icon className="h-5 w-5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">
                {notification.title}
              </p>
              <p className="mt-1 text-sm leading-5 text-slate-600 dark:text-slate-300">
                {notification.message}
              </p>
            </div>

            <button
              type="button"
              onClick={() => onDismiss(notification.id)}
              className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-black/5 hover:text-slate-700 dark:hover:bg-white/8 dark:hover:text-slate-200"
              aria-label={`Dismiss ${notification.title}`}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {notification.action && (
            <button
              type="button"
              onClick={() => onAction?.(notification)}
              className={mergeClasses(
                "mt-3 inline-flex items-center rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors",
                actionStyles[notification.type],
              )}
            >
              {notification.action.label}
            </button>
          )}
        </div>
      </div>

      <motion.div
        className={mergeClasses(
          "absolute inset-x-0 bottom-0 h-1 origin-left",
          progressStyles[notification.type],
        )}
        initial={{ scaleX: 1 }}
        animate={{ scaleX: 0 }}
        transition={{ duration: AUTO_DISMISS_MS / 1000, ease: "linear" }}
      />
    </motion.li>
  );
}

export default function NotificationCenter({
  notifications,
  removeNotification,
  clearAll,
}: NotificationCenterProps) {
  const visibleNotifications = notifications.slice(-MAX_VISIBLE);

  const handleAction = useCallback(
    (notification: Notification) => {
      notification.action?.onClick();
      removeNotification(notification.id);
    },
    [removeNotification],
  );

  if (visibleNotifications.length === 0) {
    return null;
  }

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-3 sm:bottom-6 sm:right-6"
      aria-live="polite"
      aria-atomic="true"
    >
      {clearAll && visibleNotifications.length > 1 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          className="flex justify-end"
        >
          <button
            type="button"
            onClick={clearAll}
            className="pointer-events-auto rounded-full border border-slate-700/80 bg-slate-950/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-300 backdrop-blur-xl transition-colors hover:border-slate-600 hover:text-white"
          >
            Clear all
          </button>
        </motion.div>
      )}

      <AnimatePresence initial={false} mode="popLayout">
        {visibleNotifications.map((notification) => (
          <NotificationItem
            key={notification.id}
            notification={notification}
            onAction={handleAction}
            onDismiss={removeNotification}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
