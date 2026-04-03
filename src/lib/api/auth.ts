import { request, saveToken, clearToken } from "./client";
import type { AuthToken, UserInfo } from "./types";

export async function register(email: string, password: string): Promise<AuthToken> {
  const result = await request<AuthToken>("POST", "/api/v1/auth/register", { email, password });
  saveToken(result.access_token);
  return result;
}

export async function login(email: string, password: string): Promise<AuthToken> {
  const result = await request<AuthToken>("POST", "/api/v1/auth/login", { email, password });
  saveToken(result.access_token);
  return result;
}

export async function getMe(): Promise<UserInfo> {
  return request<UserInfo>("GET", "/api/v1/auth/me");
}

export function logout(): void {
  clearToken();
}
