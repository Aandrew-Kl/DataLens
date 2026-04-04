import type { ApiError } from "./types";
import { useAuthStore } from "@/stores/auth-store";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

function getToken(): string | null {
  return useAuthStore.getState().token;
}

export async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const token = getToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    useAuthStore.getState().clearToken();
    throw { status: 401, message: "Unauthorized" } satisfies ApiError;
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw {
      status: res.status,
      message: err.detail ?? res.statusText,
      detail: err.detail,
    } satisfies ApiError;
  }

  return res.json() as Promise<T>;
}

export async function uploadFile<T>(path: string, file: File): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw {
      status: res.status,
      message: err.detail ?? res.statusText,
    } satisfies ApiError;
  }

  return res.json() as Promise<T>;
}
