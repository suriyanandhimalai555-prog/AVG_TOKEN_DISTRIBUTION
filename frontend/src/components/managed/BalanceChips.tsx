import type { BalanceEntry } from "@/lib/managedTypes";
import { formatUnits, isZeroWei } from "./format";
import { useManagedTheme } from "./theme";
import TokenIcon, { compareTokens } from "./TokenIcon";

interface BalanceChipsProps {
  balances: BalanceEntry[];
  /** Hide zero balances (default true); native BNB is always shown. */
  hideZero?: boolean;
  max?: number;
}

/** One chip per asset: "12.5 ABC". Uses symbol/decimals from the API. */
export default function BalanceChips({ balances, hideZero = true, max = 4 }: BalanceChipsProps) {
  const { ink, bgInset } = useManagedTheme();
  const visible = balances
    .filter((b) => !b.hidden && (!hideZero || b.asset === "native" || !isZeroWei(b.balanceWei)))
    .sort(compareTokens);
  if (visible.length === 0) return <span className="font-mono text-[11px] text-text-muted">—</span>;
  const shown = visible.slice(0, max);
  const rest = visible.length - shown.length;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {shown.map((b) => {
        const zero = isZeroWei(b.balanceWei);
        return (
          <span
            key={b.asset}
            className={`inline-flex items-center gap-1 rounded-md border border-border py-0.5 pl-0.5 pr-1.5 font-mono text-[11px] ${bgInset} ${zero ? "text-text-muted" : ink}`}
            title={`${formatUnits(b.balanceWei, b.decimals, b.decimals)} ${b.symbol}`}
          >
            <TokenIcon asset={b.asset} symbol={b.symbol} size={16} className={zero ? "opacity-60" : ""} />
            <span className="tabular-nums">{formatUnits(b.balanceWei, b.decimals, 4)}</span>
            <span className={`text-[10px] font-semibold uppercase ${b.asset === "native" ? "text-warning" : "text-accent"}`}>{b.symbol}</span>
          </span>
        );
      })}
      {rest > 0 ? <span className="font-mono text-[10px] text-text-muted">+{rest}</span> : null}
    </span>
  );
}
