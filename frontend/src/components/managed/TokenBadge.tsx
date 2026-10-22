import { NATIVE_ASSET, type Asset } from "@/lib/managedTypes";
import TokenIcon from "./TokenIcon";

interface TokenBadgeProps {
  symbol: string;
  asset?: Asset;
  /** Spam-flagged tokens render muted. */
  hidden?: boolean;
  size?: "xs" | "sm";
}

/** Pill with the token's logo and symbol; native BNB gets the warm tint. */
export default function TokenBadge({ symbol, asset, hidden = false, size = "xs" }: TokenBadgeProps) {
  const native = asset === NATIVE_ASSET || (!asset && (symbol === "BNB" || symbol === "tBNB"));
  const tone = hidden
    ? "border-border text-text-muted line-through"
    : native
      ? "border-warning/40 bg-warning/10 text-warning"
      : "border-accent/40 bg-accent/10 text-accent dark:text-accent-light";
  const pad = size === "sm" ? "py-0.5 pl-0.5 pr-2 text-[11px]" : "py-px pl-px pr-1.5 text-[10px]";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-mono font-semibold uppercase tracking-wide ${pad} ${tone}`}
      title={asset && asset !== NATIVE_ASSET ? asset : undefined}
    >
      <TokenIcon asset={asset ?? (native ? NATIVE_ASSET : undefined)} symbol={symbol} size={size === "sm" ? 16 : 14} className={hidden ? "opacity-50 grayscale" : ""} />
      {symbol}
    </span>
  );
}
