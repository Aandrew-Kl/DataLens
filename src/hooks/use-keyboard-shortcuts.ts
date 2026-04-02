"use client";

import { useEffect, useRef, useMemo } from "react";

/** Describes a single keyboard shortcut binding. */
export interface Shortcut {
  /** The key to match (case-insensitive), e.g. `"k"`, `"Enter"`, `"/"`. */
  key: string;
  /** Require the Ctrl key. */
  ctrl?: boolean;
  /** Require the Meta (Cmd) key. */
  meta?: boolean;
  /** Require the Shift key. */
  shift?: boolean;
  /** Callback invoked when the shortcut fires. */
  handler: () => void;
  /** Human-readable description shown in the help dialog. */
  description: string;
}

/** Tags whose focused state should suppress shortcut handling. */
const IGNORED_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * Returns `true` when the user's focus is inside an element where freeform
 * text entry is expected (inputs, textareas, contenteditable regions).
 */
function isTyping(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  if (IGNORED_TAGS.has(el.tagName)) return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

/**
 * Registers global keyboard shortcuts that are active while the component is
 * mounted. Shortcuts are automatically ignored when the user is typing in an
 * input, textarea, select, or contenteditable element.
 *
 * Both `ctrl` and `meta` modifiers are checked so that shortcuts work with
 * either Ctrl (Windows/Linux) or Cmd (macOS).
 *
 * @param shortcuts - The list of shortcut bindings to register.
 */
export function useKeyboardShortcuts(shortcuts: Shortcut[]): void {
  // Store shortcuts in a ref so the event handler always sees the latest list
  // without needing to re-attach the listener.
  const shortcutsRef = useRef(shortcuts);
  useEffect(() => {
    shortcutsRef.current = shortcuts;
  });

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (isTyping()) return;

      for (const shortcut of shortcutsRef.current) {
        const keyMatch =
          e.key.toLowerCase() === shortcut.key.toLowerCase();
        if (!keyMatch) continue;

        // When ctrl or meta is required, accept either modifier so
        // Ctrl+K and Cmd+K both work regardless of platform.
        const modRequired = shortcut.ctrl || shortcut.meta;
        const modPressed = e.ctrlKey || e.metaKey;
        if (modRequired && !modPressed) continue;
        if (!modRequired && modPressed) continue;

        const shiftRequired = shortcut.shift ?? false;
        if (shiftRequired !== e.shiftKey) continue;

        e.preventDefault();
        shortcut.handler();
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}

/**
 * Returns a stable, read-only snapshot of the currently registered shortcuts
 * for rendering in a help / cheat-sheet dialog.
 *
 * @param shortcuts - The same shortcuts array passed to `useKeyboardShortcuts`.
 * @returns An array of `{ key, modifiers, description }` objects.
 */
export function useKeyboardShortcutsHelp(shortcuts: Shortcut[]) {
  return useMemo(
    () =>
      shortcuts.map((s) => {
        const parts: string[] = [];
        if (s.ctrl || s.meta) parts.push("Ctrl/Cmd");
        if (s.shift) parts.push("Shift");
        parts.push(s.key.length === 1 ? s.key.toUpperCase() : s.key);

        return {
          key: s.key,
          modifiers: parts.slice(0, -1).join("+"),
          combo: parts.join("+"),
          description: s.description,
        };
      }),
    [shortcuts],
  );
}
