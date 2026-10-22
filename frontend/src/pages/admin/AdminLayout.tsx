import { NavLink, Outlet } from "react-router-dom";
import { cn } from "@/lib/cn";
import { useAuth } from "@/hooks/useAuth";
import { useManagedEnabled } from "@/components/managed/client";

const links = [
  { to: "/admin", end: true, label: "Overview" },
  { to: "/admin/users", end: false, label: "Users" },
  { to: "/admin/payments", end: false, label: "Payments" },
];

/** Managed Wallets tabs: shown only to ADMIN and only when the backend reports the feature enabled. */
const managedLinks = [
  { to: "/admin/managed", end: false, label: "Managed" },
  { to: "/admin/treasury", end: false, label: "Treasury" },
];

export default function AdminLayout() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const managed = useManagedEnabled({ enabled: isAdmin });
  // Every ADMIN sees the tabs unless the server kill switch is set (404).
  const tabs = isAdmin && !managed.switchedOff ? [...links, ...managedLinks] : links;

  return (
    <div className="space-y-6">
      <nav className="flex flex-wrap gap-3 border-b border-[#1f1f23] pb-4">
        {tabs.map(({ to, end, label }) => (
          <NavLink
            key={to}
            end={end}
            to={to}
            className={({ isActive }) =>
              cn(
                "font-mono text-[11px] uppercase tracking-widest px-3 py-1 border rounded-none transition-colors border-transparent",
                isActive ? "text-[#00d4aa] border-[#00d4aa]" : "text-[#6b6b6b] hover:text-[#e8e8e8]"
              )
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
