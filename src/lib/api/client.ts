import { ApiError } from "./types";
import { useAuthStore } from "@/stores/auth-store";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const DEFAULT_TIMEOUT_MS = resolveTimeoutMs(
  Number(process.env.NEXT_PUBLIC_API_TIMEOUT_MS ?? 30_000)
);
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;

export interface RequestOptions {
  timeoutMs?: number;
}

function getToken(): string | null {
  return useAuthStore.getState().token;
}

function resolveTimeoutMs(timeoutMs: number): number {
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30_000;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function formatTimeoutSeconds(timeoutMs: number): string {
  const seconds = Math.ceil(timeoutMs / 1_000);
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

function isRetriableError(error: ApiError): boolean {
  return error.status === 0 || error.status === 408 || error.status >= 500;
}

function getErrorMessage(body: unknown, fallback: string): string {
  if (typeof body === "string" && body.trim()) {
    return body;
  }

  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;

    for (const key of ["message", "detail", "error"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        return value;
      }
    }
  }

  return fallback;
}

async function readResponseBody(response: Response): Promise<unknown> {
  const clone = typeof response.clone === "function" ? response.clone() : null;

  if (typeof response.json === "function") {
    try {
      return await response.json();
    } catch {
      // Fall through to text parsing when JSON decoding fails.
    }
  }

  if (clone && typeof clone.text === "function") {
    try {
      const text = await clone.text();
      return text || null;
    } catch {
      return null;
    }
  }

  return null;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

function normalizeTransportError(error: unknown, timeoutMs: number): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (isAbortError(error)) {
    return new ApiError(
      408,
      `Request timed out after ${formatTimeoutSeconds(timeoutMs)}.`,
      null
    );
  }

  if (error instanceof Error) {
    return new ApiError(0, error.message || "Network request failed.", null);
  }

  return new ApiError(0, "Network request failed.", null);
}

async function getSuccessfulResponse(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, init, timeoutMs);

      if (response.status === 401) {
        const body = await readResponseBody(response);
        useAuthStore.getState().clearToken();
        throw new ApiError(401, "Unauthorized", body);
      }

      if (!response.ok) {
        const body = await readResponseBody(response);
        throw new ApiError(
          response.status,
          getErrorMessage(body, response.statusText),
          body
        );
      }

      return response;
    } catch (error) {
      const apiError = normalizeTransportError(error, timeoutMs);

      if (attempt === RETRY_DELAYS_MS.length || !isRetriableError(apiError)) {
        throw apiError;
      }

      await delay(RETRY_DELAYS_MS[attempt]);
    }
  }

  throw new ApiError(0, "Network request failed.", null);
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options: RequestOptions = {}
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const token = getToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const timeoutMs = resolveTimeoutMs(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const response = await getSuccessfulResponse(
    `${BASE_URL}${path}`,
    {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    },
    timeoutMs
  );

  return parseJsonResponse<T>(response);
}

export async function uploadFile<T>(
  path: string,
  file: File,
  options: RequestOptions = {}
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const form = new FormData();
  form.append("file", file);

  const timeoutMs = resolveTimeoutMs(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const response = await getSuccessfulResponse(
    `${BASE_URL}${path}`,
    {
      method: "POST",
      headers,
      body: form,
    },
    timeoutMs
  );

  return parseJsonResponse<T>(response);
}
