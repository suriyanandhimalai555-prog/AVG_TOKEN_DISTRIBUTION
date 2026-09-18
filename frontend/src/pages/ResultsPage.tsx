import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Download, ArrowLeft } from "lucide-react";
import { statusApi, exportApi } from "@/lib/api";
import { api } from "@/lib/api";
import { store } from "@/lib/store";
import { fmt, fmtBnb, fmtDuration, fmtTime } from "@/lib/utils";
import StatCard from "@/components/ui/StatCard";
import AddressCell from "@/components/ui/AddressCell";
import TxHashLink from "@/components/ui/TxHashLink";
import StatusBadge from "@/components/ui/StatusBadge";

interface WalletEntry {
  index: number;
  address: string;
  amount: number;
  sent: boolean;
  failed?: boolean;
  failureReason?: string;
  txHash?: string;
  timestamp?: string;
  batchId?: string;
}

const PAGE_SIZE = 50;

export default function ResultsPage() {
  const navigate = useNavigate();
  const sessionId = store.getSessionId();
  const [page, setPage] = useState(0);

  const { data: status } = useQuery({
    queryKey: ["status", sessionId],
    queryFn: () => statusApi.get(sessionId),
    enabled: !!sessionId,
    refetchInterval: 10_000,
  });

  const { data: sessionData } = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => api.get<{ session: { startedAt?: string; completedAt?: string } }>(`/api/sessions/${sessionId}`).then((r) => r.data),
    enabled: !!sessionId,
  });

  const { data: walletsData } = useQuery({
    queryKey: ["wallets-results", sessionId, page],
    queryFn: () =>
      api.get<{ wallets: WalletEntry[]; total: number }>(
        `/api/batches/wallets?sessionId=${sessionId}&skip=${page * PAGE_SIZE}&limit=${PAGE_SIZE}`
      ).then((r) => r.data),
    enabled: !!sessionId,
  });

  const wallets = walletsData?.wallets ?? [];
  const total = walletsData?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const isDone = status?.status === "done";
  const isStopped = status?.status === "stopped";
  const duration = fmtDuration(sessionData?.session?.startedAt, sessionData?.session?.completedAt);

  const downloads: Array<{ label: string; file: "csv" | "xlsx" | "wallets" | "json" }> = [
    { label: "distribution-log.csv", file: "csv" },
    { label: "distribution-log.xlsx", file: "xlsx" },
    { label: "wallets.csv", file: "wallets" },
    { label: "full-report.json", file: "json" },
  ];

  return (
    <div>
      <div className="mb-6">
        <button
          onClick={() => navigate("/dashboard/distribute")}
          className="mb-3 px-3 py-1.5 border border-border text-text-muted font-mono text-[10px] uppercase tracking-widest hover:border-accent hover:text-accent inline-flex items-center gap-1.5"
        >
          <ArrowLeft size={11} /> Back to Distribute
        </button>
        <h1 className="text-xl font-mono font-bold text-text-primary uppercase tracking-wide">Results</h1>
        <p className="mt-1 text-sm text-text-muted font-mono">Session: <span className="text-accent">{sessionId.slice(-16)}</span></p>
      </div>

      {/* Completion banner */}
      {isDone && (
        <div className="border border-accent bg-accent-dim p-4 mb-6 flex items-center justify-between">
          <div>
            <p className="font-mono text-accent text-sm uppercase tracking-widest font-bold">✓ DISTRIBUTION COMPLETE</p>
            <div className="flex items-center gap-6 mt-1">
              <span className="text-[11px] font-mono text-text-muted">{fmt(status?.sentCount)} wallets</span>
              <span className="text-[11px] font-mono text-text-muted">{fmt(status?.failedCount)} failed</span>
              <span className="text-[11px] font-mono text-text-muted">{fmtBnb(status?.bnbSpent)}</span>
              <span className="text-[11px] font-mono text-text-muted">{duration}</span>
            </div>
          </div>
          <StatusBadge status="done" />
        </div>
      )}
      {isStopped && (
        <div className="border border-warning bg-warning/10 p-4 mb-6 flex items-center justify-between">
          <div>
            <p className="font-mono text-warning text-sm uppercase tracking-widest font-bold">PARTIAL DISTRIBUTION (STOPPED)</p>
            <div className="flex items-center gap-6 mt-1">
              <span className="text-[11px] font-mono text-text-muted">{fmt(status?.sentCount)} sent</span>
              <span className="text-[11px] font-mono text-text-muted">{fmt(status?.failedCount)} not sent</span>
              <span className="text-[11px] font-mono text-text-muted">Gas used: {fmtBnb(status?.bnbSpent)}</span>
              <span className="text-[11px] font-mono text-text-muted">{duration}</span>
            </div>
          </div>
          <StatusBadge status="stopped" />
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-6 gap-2 mb-6">
        <StatCard label="Total Wallets" value={fmt(status?.totalWallets ?? 0)} />
        <StatCard label="Confirmed" value={fmt(status?.sentCount ?? 0)} accent />
        <StatCard label="Failed" value={fmt(status?.failedCount ?? 0)} />
        <StatCard label="BNB Spent" value={fmtBnb(status?.bnbSpent)} />
        <StatCard label="Batches" value={fmt(status?.confirmedBatches ?? 0)} sub="confirmed" />
        <StatCard label="Duration" value={duration} />
      </div>

      {/* Downloads */}
      <div className="dash-card p-4 sm:p-5 mb-6">
        <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted mb-3">DOWNLOADS</p>
        <div className="grid grid-cols-4 gap-2">
          {downloads.map(({ label, file }) => (
            <a
              key={file}
              href={exportApi.url(sessionId, file)}
              download
              className="flex items-center gap-2 px-3 py-2.5 border border-border text-text-muted font-mono text-xs hover:border-accent hover:text-accent transition-colors"
            >
              <Download size={12} className="flex-shrink-0" />
              <span className="truncate">{label}</span>
            </a>
          ))}
        </div>
      </div>

      {/* Results table */}
      <div className="dash-card overflow-hidden">
        <div className="px-4 py-2 border-b border-border flex items-center justify-between">
          <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted">
            ALL WALLETS — {fmt(total)} total
          </p>
          <span className="text-[10px] font-mono text-text-muted">
            Page {page + 1} of {totalPages || 1}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="border-b border-border">
                {["#", "ADDRESS", "AMOUNT", "TX HASH", "TIMESTAMP", "STATUS", "REASON"].map((h) => (
                  <th key={h} className="text-left py-2 px-3 text-[10px] uppercase tracking-widest text-text-muted font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {wallets.map((w, i) => (
                (() => {
                  const isLegacyPending = !w.sent && w.failureReason === "Not sent yet";
                  const resolvedFailed = Boolean(w.failed && !isLegacyPending);
                  const resolvedReason = w.sent ? "—" : (isLegacyPending ? "Not sent" : (w.failureReason || "Not sent"));
                  return (
                <tr key={w.index} className={`border-b border-border/30 hover:bg-panel/30 ${i % 2 === 0 ? "" : "bg-surface/50"}`}>
                  <td className="py-2 px-3 text-text-muted">{w.index}</td>
                  <td className="py-2 px-3"><AddressCell address={w.address} /></td>
                  <td className="py-2 px-3 text-accent">{fmt(w.amount)}</td>
                  <td className="py-2 px-3"><TxHashLink hash={w.txHash} /></td>
                  <td className="py-2 px-3 text-text-muted">{fmtTime(w.timestamp)}</td>
                  <td className="py-2 px-3"><StatusBadge status={w.sent ? "confirmed" : (resolvedFailed ? "failed" : "pending")} /></td>
                  <td className="py-2 px-3 text-text-muted">{resolvedReason}</td>
                </tr>
                  );
                })()
              ))}
              {wallets.length === 0 && (
                <tr><td colSpan={7} className="py-8 text-center text-text-muted">No results yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="px-3 py-1 border border-border text-[10px] font-mono text-text-muted hover:border-accent hover:text-accent disabled:opacity-30">PREV</button>
            <button disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)} className="px-3 py-1 border border-border text-[10px] font-mono text-text-muted hover:border-accent hover:text-accent disabled:opacity-30">NEXT</button>
          </div>
        )}
      </div>
    </div>
  );
}
