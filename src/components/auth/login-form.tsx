"use client";

import { useCallback, useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { login } from "@/lib/api/auth";

interface LoginFormProps {
  redirectTo?: string;
  className?: string;
  title?: string;
}

const RATE_LIMIT_COOLDOWN_SECONDS = 60;

function isRateLimitError(error: unknown): boolean {
  if (error && typeof error === "object" && "status" in error) {
    return (error as { status: number }).status === 429;
  }

  return false;
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
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startCooldown = useCallback(() => {
    if (cooldownRef.current) {
      clearInterval(cooldownRef.current);
    }

    setCooldownSeconds(RATE_LIMIT_COOLDOWN_SECONDS);

    cooldownRef.current = setInterval(() => {
      setCooldownSeconds((prev) => {
        if (prev <= 1) {
          if (cooldownRef.current) {
            clearInterval(cooldownRef.current);
            cooldownRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1_000);
  }, []);

  useEffect(() => {
    return () => {
      if (cooldownRef.current) {
        clearInterval(cooldownRef.current);
      }
    };
  }, []);

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

      if (isRateLimitError(err)) {
        startCooldown();
      }
    }
  };

  const isRateLimited = cooldownSeconds > 0;
  const isBusy = isSubmitting || isTransitioning;

  return (
    <section
      className={`bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg p-8 ${className}`}
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
            className="w-full rounded-md border border-zinc-300 bg-white px-4 py-3 text-zinc-900 outline-none ring-0 transition-colors focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-400"
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
            className="w-full rounded-md border border-zinc-300 bg-white px-4 py-3 text-zinc-900 outline-none ring-0 transition-colors focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-400"
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
          disabled={isBusy || isRateLimited}
          className="inline-flex w-full items-center justify-center rounded-md bg-zinc-900 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {isBusy ? (
            <span className="inline-flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/35 border-t-white" />
              Signing in...
            </span>
          ) : isRateLimited ? (
            `Try again in ${cooldownSeconds}s`
          ) : (
            "Sign in"
          )}
        </button>
      </form>

      <p className="mt-5 text-sm text-slate-600 dark:text-slate-300">
        Don&apos;t have an account?{" "}
        <Link
          href={buildAuthLink("/register", redirectTo)}
          className="font-medium text-zinc-900 underline underline-offset-4 dark:text-zinc-100"
        >
          Register
        </Link>
      </p>
    </section>
  );
}
