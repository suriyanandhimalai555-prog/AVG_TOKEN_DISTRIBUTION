import { Link } from "react-router-dom";
import { Wallet, ArrowRight, Archive } from "lucide-react";
import type { PoolSummary } from "@/lib/managedTypes";
import AddressCell from "@/components/ui/AddressCell";
import NetworkBadge from "./NetworkBadge";
import { useManagedTheme } from "./theme";
import { fmtDateTime } from "./format";

export default function PoolCard({ pool }: { pool: PoolSummary }) {
  const { ink, soft } = useManagedTheme();
  const archived = pool.status === "ARCHIVED";
  return (
    <Link
      to={`/admin/managed/pools/${pool.id}`}
      className={`dash-card group flex flex-col gap-3 p-4 transition hover:border-accent/50 sm:p-5 ${archived ? "opacity-70" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className={`truncate text-sm font-semibold ${ink}`}>{pool.name}</h3>
          <p className={`mt-0.5 text-[10px] ${soft}`}>Created {fmtDateTime(pool.createdAt)}</p>
        </div>
        <NetworkBadge network={pool.network} compact />
      </div>
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className={soft}>Master</span>
        <span onClick={(e) => e.preventDefault()}>
          <AddressCell address={pool.masterAddress} />
        </span>
      </div>
      <div className="flex items-center justify-between border-t border-border/60 pt-3">
        <span className={`inline-flex items-center gap-1.5 font-mono text-[11px] ${ink}`}>
          <Wallet size={12} className="text-accent" />
          {pool.walletCount.toLocaleString()} wallets
        </span>
        {archived ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
            <Archive size={10} /> Archived
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full border border-success/35 bg-success/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success">
            Active
          </span>
        )}
      </div>
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-accent opacity-0 transition group-hover:opacity-100">
        Open <ArrowRight size={12} />
      </span>
    </Link>
  );
}
