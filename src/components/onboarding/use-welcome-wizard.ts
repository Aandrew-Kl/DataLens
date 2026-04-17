"use client";

import { useCallback, useState } from "react";

const STORAGE_KEY = "datalens.onboarding.completed";
export const WELCOME_WIZARD_REPLAY_EVENT = "datalens:welcome-tour-replay";

function clearCompletionFlag() {
  window.localStorage.removeItem(STORAGE_KEY);
}

export function replayWelcomeTour() {
  if (typeof window === "undefined") return;
  clearCompletionFlag();
  window.dispatchEvent(new Event(WELCOME_WIZARD_REPLAY_EVENT));
}

export function useWelcomeWizard() {
  const [open, setOpen] = useState(
    () =>
      typeof window !== "undefined" &&
      !window.localStorage.getItem(STORAGE_KEY),
  );

  const closeWizard = useCallback(() => {
    window.localStorage.setItem(STORAGE_KEY, "true");
    setOpen(false);
  }, []);

  const showWizard = useCallback(() => {
    clearCompletionFlag();
    setOpen(true);
  }, []);

  return { open, closeWizard, showWizard };
}
