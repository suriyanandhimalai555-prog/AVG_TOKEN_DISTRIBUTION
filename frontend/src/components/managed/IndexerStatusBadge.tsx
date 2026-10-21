import { AlertTriangle, CheckCircle, PauseCircle } from "lucide-react";
import type { IndexerNetworkStatus } from "@/lib/managedTypes";
import { formatInt, timeAgo } from "./format";
import { useManagedTheme } from "./theme";

interface IndexerStatusBadgeProps {
  status: IndexerNetworkStatus;
  /** Render the full detail card instead of the compact pill. */
  detailed?: boolean;
}

function health(s: IndexerNetworkStatus): { tone: string; label: string; Icon: typeof CheckCircle } {
  if (!s.enabled) return { tone: "border-border text-text-muted", label: "Disabled", Icon: PauseCircle };
  if (s.lastError) return { tone: "border-danger/50 bg-danger/10 text-danger", label: "Error", Icon: AlertTriangle };
  if ((s.lag ?? 0) > 500) return { tone: "border-warning/40 bg-warning/10 text-warning", label: "Lagging", Icon: AlertTriangle };
  return { tone: "border-success/35 bg-success/10 text-success", label: "Healthy", Icon: CheckCircle };
}

/** Per-network indexer health: last scanned block, head, lag, last run, last error. */
export default function IndexerStatusBadge({ status, detailed = false }: IndexerStatusBadgeProps) {
  const { ink } = useManagedTheme();
  const h = health(status);
  const pill = (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${h.tone}`}>
      <h.Icon size={11} /> {h.label}
      {status.lag !== null ? <span className="font-mono normal-case tracking-normal opacity-80">· lag {formatInt(status.lag)}</span> : null}
    </span>
  );
  if (!detailed) return pill;
  return (
    <div className="space-y-2">
      {pill}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-4">
        <div>
          <dt className="text-text-secondary">Last scanned</dt>
          <dd className={`font-mono ${ink}`}>{formatInt(status.lastScannedBlock)}</dd>
        </div>
        <div>
          <dt className="text-text-secondary">Head (confirmed)</dt>
          <dd className={`font-mono ${ink}`}>{status.head === null ? "—" : formatInt(status.head)}</dd>
        </div>
        <div>
          <dt className="text-text-secondary">Lag</dt>
          <dd className={`font-mono ${(status.lag ?? 0) > 500 ? "text-warning" : ink}`}>{status.lag === null ? "—" : `${formatInt(status.lag)} blocks`}</dd>
        </div>
        <div>
          <dt className="text-text-secondary">Last run</dt>
          <dd className={`font-mono ${ink}`} title={status.lastRunAt ?? undefined}>
            {timeAgo(status.lastRunAt)}
          </dd>
        </div>
      </dl>
      {status.lastError ? (
        <p className="break-words rounded-md border border-danger/40 bg-danger/10 px-2 py-1.5 font-mono text-[11px] text-danger">{status.lastError}</p>
      ) : null}
    </div>
  );
}
