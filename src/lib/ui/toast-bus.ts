export type ToastVariant = "success" | "error" | "warning" | "info";

export interface ToastPayload {
  message: string;
  variant?: ToastVariant;
  duration?: number;
}

export interface ToastEvent extends Required<ToastPayload> {}

type ToastListener = (toast: ToastEvent) => void;

const listeners = new Set<ToastListener>();

export function addToast({
  message,
  variant = "info",
  duration = 4000,
}: ToastPayload): void {
  const toast: ToastEvent = { message, variant, duration };
  listeners.forEach((listener) => listener(toast));
}

export function subscribeToToasts(listener: ToastListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
