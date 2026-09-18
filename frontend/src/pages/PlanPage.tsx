import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ArrowRight, ArrowLeft } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { estimateApi, prepareApi, sessionsApi, statusApi } from "@/lib/api";
import { api } from "@/lib/api";
import { store } from "@/lib/store";
import { fmt, pct } from "@/lib/utils";
import {
  countBatchesForWalletCount,
  DEFAULT_MULTI_BATCH_SIZE,
  DEFAULT_PARALLEL_WORKERS,
} from "@/lib/distributionBatching";
import StatCard from "@/components/ui/StatCard";
import AddressCell from "@/components/ui/AddressCell";
import StatusBadge from "@/components/ui/StatusBadge";
import { useTheme } from "@/theme/ThemeProvider";

const BUCKETS = [
  [1, 14], [15, 28], [29, 42], [43, 56],
  [57, 70], [71, 84], [85, 100],
];

interface WalletEntry {
  index: number;
  address: string;
  amount: number;
  amountWei: string;
  sent: boolean;
  failed?: boolean;
  failureReason?: string;
}

export default function PlanPage() {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const ink = isDark ? "text-[#fafafa]" : "text-[#282828]";
  const bgInset = isDark ? "bg-[#1e293b]" : "bg-[#f4f4f5]";
  const rowZebra = isDark ? "bg-[#0f172a]/50" : "bg-[#e8ecf2]";
  const chartTick = isDark ? "#c4c8d0" : "#52525b";
  const chartAxis = isDark ? "#334155" : "#cbd5e1";
  const chartCursor = isDark ? "#1e293b" : "#e2e8f0";
  const rowHover = isDark ? "hover:bg-[#1e293b]" : "hover:bg-[#eef1f4]";

  const sessionId = store.getSessionId();
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const privateKey = store.getPrivateKey();
  const PAGE_SIZE = 20;

  const { data: status } = useQuery({
    queryKey: ["status", sessionId],
    queryFn: () => statusApi.get(sessionId),
    enabled: !!sessionId,
    refetchInterval: 5000,
  });

  const { data: walletsData, refetch } = useQuery({
    queryKey: ["wallets-plan", sessionId, page],
    queryFn: () =>
      api.get<{ wallets: WalletEntry[]; total: number }>(
        `/api/batches/wallets?sessionId=${sessionId}&skip=${page * PAGE_SIZE}&limit=${PAGE_SIZE}`
      ).then((r) => r.data),
    enabled: !!sessionId,
  });
  const wallets = walletsData?.wallets ?? [];
  const total = walletsData?.total ?? 0;
  const { data: walletSummary } = useQuery({
    queryKey: ["wallets-summary", sessionId],
    queryFn: () =>
      api.get<{ totalWallets: number; totalTokens: number }>(
        `/api/batches/wallets/summary?sessionId=${sessionId}`
      ).then((r) => r.data),
    enabled: !!sessionId,
    refetchInterval: 5000,
  });

  const { data: sessionData } = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => sessionsApi.get(sessionId).then((r) => r.data),
    enabled: !!sessionId,
  });

  const {
    data: preflight,
    isFetching: preflightLoading,
    error: preflightError,
    refetch: refetchPreflight,
  } = useQuery({
    queryKey: ["preflight", sessionId, status?.totalWallets],
    queryFn: () =>
      estimateApi
        .preflight(sessionId, privateKey, sessionData?.session?.network)
        .then((r) => r.data),
    enabled: !!sessionId && !!privateKey && !!sessionData?.session?.tokenAddress && wallets.length > 0,
    refetchInterval: 15000,
  });
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const isPreparing = status?.status === "preparing";

  // Build histogram from wallets
  const histData = BUCKETS.map(([lo, hi]) => ({
    range: `${lo}-${hi}`,
    count: wallets.filter((w) => w.amount >= lo && w.amount <= hi).length,
  }));

  // Stats
  const totalTokens = walletSummary?.totalTokens ?? 0;
  const minPossible = (status?.totalWallets ?? 0) * 1;
  const maxPossible = (status?.totalWallets ?? 0) * 100;
  const batchCount = countBatchesForWalletCount(
    status?.totalWallets ?? 0,
    preflight?.batchSize ?? DEFAULT_MULTI_BATCH_SIZE
  );
  /** Preflight is informational only — user may start distribution regardless of estimates. */
  const canNavigateToDistribute = wallets.length > 0 && !!privateKey;
  const parallelWorkers = preflight?.workerCount ?? DEFAULT_PARALLEL_WORKERS;

  async function handlePrepare() {
    setLoading(true);
    try {
      await prepareApi.start(sessionId);
      toast.success("Preparation started");
      setTimeout(() => refetch(), 3000);
    } catch {
      toast.error("Failed to start preparation");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <button
            onClick={() => navigate("/dashboard/generate")}
            className="mb-3 px-3 py-1.5 border border-border text-text-muted font-mono text-[10px] uppercase tracking-widest hover:border-accent hover:text-accent inline-flex items-center gap-1.5"
          >
            <ArrowLeft size={11} /> Back to Generate
          </button>
          <h1 className={`text-xl font-mono font-bold uppercase tracking-wide ${ink}`}>Distribution Plan</h1>
          <p className="mt-1 text-sm text-text-muted font-mono">Review before executing.</p>
        </div>
        <StatusBadge status={status?.status ?? "idle"} />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-2 mb-6">
        <StatCard label="Total Wallets" value={fmt(status?.totalWallets ?? 0)} sub="recipients" />
        <StatCard label="Min Possible" value={fmt(minPossible)} sub="tokens" />
        <StatCard label="Max Possible" value={fmt(maxPossible)} sub="tokens" />
        <StatCard
          label="Est. on-chain txs"
          value={fmt(batchCount)}
          sub={`${preflight?.batchSize ?? DEFAULT_MULTI_BATCH_SIZE} wallets / multisend · ${parallelWorkers} parallel batch txs · ${preflight?.gas.gasPriceGwei ?? "0.05"} Gwei`}
          accent
        />
      </div>

      {/* Chart + controls */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className={`col-span-2 dash-card p-4 sm:p-5`}>
          <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted mb-4">
            TOKEN DISTRIBUTION HISTOGRAM
          </p>
          {wallets.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={histData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <XAxis
                  dataKey="range"
                  tick={{ fontSize: 10, fontFamily: "Poppins", fill: chartTick }}
                  axisLine={{ stroke: chartAxis }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fontFamily: "Poppins", fill: chartTick }}
                  axisLine={{ stroke: chartAxis }}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    background: isDark ? "#111827" : "#ffffff",
                    border: isDark ? "1px solid rgba(148, 163, 184, 0.2)" : "1px solid rgba(15, 23, 42, 0.12)",
                    fontSize: 11,
                    fontFamily: "Poppins",
                  }}
                  labelStyle={{ color: chartTick }}
                  itemStyle={{ color: "#3B82F6" }}
                  cursor={{ fill: chartCursor }}
                />
                <Bar dataKey="count" fill="#3B82F6" radius={0} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[180px] flex items-center justify-center text-text-muted font-mono text-sm">
              No plan data yet — prepare first.
            </div>
          )}
        </div>

        <div className="space-y-3">
          <button
            onClick={handlePrepare}
            disabled={loading || isPreparing}
            className="w-full py-3 border border-accent text-accent font-mono text-xs uppercase tracking-widest hover:bg-accent hover:text-black transition-colors disabled:opacity-40"
          >
            {isPreparing ? "PREPARING..." : loading ? "STARTING..." : "PREPARE PLAN"}
          </button>
          {wallets.length > 0 && !isPreparing && (
            <button
              onClick={() => {
                if (!privateKey) {
                  toast.error("Private key not found. Go back to Setup and initialize again.");
                  return;
                }
                navigate("/dashboard/distribute");
              }}
              className="w-full py-3 border border-success text-success font-mono text-xs uppercase tracking-widest hover:bg-success hover:text-black transition-colors flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={!canNavigateToDistribute}
            >
              START DISTRIBUTION <ArrowRight size={12} />
            </button>
          )}
          <div className={`dash-card p-3 space-y-2 sm:p-4`}>
            <div className="flex justify-between text-[10px] font-mono">
              <span className="text-text-muted">LOADED WALLETS</span>
              <span className={ink}>{fmt(total)}</span>
            </div>
            <div className="flex justify-between text-[10px] font-mono">
              <span className="text-text-muted">TOTAL TOKENS (FULL PLAN)</span>
              <span className="text-accent">{fmt(totalTokens)}</span>
            </div>
            <div className="flex justify-between text-[10px] font-mono">
              <span className="text-text-muted">SEND MODE</span>
              <span className={ink}>
                MultiSender: up to {preflight?.batchSize ?? DEFAULT_MULTI_BATCH_SIZE} wallets per tx,{" "}
                {parallelWorkers} parallel multisend workers
              </span>
            </div>
          </div>

          <div className={`dash-card p-3 space-y-2 sm:p-4`}>
            <div className="flex items-center justify-between text-[10px] font-mono">
              <span className="text-text-muted">PREFLIGHT GAS / BNB CHECK</span>
              <button
                onClick={() => refetchPreflight()}
                className="text-accent hover:underline disabled:opacity-40"
                disabled={preflightLoading || !privateKey}
              >
                {preflightLoading ? "CHECKING..." : "REFRESH"}
              </button>
            </div>
            {!privateKey && (
              <p className="text-warning text-[10px] font-mono">
                Private key missing in memory. Go Setup and initialize session again.
              </p>
            )}
            {preflightError && (
              <p className="text-warning text-[10px] font-mono">
                Could not run preflight check. Verify token address/private key and RPC.
              </p>
            )}
            {preflight && (
              <>
                <div className="flex justify-between text-[10px] font-mono">
                  <span className="text-text-muted">{preflight.nativeSymbol} BALANCE</span>
                  <span className={ink}>{Number(preflight.bnb?.balance ?? 0).toFixed(6)} {preflight.nativeSymbol}</span>
                </div>
                <div className="flex justify-between text-[10px] font-mono">
                  <span className="text-text-muted">EST. {preflight.nativeSymbol} COST (LIKELY)</span>
                  <span className="text-accent">{Number(preflight.gas?.estimatedBnbLikely ?? 0).toFixed(6)} {preflight.nativeSymbol}</span>
                </div>
                <div className="flex justify-between text-[10px] font-mono">
                  <span className="text-text-muted">EST. {preflight.nativeSymbol} COST (MAX)</span>
                  <span className={ink}>{Number(preflight.gas?.estimatedBnbMax ?? 0).toFixed(6)} {preflight.nativeSymbol}</span>
                </div>
                <div className="flex justify-between text-[10px] font-mono">
                  <span className="text-text-muted">TOKEN BALANCE</span>
                  <span className={ink}>
                    {Number(preflight.token?.balance ?? 0).toLocaleString()} {preflight.token?.symbol ?? "TOKEN"}
                  </span>
                </div>
                <div className="flex justify-between text-[10px] font-mono">
                  <span className="text-text-muted">TOKEN NEEDED (MAX)</span>
                  <span className="text-accent">
                    {(preflight.token?.requiredMax ?? 0).toLocaleString()} {preflight.token?.symbol ?? "TOKEN"}
                  </span>
                </div>
                <div className="pt-1 space-y-2">
                  <p className="text-text-muted text-[10px] font-mono leading-relaxed">
                    Figures above are estimates only; actual gas, fees, and token amounts may vary with network conditions.
                  </p>
                  {preflight.token?.enoughForMax && preflight.bnb?.enoughLikely ? (
                    <p className="text-success text-[10px] font-mono">
                      Ready: balance looks sufficient versus these estimates.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {(preflight.tokenSourceNetwork ?? "selected") !== "selected" && (
                        <p className="text-warning text-[10px] font-mono">
                          ℹ Token data is coming from mainnet fallback for preview.
                        </p>
                      )}
                      <p className="text-warning text-[10px] font-mono">
                        ⚠ Low balance risk versus estimates — you can still start; ensure enough {preflight.nativeSymbol} and{" "}
                        {preflight.token.symbol} on chain for real execution.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          if (!privateKey) {
                            toast.error("Private key not found. Go back to Setup and initialize again.");
                            return;
                          }
                          navigate("/dashboard/distribute");
                        }}
                        disabled={!privateKey}
                        className="w-full py-2 border border-success text-success font-mono text-[10px] uppercase tracking-widest hover:bg-success hover:text-black transition-colors disabled:opacity-40"
                      >
                        Start distribution
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Wallet table */}
      <div className={`dash-card overflow-hidden`}>
        <div className={`px-4 py-2 border-b border-border ${bgInset}`}>
          <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted">
            WALLET PLAN — {fmt(total)} total
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="border-b border-border">
                {["#", "ADDRESS", "AMOUNT", "AMOUNT WEI", "STATUS", "REASON"].map((h) => (
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
                <tr key={w.index} className={`border-b border-border/30 ${rowHover} ${i % 2 === 1 ? rowZebra : ""}`}>
                  <td className="py-1.5 px-3 text-text-muted">{w.index}</td>
                  <td className="py-1.5 px-3"><AddressCell address={w.address} /></td>
                  <td className="py-1.5 px-3 text-accent">{w.amount > 0 ? fmt(w.amount) : <span className="text-text-muted">—</span>}</td>
                  <td className="py-1.5 px-3 text-text-muted truncate max-w-[140px]">{w.amountWei !== "0" ? w.amountWei.slice(0, 16) + "..." : "—"}</td>
                  <td className="py-1.5 px-3">
                    <StatusBadge status={w.sent ? "confirmed" : (resolvedFailed ? "failed" : "pending")} />
                  </td>
                  <td className="py-1.5 px-3 text-text-muted">{resolvedReason}</td>
                </tr>
                  );
                })()
              ))}
              {wallets.length === 0 && (
                <tr><td colSpan={6} className="py-8 text-center text-text-muted">No wallets loaded.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className={`flex items-center justify-between px-4 py-3 border-t border-border ${bgInset}`}>
            <span className="text-[10px] font-mono text-text-muted">Page {page + 1} of {totalPages}</span>
            <div className="flex gap-2">
              <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="px-3 py-1 border border-border text-[10px] font-mono text-text-muted hover:border-accent hover:text-accent disabled:opacity-30">PREV</button>
              <button disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)} className="px-3 py-1 border border-border text-[10px] font-mono text-text-muted hover:border-accent hover:text-accent disabled:opacity-30">NEXT</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
