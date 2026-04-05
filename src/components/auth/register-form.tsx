"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { register } from "@/lib/api/auth";

interface RegisterFormProps {
  redirectTo?: string;
  className?: string;
  title?: string;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || "Unable to create your account. Please try again.";
  }

  if (typeof error === "object" && error !== null) {
    if ("message" in error && typeof error.message === "string") {
      return error.message;
    }
  }

  return "Unable to create your account. Please try again.";
}

function buildAuthLink(pathname: string, redirectTo: string): string {
  if (redirectTo === "/") {
    return pathname;
  }

  return `${pathname}?redirect=${encodeURIComponent(redirectTo)}`;
}

export default function RegisterForm({
  redirectTo = "/",
  className = "",
  title = "Create your account",
}: RegisterFormProps): React.ReactNode {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTransitioning, startTransition] = useTransition();

  const validateForm = (): string | null => {
    if (password.length < 8) {
      return "Password must be at least 8 characters long.";
    }

    if (!/[A-Z]/.test(password)) {
      return "Password must contain at least one uppercase letter.";
    }

    if (!/[a-z]/.test(password)) {
      return "Password must contain at least one lowercase letter.";
    }

    if (!/[0-9]/.test(password)) {
      return "Password must contain at least one digit.";
    }

    if (password !== confirmPassword) {
      return "Passwords do not match.";
    }

    return null;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    const validationError = validateForm();
    if (validationError) {
      startTransition(() => {
        setError(validationError);
      });
      return;
    }

    startTransition(() => {
      setError(null);
      setSuccessMessage(null);
      setIsSubmitting(true);
    });

    try {
      await register(email.trim(), password);

      startTransition(() => {
        setSuccessMessage("Your account has been created. Redirecting to dashboard...");
        setIsSubmitting(false);
      });
      startTransition(() => {
        router.push(redirectTo);
      });
    } catch (err: unknown) {
      startTransition(() => {
        setIsSubmitting(false);
        setError(getErrorMessage(err));
      });
    }
  };

  const isBusy = isSubmitting || isTransitioning;

  return (
    <section
      className={`bg-white/75 backdrop-blur-2xl dark:bg-slate-950/45 border border-white/20 rounded-3xl p-8 shadow-xl shadow-slate-950/10 ${className}`}
    >
      <form onSubmit={(event) => void handleSubmit(event)} className="space-y-5">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">Create an account to unlock saved datasets and workflows.</p>
        </div>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">Email</span>
          <input
            type="email"
            name="email"
            autoComplete="email"
            value={email}
            onChange={(event): void => setEmail(event.target.value)}
            className="w-full rounded-xl border border-white/25 bg-white/60 px-4 py-3 text-slate-900 outline-none ring-0 transition focus:border-cyan-300 focus:shadow-sm focus:shadow-cyan-200 dark:bg-slate-900/60 dark:text-slate-100"
            placeholder="you@example.com"
            required
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">Password</span>
          <input
            type="password"
            name="password"
            autoComplete="new-password"
            value={password}
            onChange={(event): void => setPassword(event.target.value)}
            className="w-full rounded-xl border border-white/25 bg-white/60 px-4 py-3 text-slate-900 outline-none ring-0 transition focus:border-cyan-300 focus:shadow-sm focus:shadow-cyan-200 dark:bg-slate-900/60 dark:text-slate-100"
            placeholder="Min 8 chars, uppercase, lowercase, digit"
            required
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">Confirm password</span>
          <input
            type="password"
            name="confirmPassword"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event): void => setConfirmPassword(event.target.value)}
            className="w-full rounded-xl border border-white/25 bg-white/60 px-4 py-3 text-slate-900 outline-none ring-0 transition focus:border-cyan-300 focus:shadow-sm focus:shadow-cyan-200 dark:bg-slate-900/60 dark:text-slate-100"
            placeholder="Repeat your password"
            required
          />
        </label>

        {error ? (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        ) : null}

        {successMessage ? (
          <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
            {successMessage}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={isBusy}
          className="inline-flex w-full items-center justify-center rounded-xl bg-cyan-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isBusy ? (
            <span className="inline-flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/35 border-t-white" />
              Creating account...
            </span>
          ) : (
            "Create account"
          )}
        </button>
      </form>

      <p className="mt-5 text-sm text-slate-600 dark:text-slate-300">
        Already have an account?{" "}
        <Link
          href={buildAuthLink("/login", redirectTo)}
          className="font-semibold text-cyan-700 underline underline-offset-4 dark:text-cyan-300"
        >
          Login
        </Link>
      </p>
    </section>
  );
}
