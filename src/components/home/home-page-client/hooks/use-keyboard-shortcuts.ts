import { useEffect } from "react";

interface KeyboardShortcutsOptions {
  canUpload: boolean;
  onToggleCommandPalette: () => void;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  onOpenUploader: () => void;
  onToggleShortcuts: () => void;
  onCloseAll: () => void;
}

/**
 * Registers the global Cmd/Ctrl-based shortcuts. Typing in inputs or
 * textareas suppresses every shortcut except Cmd/Ctrl+K.
 */
export function useKeyboardShortcuts({
  canUpload,
  onToggleCommandPalette,
  onToggleTheme,
  onOpenSettings,
  onOpenUploader,
  onToggleShortcuts,
  onCloseAll,
}: KeyboardShortcutsOptions) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;

      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        if (!(mod && event.key === "k")) {
          return;
        }
      }

      if (mod && event.key === "k") {
        event.preventDefault();
        onToggleCommandPalette();
      } else if (mod && event.key === "d") {
        event.preventDefault();
        onToggleTheme();
      } else if (mod && event.key === ",") {
        event.preventDefault();
        onOpenSettings();
      } else if (mod && event.key === "n") {
        event.preventDefault();
        if (canUpload) {
          onOpenUploader();
        }
      } else if (mod && event.key === "/") {
        event.preventDefault();
        onToggleShortcuts();
      } else if (event.key === "Escape") {
        onCloseAll();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    canUpload,
    onCloseAll,
    onOpenSettings,
    onOpenUploader,
    onToggleCommandPalette,
    onToggleShortcuts,
    onToggleTheme,
  ]);
}
