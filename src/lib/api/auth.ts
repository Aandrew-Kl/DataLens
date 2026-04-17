import { request } from "./client";
import { useAuthStore } from "@/stores/auth-store";
import type { AuthToken, RegisterResponse, UserInfo } from "./types";

export async function register(email: string, password: string): Promise<RegisterResponse> {
  const result = await request<RegisterResponse>("POST", "/api/v1/auth/register", { email, password });
  useAuthStore.getState().setToken(result.access_token);
  return result;
}

export async function login(email: string, password: string): Promise<AuthToken> {
  const result = await request<AuthToken>("POST", "/api/v1/auth/login", { email, password });
  useAuthStore.getState().setToken(result.access_token);
  return result;
}

export async function getMe(): Promise<UserInfo> {
  return request<UserInfo>("GET", "/api/v1/auth/me");
}

export function logout(): void {
  useAuthStore.getState().clearToken();
}
