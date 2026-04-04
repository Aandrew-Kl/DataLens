"use client";

import {
  AUTH_TOKEN_COOKIE_NAME,
  AUTH_TOKEN_STORAGE_KEY,
} from "@/lib/auth/constants";

const AUTH_TOKEN_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function readCookie(name: string): string | null {
  if (!isBrowser()) {
    return null;
  }

  const prefix = `${name}=`;
  const cookie = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(prefix));

  if (!cookie) {
    return null;
  }

  return decodeURIComponent(cookie.slice(prefix.length));
}

function buildCookieAttributes(maxAgeSeconds: number): string {
  const attributes = [`Path=/`, `Max-Age=${maxAgeSeconds}`, "SameSite=Lax"];

  if (window.location.protocol === "https:") {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}

export function getStoredAuthToken(): string | null {
  if (!isBrowser()) {
    return null;
  }

  return (
    window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) ??
    readCookie(AUTH_TOKEN_COOKIE_NAME)
  );
}

export function persistAuthToken(token: string): void {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
  document.cookie = `${AUTH_TOKEN_COOKIE_NAME}=${encodeURIComponent(token)}; ${buildCookieAttributes(
    AUTH_TOKEN_COOKIE_MAX_AGE_SECONDS,
  )}`;
}

export function clearStoredAuthToken(): void {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  document.cookie = `${AUTH_TOKEN_COOKIE_NAME}=; ${buildCookieAttributes(0)}`;
}

