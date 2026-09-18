import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import { api } from "@/lib/api";
import type { AuthSubscription, AuthUser } from "@/lib/authTypes";

interface AuthState {
  user: AuthUser | null;
  subscription: AuthSubscription | null;
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  refetch: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [subscription, setSubscription] = useState<AuthSubscription | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchMe = useCallback(async () => {
    try {
      const { data } = await api.get<{ user?: AuthUser; subscription?: AuthSubscription | null }>("/api/auth/me");
      setUser(data.user ?? null);
      setSubscription(data.subscription ?? null);
    } catch {
      setUser(null);
      setSubscription(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchMe();
  }, [fetchMe]);

  return (
    <AuthContext.Provider value={{ user, subscription, loading, refetch: fetchMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuthContext must be used within AuthProvider");
  return ctx;
}
