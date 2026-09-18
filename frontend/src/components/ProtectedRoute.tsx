import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";

interface Props {
  children: ReactNode;
  requirePlan?: boolean;
  requireAdmin?: boolean;
}

export default function ProtectedRoute({ children, requirePlan = true, requireAdmin = false }: Props) {
  const { user, subscription, loading } = useAuth();
  const location = useLocation();

  useBodyScrollLock(loading);

  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-terminal font-sans text-text-primary">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          <p className="text-xs uppercase tracking-wider text-text-muted">Loading session</p>
        </div>
      </div>
    );
  }

  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  if (requireAdmin && user.role !== "ADMIN") {
    return <Navigate to="/dashboard" replace />;
  }

  const isAdmin = user.role === "ADMIN";

  if (requirePlan !== false && !isAdmin && subscription?.status !== "ACTIVE") {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}
