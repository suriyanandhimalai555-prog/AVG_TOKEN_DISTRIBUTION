import { RotateCcw, Eye } from "lucide-react";
import type { Network, TransferJob } from "@/lib/managedTypes";
import AddressCell from "@/components/ui/AddressCell";
import StatusBadge from "@/components/ui/StatusBadge";
import TxHashLink from "@/components/ui/TxHashLink";
import TokenBadge from "./TokenBadge";
import { badgeStatus, formatUnits, isMainnet, timeAgo } from "./format";
import { ghostBtn, tdCls, thCls, useManagedTheme } from "./theme";

interface TransferJobsTableProps {
  jobs: TransferJob[];
  loading?: boolean;
  /** Resolve the pool network for BscScan links. */
  networkOf: (poolId: string) => Network | undefined;
  poolNameOf?: (poolId: string) => string | undefined;
  onOpen: (job: TransferJob) => void;
  onRetry: (job: TransferJob) => void;
  maxAttempts?: number;
}

/** Jobs table shared by the pool Transfers tab (F4) and the global Transfer Jobs page (F9). */
export default function TransferJobsTable({ jobs, loading = false, networkOf, poolNameOf, onOpen, onRetry, maxAttempts = 3 }: TransferJobsTableProps) {
  const { ink, soft, rowZebra, rowHover } = useManagedTheme();
  const cols = ["Status", ...(poolNameOf ? ["Pool"] : []), "Wallet", "Asset", "Amount", "To", "Top-up tx", "Transfer tx", "Batch", "Updated", ""];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="border-b border-border">
            {cols.map((h, i) => (
              <th key={`${h}-${i}`} className={`${thCls} ${soft}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && jobs.length === 0 ? (
            <tr>
              <td colSpan={cols.length} className={`py-10 text-center text-[11px] uppercase tracking-widest ${soft}`}>
                Loading jobs…
              </td>
            </tr>
          ) : jobs.length === 0 ? (
            <tr>
              <td colSpan={cols.length} className={`py-10 text-center text-[11px] ${soft}`}>
                No transfer jobs.
              </td>
            </tr>
          ) : (
            jobs.map((j, i) => {
              const net = networkOf(j.poolId);
              const main = net ? isMainnet(net) : true;
              const retryable = j.status === "FAILED" && j.attempts < maxAttempts;
              return (
                <tr key={j.id} className={`border-b border-border/50 ${i % 2 ? rowZebra : ""} ${rowHover}`}>
                  <td className={tdCls}>
                    <div className="flex flex-col gap-0.5">
                      <StatusBadge status={badgeStatus(j.status)} />
                      <span className={`text-[9px] uppercase tracking-wider ${soft}`}>{j.status}</span>
                    </div>
                  </td>
                  {poolNameOf ? <td className={`${tdCls} ${ink}`}>{poolNameOf(j.poolId) ?? j.poolId.slice(0, 8)}</td> : null}
                  <td className={tdCls}>
                    <AddressCell address={j.walletAddress} />
                  </td>
                  <td className={tdCls}>
                    <TokenBadge symbol={j.symbol} asset={j.asset} />
                  </td>
                  <td className={`${tdCls} whitespace-nowrap tabular-nums ${ink}`}>
                    {j.sweepAll ? <span className="mr-1 text-[9px] uppercase text-text-muted">all</span> : null}
                    {formatUnits(j.amountWei, j.decimals)}
                  </td>
                  <td className={tdCls}>
                    <AddressCell address={j.toAddress} />
                  </td>
                  <td className={tdCls}>
                    <TxHashLink hash={j.gasTopupTxHash} mainnet={main} />
                  </td>
                  <td className={tdCls}>
                    <TxHashLink hash={j.transferTxHash} mainnet={main} />
                  </td>
                  <td className={`${tdCls} text-[10px] ${soft}`} title={j.batchId ?? undefined}>
                    {j.batchId ? j.batchId.slice(0, 8) : "—"}
                  </td>
                  <td className={`${tdCls} whitespace-nowrap ${soft}`} title={j.updatedAt}>
                    {timeAgo(j.updatedAt)}
                  </td>
                  <td className={`${tdCls} whitespace-nowrap`}>
                    <div className="flex items-center gap-1">
                      <button type="button" className={ghostBtn} onClick={() => onOpen(j)} title="Open job">
                        <Eye size={12} />
                      </button>
                      {j.status === "FAILED" ? (
                        <button type="button" className={ghostBtn} onClick={() => onRetry(j)} disabled={!retryable} title={retryable ? "Retry (re-auth)" : "Max attempts reached"}>
                          <RotateCcw size={12} /> Retry
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
