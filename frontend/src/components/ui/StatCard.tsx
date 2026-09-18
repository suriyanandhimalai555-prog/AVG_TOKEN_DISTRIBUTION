import { useTheme } from "@/theme/ThemeProvider";

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  accent?: boolean;
  className?: string;
}

export default function StatCard({ label, value, sub, accent, className = "" }: StatCardProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const bgLift = isDark ? "bg-[#111827]" : "bg-white";
  const ink = isDark ? "text-[#fafafa]" : "text-[#282828]";

  return (
    <div className={`border border-border p-4 ${bgLift} ${className}`}>
      <p className="text-[11px] uppercase tracking-widest text-text-muted font-mono">{label}</p>
      <p className={`text-3xl font-mono font-bold mt-1 ${accent ? "text-accent" : ink}`}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      {sub && <p className="text-xs text-text-muted mt-1 font-mono">{sub}</p>}
    </div>
  );
}
