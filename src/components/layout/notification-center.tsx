"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bell,
  CheckCheck,
  Info,
  ShieldAlert,
  TriangleAlert,
  X,
} from "lucide-react";
import { formatRelativeTime, generateId } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface NotificationCenterProps {
  tableName: string;
  columns: ColumnProfile[];
}

type NotificationTone = "success" | "error" | "info" | "warning";

interface NotificationItem {
  id: string;
  title: string;
  message: string;
  tone: NotificationTone;
  read: boolean;
  createdAt: number;
}

const EASE = [0.22, 1, 0.36, 1] as const;
const STORAGE_KEY = "datalens-notification-center";
const GLASS_PANEL_CLASS =
  "border border-white/20 bg-white/75 backdrop-blur-2xl dark:bg-slate-950/45";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function buildSeedNotifications(tableName: string, columns: ColumnProfile[]) {
  const now = Date.now();

  return [
    {
      id: generateId(),
      title: "Dataset ready",
      message: `${tableName} loaded with ${columns.length} profiled columns.`,
      tone: "success",
      read: false,
      createdAt: now - 4 * 60_000,
    },
    {
      id: generateId(),
      title: "Preview warning",
      message: "A few string columns contain mixed casing that may affect joins.",
      tone: "warning",
      read: false,
      createdAt: now - 24 * 60_000,
    },
    {
      id: generateId(),
      title: "Workspace tip",
      message: "Use the command palette to jump into exports, queries, and schema views.",
      tone: "info",
      read: true,
      createdAt: now - 55 * 60_000,
    },
  ] satisfies NotificationItem[];
}

function readNotifications(tableName: string, columns: ColumnProfile[]) {
  if (typeof window === "undefined") return buildSeedNotifications(tableName, columns);

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return buildSeedNotifications(tableName, columns);
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return buildSeedNotifications(tableName, columns);

    return parsed.flatMap<NotificationItem>((item) => {
      if (!isRecord(item)) return [];
      const tone: NotificationTone =
        item.tone === "success" || item.tone === "error" || item.tone === "warning"
          ? item.tone
          : "info";
      return [
        {
          id: typeof item.id === "string" ? item.id : generateId(),
          title: typeof item.title === "string" ? item.title : "Notification",
          message: typeof item.message === "string" ? item.message : "",
          tone,
          read: Boolean(item.read),
          createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now(),
        },
      ];
    });
  } catch {
    return buildSeedNotifications(tableName, columns);
  }
}

function getToneMeta(tone: NotificationTone) {
  if (tone === "success") {
    return {
      icon: CheckCheck,
      className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    };
  }

  if (tone === "error") {
    return {
      icon: ShieldAlert,
      className: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
    };
  }

  if (tone === "warning") {
    return {
      icon: TriangleAlert,
      className: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    };
  }

  return {
    icon: Info,
    className: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  };
}

