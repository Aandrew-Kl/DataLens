"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { login } from "@/lib/api/auth";

interface LoginFormProps {
  redirectTo?: string;
  className?: string;
  title?: string;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || "Login failed. Please try again.";
  }

  if (typeof error === "object" && error !== null) {
    if ("message" in error && typeof error.message === "string") {
      return error.message;
    }
  }

  return "Login failed. Please try again.";
}

function buildAuthLink(pathname: string, redirectTo: string): string {
  if (redirectTo === "/") {
    return pathname;
  }

  return `${pathname}?redirect=${encodeURIComponent(redirectTo)}`;
}

export default function LoginForm({
  redirectTo = "/",
  className = "",
  title = "Welcome back",
}: LoginFormProps): React.ReactNode {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTransitioning, startTransition] = useTransition();

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    startTransition(() => {
      setError(null);
      setIsSubmitting(true);
    });

    try {
      await login(email.trim(), password);

      startTransition(() => {
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
          <p className="text-sm text-slate-600 dark:text-slate-300">Sign in to continue to DataLens.</p>
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
            autoComplete="current-password"
            value={password}
            onChange={(event): void => setPassword(event.target.value)}
            className="w-full rounded-xl border border-white/25 bg-white/60 px-4 py-3 text-slate-900 outline-none ring-0 transition focus:border-cyan-300 focus:shadow-sm focus:shadow-cyan-200 dark:bg-slate-900/60 dark:text-slate-100"
            placeholder="Enter your password"
            required
          />
        </label>

        {error ? (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
            {error}
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
              Signing in...
            </span>
          ) : (
            "Sign in"
          )}
        </button>
      </form>

      <p className="mt-5 text-sm text-slate-600 dark:text-slate-300">
        Don&apos;t have an account?{" "}
        <Link
          href={buildAuthLink("/register", redirectTo)}
          className="font-semibold text-cyan-700 underline underline-offset-4 dark:text-cyan-300"
        >
          Register
        </Link>
      </p>
    </section>
  );
}
