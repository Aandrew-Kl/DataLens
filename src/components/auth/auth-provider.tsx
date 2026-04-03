"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { getMe, login as apiLogin, logout as apiLogout, register as apiRegister } from "@/lib/api/auth";
import type { UserInfo } from "@/lib/api/types";

interface AuthContextValue {
  user: UserInfo | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  register: (email: string, password: string) => Promise<void>;
}

interface AuthProviderProps {
  children: ReactNode;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = "datalens_token";

export default function AuthProvider({ children }: AuthProviderProps): React.ReactNode {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [, startTransition] = useTransition();

  const hydrateFromToken = useCallback(async () => {
    if (typeof window === "undefined") {
      startTransition(() => {
        setIsLoading(false);
      });
      return;
    }

    const hasToken = Boolean(window.localStorage.getItem(TOKEN_KEY));
    if (!hasToken) {
      startTransition(() => {
        setIsLoading(false);
      });
      return;
    }

    try {
      const currentUser = await getMe();
      startTransition(() => {
        setUser(currentUser);
      });
    } catch {
      apiLogout();
      startTransition(() => {
        setUser(null);
      });
    } finally {
      startTransition(() => {
        setIsLoading(false);
      });
    }
  }, []);

  useEffect(() => {
    void hydrateFromToken();
  }, [hydrateFromToken]);

  const handleLogin = useCallback(async (email: string, password: string) => {
    startTransition(() => {
      setIsLoading(true);
    });

    try {
      await apiLogin(email, password);
      const currentUser = await getMe();
      startTransition(() => {
        setUser(currentUser);
      });
    } catch (err) {
      startTransition(() => {
        setUser(null);
      });
      throw err;
    } finally {
      startTransition(() => {
        setIsLoading(false);
      });
    }
  }, []);

  const handleRegister = useCallback(async (email: string, password: string) => {
    startTransition(() => {
      setIsLoading(true);
    });

    try {
      await apiRegister(email, password);
      const currentUser = await getMe();
      startTransition(() => {
        setUser(currentUser);
      });
    } catch (err) {
      startTransition(() => {
        setUser(null);
      });
      throw err;
    } finally {
      startTransition(() => {
        setIsLoading(false);
      });
    }
  }, []);

  const handleLogout = useCallback(() => {
    apiLogout();
    startTransition(() => {
      setUser(null);
    });
  }, []);

  const contextValue = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      isLoading,
      login: handleLogin,
      logout: handleLogout,
      register: handleRegister,
    }),
    [user, isLoading, handleLogin, handleLogout, handleRegister],
  );

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
