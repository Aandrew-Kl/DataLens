"use client";

import { useEffect } from "react";
import WelcomeWizard from "@/components/onboarding/welcome-wizard";
import {
  useWelcomeWizard,
  WELCOME_WIZARD_REPLAY_EVENT,
} from "@/components/onboarding/use-welcome-wizard";
import { ToastProvider } from "@/components/ui/toast";

export default function WelcomeWizardHost() {
  const { open, closeWizard, showWizard } = useWelcomeWizard();

  useEffect(() => {
    const handleReplay = () => showWizard();
    window.addEventListener(WELCOME_WIZARD_REPLAY_EVENT, handleReplay);
    return () => window.removeEventListener(WELCOME_WIZARD_REPLAY_EVENT, handleReplay);
  }, [showWizard]);

  return (
    <ToastProvider>
      {open ? <WelcomeWizard open={open} onClose={closeWizard} /> : null}
    </ToastProvider>
  );
}
