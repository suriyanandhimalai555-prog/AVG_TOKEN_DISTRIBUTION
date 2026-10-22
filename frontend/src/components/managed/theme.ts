/**
 * Theme-aware class helpers shared by the Managed Wallets admin UI.
 * Mirrors the ink/bgInset pattern used by SetupPage and DistributePage so
 * light and dark both stay readable on tinted cards.
 */
import { useTheme } from "@/theme/ThemeProvider";

export interface ManagedTheme {
  isDark: boolean;
  /** Primary body / heading ink. */
  ink: string;
  /** Secondary labels. */
  soft: string;
  /** Inset / raised block background. */
  bgInset: string;
  /** Cell background inside insets. */
  bgCell: string;
  hoverInset: string;
  rowZebra: string;
  rowHover: string;
  /** Idle status dot. */
  dotIdle: string;
}

export function useManagedTheme(): ManagedTheme {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  return {
    isDark,
    ink: isDark ? "text-[#fafafa]" : "text-[#282828]",
    soft: isDark ? "text-[#c4c8d0]" : "text-[#525252]",
    bgInset: isDark ? "bg-[#1e293b]" : "bg-[#f4f4f5]",
    bgCell: isDark ? "bg-[#111827]" : "bg-white",
    hoverInset: isDark ? "hover:bg-[#334155]" : "hover:bg-[#e2e8f0]",
    rowZebra: isDark ? "bg-[#0f172a]/50" : "bg-[#f4f6f9]",
    rowHover: isDark ? "hover:bg-[#1e293b]" : "hover:bg-[#eef1f4]",
    dotIdle: isDark ? "bg-[#64748b]" : "bg-[#94a3b8]",
  };
}

/** Shared class strings. */
export const inputCls = "app-input dash-input font-mono py-2 text-sm";
export const selectCls = "app-input dash-input cursor-pointer py-2 pl-2.5 pr-8 text-xs font-medium";
export const primaryBtn = "btn-gradient-primary justify-center px-4 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40";
export const outlineBtn = "btn-outline-blue justify-center px-4 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40";
export const ghostBtn =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[11px] font-medium text-text-secondary transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40";
export const dangerBtn =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-danger/60 px-3 py-1.5 text-[11px] font-medium text-danger transition-colors hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-40";
export const thCls = "text-left py-2 px-3 text-[10px] uppercase tracking-widest font-normal whitespace-nowrap";
export const tdCls = "py-2 px-3 align-middle";
