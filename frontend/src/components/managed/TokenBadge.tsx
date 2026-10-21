import { NATIVE_ASSET, type Asset } from "@/lib/managedTypes";

interface TokenBadgeProps {
  symbol: string;
  asset?: Asset;
  /** Spam-flagged tokens render muted. */
  hidden?: boolean;
  size?: "xs" | "sm";
}

/** Small pill for a token symbol; native BNB gets the accent tint. */
export default function TokenBadge({ symbol, asset, hidden = false, size = "xs" }: TokenBadgeProps) {
  const native = asset === NATIVE_ASSET || (!asset && (symbol === "BNB" || symbol === "tBNB"));
  const tone = hidden
    ? "border-border text-text-muted line-through"
    : native
      ? "border-warning/40 bg-warning/10 text-warning"
      : "border-accent/40 bg-accent/10 text-accent dark:text-accent-light";
  const pad = size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-1.5 py-px text-[10px]";
  return (
    <span className={`inline-flex items-center rounded-full border font-mono font-semibold uppercase tracking-wide ${pad} ${tone}`} title={asset && asset !== NATIVE_ASSET ? asset : undefined}>
      {symbol}
    </span>
  );
}
