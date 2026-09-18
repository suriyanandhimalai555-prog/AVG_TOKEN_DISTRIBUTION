import { useMemo, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Settings,
  Layers,
  List,
  Play,
  Download,
  History,
  UserCircle,
  Shield,
} from "lucide-react";
import toast from "react-hot-toast";
import { store } from "@/lib/store";
import { cn } from "@/lib/cn";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/theme/ThemeProvider";
import { ThemeToggleButton } from "@/components/ThemeToggleButton";

const NAV_ITEMS = [
  { to: "/dashboard/setup", icon: Settings, label: "SETUP", requiresPlan: false },
  { to: "/dashboard/generate", icon: Layers, label: "GENERATE", requiresPlan: true },
  { to: "/dashboard/plan", icon: List, label: "PLAN", requiresPlan: true },
  { to: "/dashboard/distribute", icon: Play, label: "DISTRIBUTE", requiresPlan: true },
  { to: "/dashboard/results", icon: Download, label: "RESULTS", requiresPlan: false },
  { to: "/dashboard/history", icon: History, label: "HISTORY", requiresPlan: false },
] as const;

function initials(name: string | undefined | null): string {
  const p = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (p.length === 0) return "?";
  return (p[0][0] ?? "?").toUpperCase() + ((p[1]?.[0] ?? "") as string).toUpperCase();
}

export default function Sidebar() {
  const [expanded, setExpanded] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const sessionId = store.getSessionId();
  const { user, subscription } = useAuth();
  const { theme } = useTheme();

  const planActive = subscription?.status === "ACTIVE";
  const canAccessPlanFeatures = planActive || user?.role === "ADMIN";

  const toastStyle = useMemo(
    () => ({
      style: {
        background: theme === "dark" ? "#111827" : "#ffffff",
        color: theme === "dark" ? "#fafafa" : "#282828",
        border:
          theme === "dark"
            ? "1px solid rgba(250, 250, 250, 0.12)"
            : "1px solid rgba(40, 40, 40, 0.12)",
        fontFamily: "Poppins, system-ui, sans-serif",
        borderRadius: "12px",
      },
    }),
    [theme]
  );

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-50 flex h-full flex-col border-r border-[var(--app-border)] bg-[var(--app-surface)] transition-[width,box-shadow] duration-200 ease-in-out shadow-sm/30",
        expanded ? "w-52" : "w-14"
      )}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      <div className="flex h-14 items-center gap-2 overflow-hidden border-b border-[var(--app-border)] px-3">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-accent to-accent-light shadow-sm">
          <span className="text-[10px] font-bold text-white">A</span>
        </div>
        {expanded && user ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="h-7 w-7 flex-shrink-0 overflow-hidden rounded-full border border-[var(--app-border)] bg-[var(--app-panel)]">
              {user.avatar ? (
                <img src={user.avatar} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[10px] font-semibold text-accent">
                  {initials(user.name)}
                </div>
              )}
            </div>
            <div className="min-w-0">
            <p className="max-w-[140px] truncate text-[11px] font-medium text-[var(--app-text)]">{user.name}</p>
              {canAccessPlanFeatures ? (
                <span className="inline-flex rounded-md border border-accent/40 bg-accent-dim px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent-light">
                  {user?.role === "ADMIN" ? "ADMIN" : subscription?.planKey}
                </span>
              ) : (
                <button
                  type="button"
                  className="rounded-md border border-danger px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-danger"
                  onClick={() => navigate("/onboarding")}
                >
                  NO PLAN
                </button>
              )}
            </div>
          </div>
        ) : expanded ? (
          <span className="ml-1 whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-[var(--app-text)]">
            AVG
          </span>
        ) : null}
      </div>

      <nav className="flex flex-1 flex-col gap-1 py-4">
        {NAV_ITEMS.map(({ to, icon: Icon, label, requiresPlan }) => {
          const isActive = location.pathname === to;
          return (
            <NavLink
              key={to}
              to={to}
              onClick={(e) => {
                if (
                  requiresPlan &&
                  !canAccessPlanFeatures
                ) {
                  e.preventDefault();
                  toast.error("No active plan. Upgrade to continue.", toastStyle);
                }
              }}
              className={cn(
                "relative flex h-10 items-center gap-3 px-4 transition-colors duration-150",
                "text-[var(--app-muted)] hover:bg-[var(--app-panel)] hover:text-[var(--app-text)]",
                isActive && "border-l-2 border-accent bg-[var(--app-accent-dim)] text-accent"
              )}
            >
              {isActive && !expanded && (
                <span className="absolute left-0 top-0 h-full w-0.5 bg-accent" />
              )}
              <Icon size={16} className="flex-shrink-0" />
              {expanded && (
                <span className="text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap">
                  {label}
                </span>
              )}
            </NavLink>
          );
        })}

        <div className="mx-3 my-2 border-t border-[var(--app-border)]" />

        <NavLink
          to="/account"
          className={cn(
            "relative flex h-10 items-center gap-3 px-4 transition-colors duration-150",
            "text-[var(--app-muted)] hover:bg-[var(--app-panel)] hover:text-[var(--app-text)]",
            location.pathname === "/account" && "border-l-2 border-accent bg-[var(--app-accent-dim)] text-accent"
          )}
        >
          <UserCircle size={18} className="flex-shrink-0" />
          {expanded && (
            <span className="text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap">Account</span>
          )}
        </NavLink>

        {user?.role === "ADMIN" && (
          <NavLink
            to="/admin"
            className={cn(
              "relative flex h-10 items-center gap-3 px-4 transition-colors duration-150",
              "text-[var(--app-muted)] hover:bg-[var(--app-panel)] hover:text-[var(--app-text)]",
              location.pathname.startsWith("/admin") && "border-l-2 border-accent bg-[var(--app-accent-dim)] text-accent"
            )}
          >
            <Shield size={18} className="flex-shrink-0" />
            {expanded && (
              <span className="text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap">Admin</span>
            )}
          </NavLink>
        )}
      </nav>

      <div className="mt-auto border-t border-[var(--app-border)] px-2 py-3">
        <div className={cn("flex", expanded ? "justify-start px-2" : "justify-center")}>
          <ThemeToggleButton showLabel={expanded} />
        </div>
      </div>

      <div className="border-t border-[var(--app-border)] p-4 overflow-hidden">
        {sessionId ? (
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 flex-shrink-0 animate-pulse-slow rounded-full bg-success" />
            {expanded && (
              <span className="truncate font-mono text-[10px] text-[var(--app-muted)]">
                {sessionId.slice(-8)}
              </span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[var(--app-muted)]" />
            {expanded && (
              <span className="font-mono text-[10px] text-[var(--app-muted)]">NO SESSION</span>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