export default function NotificationCenter({
  tableName,
  columns,
}: NotificationCenterProps) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>(() =>
    readNotifications(tableName, columns),
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications));
  }, [notifications]);

  useEffect(() => {
    if (!open) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.read).length,
    [notifications],
  );

  function handleMarkAsRead(notificationId: string) {
    setNotifications((currentNotifications) =>
      currentNotifications.map((notification) =>
        notification.id === notificationId
          ? { ...notification, read: true }
          : notification,
      ),
    );
  }

  function handleMarkAllAsRead() {
    setNotifications((currentNotifications) =>
      currentNotifications.map((notification) => ({ ...notification, read: true })),
    );
  }

  function handleClearAll() {
    setNotifications([]);
  }

  return (
    <>
      <button
        type="button"
        aria-label="Open notifications"
        onClick={() => setOpen(true)}
        className={`relative inline-flex items-center gap-3 rounded-2xl px-4 py-3 shadow-sm ${GLASS_PANEL_CLASS}`}
      >
        <Bell className="h-4 w-4 text-slate-700 dark:text-slate-200" />
        <span className="text-sm font-semibold text-slate-900 dark:text-white">
          Notifications
        </span>
        <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-cyan-600 px-2 text-xs font-semibold text-white">
          {unreadCount}
        </span>
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            className="fixed inset-0 z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <button
              type="button"
              aria-label="Close notifications"
              className="absolute inset-0 bg-slate-950/50 backdrop-blur-md"
              onClick={() => setOpen(false)}
            />

            <motion.aside
              initial={{ x: 420 }}
              animate={{ x: 0 }}
              exit={{ x: 420 }}
              transition={{ duration: 0.24, ease: EASE }}
              className={`absolute right-0 top-0 h-full w-full max-w-md p-4 shadow-[0_28px_90px_-52px_rgba(15,23,42,0.85)] ${GLASS_PANEL_CLASS}`}
            >
              <div className="flex h-full flex-col rounded-[1.75rem] border border-white/20 bg-white/55 p-5 dark:bg-slate-950/35">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-700 dark:text-cyan-300">
                      <Bell className="h-3.5 w-3.5" />
                      Notification center
                    </div>
                    <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
                      Recent workspace activity
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                      Monitor alerts and updates for {tableName}. {unreadCount} unread items remain.
                    </p>
                  </div>

                  <button
                    type="button"
                    aria-label="Close panel"
                    onClick={() => setOpen(false)}
                    className="rounded-2xl border border-white/20 bg-white/70 p-2.5 text-slate-700 dark:bg-slate-950/50 dark:text-slate-200"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handleMarkAllAsRead}
                    disabled={notifications.length === 0}
                    className="inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/70 px-4 py-2.5 text-sm font-semibold text-slate-800 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-950/45 dark:text-slate-100 dark:hover:bg-slate-950/60"
                  >
                    <CheckCheck className="h-4 w-4" />
                    Mark all read
                  </button>
                  <button
                    type="button"
                    onClick={handleClearAll}
                    disabled={notifications.length === 0}
                    className="inline-flex items-center gap-2 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-2.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:text-rose-300"
                  >
                    <X className="h-4 w-4" />
                    Clear all
                  </button>
                </div>

                <div className="mt-5 flex-1 space-y-3 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <div className="rounded-3xl border border-dashed border-white/25 bg-white/35 p-8 text-sm text-slate-600 dark:bg-slate-950/25 dark:text-slate-300">
                      No notifications in the queue. New export, query, and dataset events will
                      appear here.
                    </div>
                  ) : (
                    notifications.map((notification) => {
                      const toneMeta = getToneMeta(notification.tone);
                      const ToneIcon = toneMeta.icon;

                      return (
                        <div
                          key={notification.id}
                          className={`rounded-3xl border p-4 ${
                            notification.read
                              ? "border-white/20 bg-white/60 dark:bg-slate-950/35"
                              : "border-cyan-500/20 bg-cyan-500/10"
                          }`}
                        >
                          <div className="flex gap-3">
                            <div
                              className={`mt-1 flex h-10 w-10 items-center justify-center rounded-2xl ${toneMeta.className}`}
                            >
                              <ToneIcon className="h-4 w-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-semibold text-slate-950 dark:text-white">
                                    {notification.title}
                                  </p>
                                  <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                                    {notification.message}
                                  </p>
                                </div>
                                {!notification.read ? (
                                  <span className="rounded-full bg-cyan-600 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white">
                                    New
                                  </span>
                                ) : null}
                              </div>
                              <div className="mt-3 flex items-center justify-between gap-3">
                                <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                                  {formatRelativeTime(notification.createdAt)}
                                </p>
                                <button
                                  type="button"
                                  onClick={() => handleMarkAsRead(notification.id)}
                                  disabled={notification.read}
                                  className="text-sm font-semibold text-cyan-700 transition hover:text-cyan-600 disabled:cursor-not-allowed disabled:text-slate-400 dark:text-cyan-300 dark:hover:text-cyan-200"
                                >
                                  Mark as read
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </motion.aside>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
