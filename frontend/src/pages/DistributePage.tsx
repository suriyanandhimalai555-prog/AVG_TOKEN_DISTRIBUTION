import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Play, Square, ArrowLeft, ArrowRight } from "lucide-react";
import { RadialBarChart, RadialBar, ResponsiveContainer } from "recharts";
import axios from "axios";
import { distributeApi, estimateApi, sessionsApi, statusApi } from "@/lib/api";
import { store } from "@/lib/store";
import { fmt, fmtBnb, fmtDuration, pct } from "@/lib/utils";
import { DEFAULT_PARALLEL_WORKERS } from "@/lib/distributionBatching";
import ProgressBar from "@/components/ui/ProgressBar";
import StatCard from "@/components/ui/StatCard";
import StatusBadge from "@/components/ui/StatusBadge";
import LiveLog from "@/components/ui/LiveLog";
import BatchTable from "@/components/ui/BatchTable";
import CountdownPanel from "@/components/ui/CountdownPanel";
import { useTheme } from "@/theme/ThemeProvider";

export default function DistributePage() {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const ink = isDark ? "text-[#fafafa]" : "text-[#282828]";
  const bgInset = isDark ? "bg-[#1e293b]" : "bg-[#f4f4f5]";
  /** Secondary labels — explicit hex so light mode stays readable on white cards. */
  const soft = isDark ? "text-[#c4c8d0]" : "text-[#525252]";
  const dotIdle = isDark ? "bg-[#64748b]" : "bg-[#94a3b8]";

  const sessionId = store.getSessionId();
  const qc = useQueryClient();
  const privateKey = store.getPrivateKey();
  const [loadingStart, setLoadingStart] = useState(false);
  const [loadingStop, setLoadingStop] = useState(false);
  const [delayMode, setDelayMode] = useState(false);
  const [isWaiting, setIsWaiting] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [totalDelaySeconds, setTotalDelaySeconds] = useState(0);
  const [currentWalletIndex, setCurrentWalletIndex] = useState(0);
  const [remainingWalletsDelay, setRemainingWalletsDelay] = useState(0);

  const { data: sessionData } = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => sessionsApi.get(sessionId).then((r) => r.data),
    enabled: !!sessionId,
  });

  const { data: preflight } = useQuery({
    queryKey: ["preflight", sessionId, privateKey, sessionData?.session?.network],
    queryFn: () =>
      estimateApi
        .preflight(sessionId, privateKey!, sessionData?.session?.network)
        .then((r) => r.data),
    enabled:
      !!sessionId &&
      !!privateKey &&
      !!sessionData?.session?.tokenAddress,
    staleTime: 30_000,
  });

  const parallelWorkers = preflight?.workerCount ?? DEFAULT_PARALLEL_WORKERS;
  const gasPriceGwei = preflight?.gas.gasPriceGwei ?? "0.05";

  const { data: status, refetch: refetchStatus } = useQuery({
    queryKey: ["status", sessionId],
    queryFn: () => statusApi.get(sessionId),
    enabled: !!sessionId,
    refetchInterval: (query) =>
      query.state.data?.status === "distributing" ? 3000 : 8000,
    retry: (count, err) => {
      if (axios.isAxiosError(err) && err.response?.status === 404) return false;
      return count < 2;
    },
  });

  const isDistributing = status?.status === "distributing" || status?.isRunning;
  const isDone = status?.status === "done";
  useEffect(() => {
    if (!isDone) return;
    // Distribution finished — clear sensitive/runtime setup values
    store.clearPrivateKey();
    sessionStorage.removeItem("setupDraft");
  }, [isDone]);

  async function startDistribute() {
    const pk = store.getPrivateKey();
    if (!pk) {
      toast.error("Private key not found — go back to Setup");
      return;
    }
    setLoadingStart(true);
    try {
      const sessionRes = await sessionsApi.get(sessionId);
      const session = sessionRes.data.session;
      const pre = await estimateApi.preflight(sessionId, pk, session.network);
      if ((pre.data.tokenSourceNetwork ?? "selected") !== "selected") {
        toast("Note: token preview uses mainnet fallback data.", { icon: "ℹ️" });
      }
      await distributeApi.start(sessionId, pk, delayMode);
      toast.success("Distribution started");
      setTimeout(() => refetchStatus(), 1500);
    } catch (err: unknown) {
      toast.error("Failed to start distribution");
    } finally {
      setLoadingStart(false);
    }
  }

  async function stopDistribute() {
    setLoadingStop(true);
    try {
      await distributeApi.stop(sessionId);
      toast("Distribution stopped", { icon: "⛔" });
      refetchStatus();
    } catch {
      toast.error("Failed to stop");
    } finally {
      setLoadingStop(false);
    }
  }

  const onBatch = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["status", sessionId] });
    qc.invalidateQueries({ queryKey: ["batches", sessionId] });
  }, [qc, sessionId]);

  const sentCount = status?.sentCount ?? 0;
  const failedCount = status?.failedCount ?? 0;
  const totalWallets = status?.totalWallets ?? 0;
  const progress = pct(sentCount, Math.max(1, totalWallets));
  const remainingCount = Math.max(0, totalWallets - sentCount - failedCount);
  const estDelayHours = Math.round((remainingCount * 180) / 3600);
  const radialData = [{ name: "progress", value: progress, fill: "#3B82F6" }];

  const totalElapsedSeconds = status?.startedAt
    ? Math.max(0, Math.floor((Date.now() - new Date(status.startedAt).getTime()) / 1000))
    : 0;

  useEffect(() => {
    if (!sessionId || !isDistributing) return;

    const baseUrl = import.meta.env.VITE_API_URL?.trim() ?? "";
    const sseUrl = `${baseUrl}/api/progress?sessionId=${encodeURIComponent(sessionId)}`;
    const es = new EventSource(sseUrl, { withCredentials: true });

    const invalidateProgress = () => {
      qc.invalidateQueries({ queryKey: ["status", sessionId] });
      qc.invalidateQueries({ queryKey: ["batches", sessionId] });
    };

    es.addEventListener("stats", invalidateProgress);
    es.addEventListener("batch", invalidateProgress);

    es.addEventListener("delay:start", (e: MessageEvent) => {
      const data = JSON.parse(e.data) as {
        delayMs: number;
        walletIndex: number;
        remaining: number;
      };
      setIsWaiting(true);
      const secs = Math.ceil(data.delayMs / 1000);
      setTotalDelaySeconds(secs);
      setSecondsRemaining(secs);
      setCurrentWalletIndex(data.walletIndex);
      setRemainingWalletsDelay(data.remaining);
    });

    es.addEventListener("delay:tick", (e: MessageEvent) => {
      const data = JSON.parse(e.data) as { secondsRemaining: number };
      setSecondsRemaining(data.secondsRemaining);
    });

    es.addEventListener("delay:end", () => {
      setIsWaiting(false);
      setSecondsRemaining(0);
    });

    return () => {
      es.close();
    };
  }, [sessionId, isDistributing, delayMode, qc]);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <button
            onClick={() => navigate("/dashboard/plan")}
            className={`mb-3 px-3 py-1.5 border border-border ${soft} font-mono text-[10px] uppercase tracking-widest hover:border-accent hover:text-accent inline-flex items-center gap-1.5`}
          >
            <ArrowLeft size={11} /> Back to Plan
          </button>
          <h1 className={`text-xl font-mono font-bold uppercase tracking-wide ${ink}`}>Distribution Engine</h1>
          <p className={`mt-1 text-sm ${soft} font-mono`}>Session: <span className="text-accent">{sessionId.slice(-16)}</span></p>
        </div>
        <StatusBadge status={status?.status ?? "idle"} />
      </div>

      <div className="grid grid-cols-5 gap-4">
        {/* Left column — 40% */}
        <div className="col-span-2 space-y-4">
          {/* Progress */}
          <div className={`dash-card p-5 sm:p-6`}>
            <div className="grid grid-cols-5 gap-4 items-center">
              <div className="col-span-2 h-[140px] relative">
                <ResponsiveContainer width="100%" height="100%">
                  <RadialBarChart
                    innerRadius="70%"
                    outerRadius="100%"
                    barSize={12}
                    data={radialData}
                    startAngle={90}
                    endAngle={-270}
                  >
                    <RadialBar
                      background={{ fill: isDark ? "#334155" : "#e2e8f0" }}
                      dataKey="value"
                      cornerRadius={8}
                    />
                  </RadialBarChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <p className="text-3xl font-mono font-bold text-accent tabular-nums">{progress}%</p>
                  <p className={`text-[10px] font-mono uppercase tracking-widest ${soft}`}>Complete</p>
                </div>
              </div>

              <div className="col-span-3">
                <div className={`text-4xl font-mono font-bold tabular-nums ${ink}`}>
                  {fmt(sentCount)}
                  <span className={`${soft} text-2xl`}> / {fmt(totalWallets)}</span>
                </div>
                <p className={`text-[10px] font-mono uppercase tracking-widest ${soft} mt-1`}>WALLETS SENT</p>
                <div className="mt-4">
                  <ProgressBar value={progress} />
                  <div className="flex justify-between mt-2 text-[10px] font-mono">
                    <span className="text-success">Sent: {fmt(sentCount)}</span>
                    <span className="text-warning">Remaining: {fmt(remainingCount)}</span>
                    <span className="text-danger">Failed: {fmt(failedCount)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-2">
            <div className={`dash-card p-3 sm:p-4`}>
              <p className={`text-[10px] font-mono uppercase tracking-widest ${soft}`}>CONFIRMED TX</p>
              <p className="text-xl font-mono font-bold text-success mt-1">{fmt(status?.confirmedBatches ?? 0)}</p>
              <p className={`text-[10px] font-mono ${soft}`}>transactions</p>
            </div>
            <div className={`dash-card p-3 sm:p-4`}>
              <p className={`text-[10px] font-mono uppercase tracking-widest ${soft}`}>FAILED TX</p>
              <p className="text-xl font-mono font-bold text-danger mt-1">{fmt(status?.failedBatches ?? 0)}</p>
              <p className={`text-[10px] font-mono ${soft}`}>transactions</p>
            </div>
            <div className={`dash-card p-3 sm:p-4`}>
              <p className={`text-[10px] font-mono uppercase tracking-widest ${soft}`}>BNB SPENT</p>
              <p className="text-lg font-mono font-bold text-accent mt-1">{fmtBnb(status?.bnbSpent)}</p>
            </div>
            <div className={`dash-card p-3 sm:p-4`}>
              <p className={`text-[10px] font-mono uppercase tracking-widest ${soft}`}>ELAPSED</p>
              <p className={`text-lg font-mono font-bold mt-1 ${ink}`}>
                {fmtDuration(status?.startedAt, isDone ? status?.completedAt : undefined)}
              </p>
            </div>
          </div>

          {/* Transfer delay mode */}
          <div className="bg-[#111113] border border-[#1f1f23] p-6 mb-6">
            <div className="flex items-start justify-between gap-6">
              <div className="flex-1">
                <p className="text-[11px] uppercase tracking-widest text-[#6b6b6b] font-mono mb-1">
                  TRANSFER DELAY MODE
                </p>
                <p className="text-[13px] font-mono text-[#e8e8e8] mb-2">
                  Random delay between each transfer
                </p>
                <p className="text-[12px] font-mono text-[#6b6b6b] leading-relaxed">
                  Adds a random 120–240 second wait between each individual wallet transfer. Makes
                  distribution look like genuine organic activity rather than automated bot behaviour.
                </p>
                {delayMode && (
                  <div className="mt-3 flex gap-6">
                    <div>
                      <p className="text-[10px] text-[#6b6b6b] font-mono">MIN DELAY</p>
                      <p className="text-[13px] font-mono text-[#e8e8e8]">120s</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-[#6b6b6b] font-mono">MAX DELAY</p>
                      <p className="text-[13px] font-mono text-[#e8e8e8]">240s</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-[#6b6b6b] font-mono">AVG DELAY</p>
                      <p className="text-[13px] font-mono text-[#e8e8e8]">~3 MIN</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-[#6b6b6b] font-mono">EST. TOTAL</p>
                      <p className="text-[13px] font-mono text-[#f59e0b]">{estDelayHours}h+</p>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex-shrink-0 flex flex-col items-end gap-3">
                <button
                  type="button"
                  onClick={() => !isDistributing && setDelayMode(!delayMode)}
                  disabled={isDistributing}
                  role="switch"
                  aria-checked={delayMode}
                  className={`relative w-12 h-6 border transition-all duration-200 ${
                    delayMode
                      ? "bg-[#00d4aa22] border-[#00d4aa]"
                      : "bg-[#1f1f23] border-[#2a2a2e]"
                  } ${isDistributing ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
                >
                  <span
                    className={`absolute top-[3px] w-[18px] h-[18px] bg-white transition-all duration-200 ${
                      delayMode ? "left-[25px]" : "left-[3px]"
                    }`}
                  />
                </button>
                <p
                  className={`text-[11px] font-mono ${delayMode ? "text-[#00d4aa]" : "text-[#6b6b6b]"}`}
                >
                  {delayMode ? "ENABLED" : "DISABLED"}
                </p>
              </div>
            </div>
          </div>

          {delayMode && (
            <div className="border border-[#f59e0b22] bg-[#f59e0b08] p-3 mb-6 flex gap-3 items-start">
              <span className="text-[#f59e0b]">⚠</span>
              <p className="text-[11px] font-mono text-[#f59e0b] leading-relaxed">
                Delay mode is ON. Distribution will send wallets one by one with 120–240s gaps. For{" "}
                {fmt(remainingCount)} wallets this takes ~{estDelayHours} hours. Do not close the terminal
                or browser during this time.
              </p>
            </div>
          )}

          {/* Controls */}
          <div className="space-y-2">
            {!isDistributing && !isDone && (
              <button
                onClick={startDistribute}
                disabled={loadingStart}
                className="w-full py-3 border border-accent text-accent font-mono text-xs uppercase tracking-widest hover:bg-accent hover:text-black transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
              >
                <Play size={12} />
                {loadingStart ? "STARTING..." : "START DISTRIBUTION"}
              </button>
            )}
            {isDone && (
              <div className="border border-success p-3 text-center">
                <p className="text-success font-mono text-sm uppercase">Distribution Complete</p>
                <button
                  type="button"
                  onClick={() => navigate("/dashboard/results")}
                  className="btn-gradient-primary mt-4 inline-flex w-full items-center justify-center gap-2 px-4 py-2.5 text-xs font-mono font-semibold uppercase tracking-widest"
                >
                  Go to results
                  <ArrowRight size={14} aria-hidden />
                </button>
              </div>
            )}
            {isDistributing && (
              <button
                onClick={stopDistribute}
                disabled={loadingStop}
                className="w-full py-3 border border-danger text-danger font-mono text-xs uppercase tracking-widest hover:bg-danger hover:text-white transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
              >
                <Square size={12} />
                {loadingStop ? "CANCELLING..." : "STOP DISTRIBUTION"}
              </button>
            )}
            {!isDistributing && status?.status === "stopped" && (
              <div className="border border-warning p-3 text-center">
                <p className="text-warning font-mono text-xs uppercase">
                  Distribution stopped. Partial results saved.
                </p>
              </div>
            )}
          </div>

          {/* Execution profile — MultiSender batch script */}
          <div className={`dash-card p-4 sm:p-5`}>
            <p className={`text-[10px] font-mono uppercase tracking-widest ${soft} mb-2`}>
              EXECUTION PROFILE
            </p>
            <p className={`text-[11px] font-mono leading-relaxed ${ink}`}>
              <span className="text-accent">MultiSender</span> batches: up to{" "}
              {preflight?.batchSize ?? "—"} wallets per on-chain tx (server batch size). Up to{" "}
              {parallelWorkers} parallel multisend workers in flight. Gas price{" "}
              <span className="text-accent">{gasPriceGwei} Gwei</span>, up to{" "}
              {preflight?.gas?.perBatchGasLimit
                ? Number(preflight.gas.perBatchGasLimit).toLocaleString()
                : "4,000,000"}{" "}
              gas per batch tx (estimate).
            </p>
          </div>

          {/* RPC health */}
          <div className={`dash-card p-4 sm:p-5`}>
            <p className={`text-[10px] font-mono uppercase tracking-widest ${soft} mb-3`}>
              RPC PROVIDERS (BROADCAST FAILOVER)
            </p>
            {[
              { name: "Alchemy (Primary)", active: isDistributing },
              { name: "Binance Fallback 1", active: false },
              { name: "Binance Fallback 2", active: false },
            ].map((rpc) => (
              <div key={rpc.name} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
                <div className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${rpc.active ? "bg-success animate-pulse" : dotIdle}`} />
                  <span className={`text-[11px] font-mono ${ink}`}>{rpc.name}</span>
                </div>
                <span className={`text-[10px] font-mono ${rpc.active ? "text-success" : soft}`}>
                  {rpc.active ? "ACTIVE" : "STANDBY"}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Right column — 60% */}
        <div className="col-span-3 space-y-4">
          {/* Live log */}
          <LiveLog sessionId={sessionId} onBatch={onBatch} />

          {isDistributing && delayMode && isWaiting && (
            <CountdownPanel
              secondsRemaining={secondsRemaining}
              totalSeconds={totalDelaySeconds}
              currentWallet={currentWalletIndex}
              remainingWallets={remainingWalletsDelay}
              totalElapsed={totalElapsedSeconds}
            />
          )}

          {/* Batch table */}
          <div className={`dash-card overflow-hidden`}>
            <div className={`px-4 py-2 border-b border-border ${bgInset}`}>
              <p className={`text-[10px] font-mono uppercase tracking-widest ${soft}`}>BATCH LOG</p>
            </div>
            <BatchTable sessionId={sessionId} />
          </div>
        </div>
      </div>
    </div>
  );
}
