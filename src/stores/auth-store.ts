import { create } from 'zustand';

interface AuthState {
  token: string | null;
  isAuthenticated: boolean;
  setToken: (token: string) => void;
  clearToken: () => void;
}

const TOKEN_KEY = 'datalens_token';

export const useAuthStore = create<AuthState>((set) => ({
  token: typeof window !== 'undefined' ? window.localStorage.getItem(TOKEN_KEY) : null,
  isAuthenticated: typeof window !== 'undefined' ? Boolean(window.localStorage.getItem(TOKEN_KEY)) : false,
  setToken: (token: string) => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(TOKEN_KEY, token);
    }
    set({ token, isAuthenticated: true });
  },
  clearToken: () => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(TOKEN_KEY);
    }
    set({ token: null, isAuthenticated: false });
  },
}));
