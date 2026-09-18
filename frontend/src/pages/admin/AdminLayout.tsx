import { NavLink, Outlet } from "react-router-dom";
import { cn } from "@/lib/cn";

const links = [
  { to: "/admin", end: true, label: "Overview" },
  { to: "/admin/users", end: false, label: "Users" },
  { to: "/admin/payments", end: false, label: "Payments" },
];

export default function AdminLayout() {
  return (
    <div className="space-y-6">
      <nav className="flex flex-wrap gap-3 border-b border-[#1f1f23] pb-4">
        {links.map(({ to, end, label }) => (
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
