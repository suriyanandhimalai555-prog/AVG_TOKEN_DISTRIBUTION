import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/theme/ThemeProvider";
import { cn } from "@/lib/cn";

export function ThemeToggleButton({
  className,
  showLabel,
}: {
  className?: string;
  /** When true, shows the target mode text (e.g. "Light" while in dark) next to the icon on `sm+`. */
  showLabel?: boolean;
}) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";
  const label = isDark ? "Light" : "Dark";
  const title = isDark ? "Switch to light mode" : "Switch to dark mode";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={title}
      title={title}
      onClick={toggleTheme}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-panel)]/70 p-2 text-[var(--app-muted)] shadow-sm transition-colors",
        "hover:bg-[var(--app-panel)] hover:text-[var(--app-text)]",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--app-ring-offset)]",
        showLabel && "px-2.5 sm:px-3",
        className
      )}
    >
      {isDark ? <Sun size={18} strokeWidth={1.75} aria-hidden /> : <Moon size={18} strokeWidth={1.75} aria-hidden />}
      {showLabel && (
        <span className="hidden text-[10px] font-semibold uppercase tracking-wider text-[var(--app-text)] sm:inline">
          {label}
        </span>
      )}
    </button>
  );
}
