/**
 * Shape of the `addNotification` function exposed by the
 * `useNotifications` hook in `@/components/ui/notification-center`.
 * Extracted so split hooks can type their dependency without
 * importing the hook itself.
 */
export type AddNotificationFn = (notification: {
  type: "success" | "error" | "info" | "warning";
  title: string;
  message: string;
}) => void;
