import { create } from "zustand";
import {
  clearStoredAuthToken,
  getStoredAuthToken,
  persistAuthToken,
} from "@/lib/auth/token-storage";

interface AuthState {
  token: string | null;
  isAuthenticated: boolean;
  setToken: (token: string) => void;
  clearToken: () => void;
}

const initialToken = getStoredAuthToken();

export const useAuthStore = create<AuthState>((set) => ({
  token: initialToken,
  isAuthenticated: Boolean(initialToken),
  setToken: (token: string) => {
    persistAuthToken(token);
    set({ token, isAuthenticated: true });
  },
  clearToken: () => {
    clearStoredAuthToken();
    set({ token: null, isAuthenticated: false });
  },
}));
