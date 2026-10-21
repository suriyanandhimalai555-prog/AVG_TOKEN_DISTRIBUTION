import type { Deposit } from "@/lib/managedTypes";
import AddressCell from "@/components/ui/AddressCell";
import TxHashLink from "@/components/ui/TxHashLink";
import TokenBadge from "./TokenBadge";
import { fmtDateTime, formatUnits, timeAgo } from "./format";
import { tdCls, thCls, useManagedTheme } from "./theme";

interface DepositFeedProps {
  deposits: Deposit[];
  /** Mainnet flag for BscScan links (derive from pool.network). */
  mainnet: boolean | ((d: Deposit) => boolean);
  loading?: boolean;
  /** Extra leading column (pool name) for the cross-pool feed. */
  poolNameOf?: (d: Deposit) => string | undefined;
  emptyText?: string;
}

/** F3: chronological incoming transfers: time, wallet, token, amount, from, tx. */
export default function DepositFeed({ deposits, mainnet, loading = false, poolNameOf, emptyText }: DepositFeedProps) {
  const { ink, soft, rowZebra, rowHover } = useManagedTheme();
  const cols = [...(poolNameOf ? ["Pool"] : []), "Time", "Wallet", "Token", "Amount", "From", "Tx"];
  const isMain = (d: Deposit): boolean => (typeof mainnet === "function" ? mainnet(d) : mainnet);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="border-b border-border">
            {cols.map((h) => (
              <th key={h} className={`${thCls} ${soft}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && deposits.length === 0 ? (
            <tr>
              <td colSpan={cols.length} className={`py-10 text-center text-[11px] uppercase tracking-widest ${soft}`}>
                Loading deposits…
              </td>
            </tr>
          ) : deposits.length === 0 ? (
            <tr>
              <td colSpan={cols.length} className={`py-10 text-center text-[11px] ${soft}`}>
                {emptyText ?? "No token deposits found yet. Native BNB arrives as a balance change and is not itemized."}
              </td>
            </tr>
          ) : (
            deposits.map((d, i) => (
              <tr key={d.id} className={`border-b border-border/50 ${i % 2 ? rowZebra : ""} ${rowHover}`}>
                {poolNameOf ? <td className={`${tdCls} ${ink}`}>{poolNameOf(d) ?? "—"}</td> : null}
                <td className={`${tdCls} whitespace-nowrap ${soft}`} title={fmtDateTime(d.blockTime ?? d.createdAt)}>
                  {timeAgo(d.blockTime ?? d.createdAt)}
                </td>
                <td className={tdCls}>
                  <AddressCell address={d.walletAddress} />
                </td>
                <td className={tdCls}>
                  <TokenBadge symbol={d.symbol} asset={d.asset} />
                </td>
                <td className={`${tdCls} whitespace-nowrap tabular-nums ${ink}`} title={`${formatUnits(d.amountWei, d.decimals, d.decimals)} ${d.symbol}`}>
                  +{formatUnits(d.amountWei, d.decimals)} {d.symbol}
                </td>
                <td className={tdCls}>
                  <AddressCell address={d.fromAddress} />
                </td>
                <td className={tdCls}>
                  <TxHashLink hash={d.txHash} mainnet={isMain(d)} />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
