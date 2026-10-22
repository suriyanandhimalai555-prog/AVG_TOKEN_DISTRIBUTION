import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Eye, EyeOff, Download, ArrowRight, ArrowLeft, Wallet as WalletIcon } from "lucide-react";
import axios from "axios";
import { generateApi, statusApi } from "@/lib/api";
import { store } from "@/lib/store";
import { fmt, fmtDuration, pct } from "@/lib/utils";
import ProgressBar from "@/components/ui/ProgressBar";
import StatusBadge from "@/components/ui/StatusBadge";
import AddressCell from "@/components/ui/AddressCell";
import WalletModeCard, { type GenerateMode } from "@/components/ui/WalletModeCard";
import { api } from "@/lib/api";
import { useTheme } from "@/theme/ThemeProvider";
import { useAuth } from "@/hooks/useAuth";
import { managedApi, useManagedEnabled } from "@/components/managed/client";
import { apiErrorMessage } from "@/components/managed/format";
import type { SessionPoolMatch } from "@/lib/managedTypes";

interface WalletPreview {
  index: number;
  address: string;
  derivationPath: string;
}

const MODE_LABEL: Record<GenerateMode, string> = {
  MANAGED_POOL: "POOL WALLETS",
  INDEPENDENT_SEEDS: "INDEPENDENT SEEDS",
  HD_SINGLE_SEED: "HD SINGLE SEED",
};

/** Pool wallets are stored with derivationPath "pool:<poolId>/<index>". */
function poolIdOf(derivationPath: string | undefined): string | null {
  if (!derivationPath?.startsWith("pool:")) return null;
  return derivationPath.slice(5).split("/")[0] || null;
}

function poolUnavailableText(match: SessionPoolMatch): string {
  switch (match.reason) {
    case "NO_POOL":
      return "No pool uses this signing wallet as master. Create one from Setup or Managed → Pools.";
    case "NETWORK_MISMATCH":
      return `This wallet's pool “${match.pool?.name}” is on ${match.pool?.network === "bscMainnet" ? "BNB Mainnet" : "BNB Testnet"}; this session is on ${match.network === "bscMainnet" ? "BNB Mainnet" : "BNB Testnet"}.`;
    case "POOL_ARCHIVED":
      return `Pool “${match.pool?.name}” is archived.`;
    case "POOL_FULL":
      return `Pool “${match.pool?.name}” has room for ${match.remaining.toLocaleString()} more wallets; this session needs ${match.needed.toLocaleString()}.`;
    default:
      return "";
  }
}

export default function GeneratePage() {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const ink = isDark ? "text-[#fafafa]" : "text-[#282828]";
  const bgInset = isDark ? "bg-[#1e293b]" : "bg-[#f4f4f5]";
  const bgChip = isDark ? "bg-[#0b0f1f]" : "bg-[#f4f4f5]";
  const rowZebra = isDark ? "bg-[#0f172a]/50" : "bg-[#e8ecf2]";

  const sessionId = store.getSessionId();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [mnemonicVisible, setMnemonicVisible] = useState(false);
  const [walletMode, setWalletMode] = useState<GenerateMode>("INDEPENDENT_SEEDS");
  const [modeTouched, setModeTouched] = useState(false);

  // Admins whose signing wallet backs a Managed Wallets pool can generate the
  // session's wallets inside that pool, so distributed tokens show up there.
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const managed = useManagedEnabled({ enabled: isAdmin });
  const signingKey = store.getPrivateKey();
  const { data: poolMatch } = useQuery({
    // The key is sent in the body only; it never goes into the cache key.
    queryKey: ["managed", "session-pool", sessionId],
    queryFn: () => managedApi.findSessionPool(sessionId, signingKey),
    enabled: isAdmin && managed.ready && !!sessionId && !!signingKey,
    retry: false,
    staleTime: 30_000,
  });
  const poolUsable = !!poolMatch?.pool && poolMatch.reason === null;

  useEffect(() => {
    if (poolUsable && !modeTouched) setWalletMode("MANAGED_POOL");
  }, [poolUsable, modeTouched]);

  function chooseMode(mode: GenerateMode) {
    setModeTouched(true);
    setWalletMode(mode);
  }

  const { data: status, refetch: refetchStatus } = useQuery({
    queryKey: ["status", sessionId],
    queryFn: () => statusApi.get(sessionId),
    enabled: !!sessionId,
    refetchInterval: (query) =>
      query.state.data?.status === "generating" ? 1500 : 5000,
    retry: (count, err) => {
      if (axios.isAxiosError(err) && err.response?.status === 404) return false;
      return count < 2;
    },
  });

  const { data: walletsData } = useQuery({
    queryKey: ["wallets-preview", sessionId],
    queryFn: () =>
      api.get<{ wallets: WalletPreview[]; total: number }>(
        `/api/batches/wallets?sessionId=${sessionId}&limit=20`
      ).then((r) => r.data),
    enabled: !!sessionId && status?.status !== "generating",
    refetchInterval: 10_000,
  });

  const { data: sessionData } = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => api.get<{ session: { masterMnemonic?: string } }>(`/api/sessions/${sessionId}`).then((r) => r.data),
    enabled: !!sessionId,
  });

  async function startGenerate() {
    const pk = store.getPrivateKey();
    if (!pk) {
      toast.error("Private key not found — please restart from Setup");
      return;
    }
    if (walletMode === "MANAGED_POOL") {
      await startPoolGenerate(pk);
      return;
    }
    setLoading(true);
    try {
      await generateApi.start(sessionId, pk, walletMode);
      toast.success("Wallet generation started");
      refetchStatus();
    } catch {
      toast.error("Failed to start generation");
    } finally {
      setLoading(false);
    }
  }

  async function startPoolGenerate(pk: string) {
    setLoading(true);
    try {
      const res = await managedApi.generateSessionFromPool(sessionId, pk);
      toast.success(`${fmt(res.created)} wallets created in pool “${res.pool.name}”`);
      void queryClient.invalidateQueries({ queryKey: ["wallets-preview", sessionId] });
      void queryClient.invalidateQueries({ queryKey: ["session", sessionId] });
      void queryClient.invalidateQueries({ queryKey: ["managed"] });
      refetchStatus();
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not generate pool wallets"));
    } finally {
      setLoading(false);
    }
  }

  const isGenerating = status?.status === "generating";
  const isDone = (walletsData?.total ?? 0) > 0 && status?.status !== "generating";
  // Generated = wallet rows the session has (status.sentCount counts *sent* wallets).
  const generatedCount = walletsData?.total ?? 0;
  const progress = pct(generatedCount, status?.totalWallets ?? 1);
  const mnemonic = sessionData?.session?.masterMnemonic;
  const words = mnemonic?.split(" ") ?? [];
  // What the session's wallets actually are (the cards show what to generate next).
  const firstPath = walletsData?.wallets?.[0]?.derivationPath;
  const sessionPoolId = poolIdOf(firstPath);
  const generatedMode: GenerateMode = sessionPoolId ? "MANAGED_POOL" : firstPath?.startsWith("m/") ? "HD_SINGLE_SEED" : "INDEPENDENT_SEEDS";
  const showPoolCard = isAdmin && managed.ready && !!poolMatch;

  if (!sessionId) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <p className="text-text-muted font-mono">No active session.</p>
          <button onClick={() => navigate("/dashboard/setup")} className="mt-4 px-4 py-2 border border-accent text-accent font-mono text-xs hover:bg-accent hover:text-black transition-colors">
            GO TO SETUP
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <button
          onClick={() => navigate("/dashboard/setup")}
          className="mb-3 px-3 py-1.5 border border-border text-text-muted font-mono text-[10px] uppercase tracking-widest hover:border-accent hover:text-accent inline-flex items-center gap-1.5"
        >
          <ArrowLeft size={11} /> Back to Setup
        </button>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className={`text-xl font-mono font-bold uppercase tracking-wide ${ink}`}>Wallet Generation</h1>
          {isDone && (
            <span className="text-[10px] font-mono px-2 py-0.5 border border-[#00d4aa] text-[#00d4aa]">
              {MODE_LABEL[generatedMode]}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-text-muted font-mono">Session: <span className="text-accent">{sessionId.slice(-16)}</span></p>
      </div>

      <div className="grid grid-cols-5 gap-4">
        {/* Left panel — 60% */}
        <div className="col-span-3 space-y-4">
          {/* Counter */}
          <div className="dash-card p-6 sm:p-7">
            <div className={`text-5xl font-mono font-bold tabular-nums ${ink}`}>
              {fmt(generatedCount).padStart(5, "0")}
              <span className="text-text-muted"> / {fmt(status?.totalWallets ?? 0)}</span>
            </div>
            <p className="text-[11px] font-mono uppercase tracking-widest text-text-muted mt-2">WALLETS GENERATED</p>
            <div className="mt-4">
              <ProgressBar value={progress} />
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-2">
            <div className={`border border-border p-3 ${bgInset}`}>
              <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted">STATUS</p>
              <div className="mt-2">
                <StatusBadge status={status?.status ?? "idle"} />
              </div>
            </div>
            <div className={`border border-border p-3 ${bgInset}`}>
              <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted">ELAPSED</p>
              <p className={`mt-2 text-sm font-mono ${ink}`}>
                {fmtDuration(status?.startedAt, isGenerating ? undefined : status?.completedAt)}
              </p>
            </div>
            <div className={`border border-border p-3 ${bgInset}`}>
              <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted">PROGRESS</p>
              <p className="mt-2 text-sm font-mono text-accent">{progress}%</p>
            </div>
          </div>

          {/* Wallet generation mode */}
          <div className="bg-[#111113] border border-[#1f1f23] p-6 mb-6">
            <p className="text-[11px] uppercase tracking-widest text-[#6b6b6b] font-mono mb-4">
              WALLET GENERATION MODE
            </p>
            {showPoolCard && poolMatch ? (
              <div className="mb-3">
                <WalletModeCard
                  mode="MANAGED_POOL"
                  selected={walletMode === "MANAGED_POOL"}
                  onSelect={() => chooseMode("MANAGED_POOL")}
                  disabled={isGenerating || !poolUsable}
                  detail={
                    poolUsable && poolMatch.pool ? (
                      <>
                        Pool <span className="text-[#e8e8e8]">“{poolMatch.pool.name}”</span> · master{" "}
                        <span className="text-[#e8e8e8]">
                          {poolMatch.pool.masterAddress.slice(0, 6)}…{poolMatch.pool.masterAddress.slice(-4)}
                        </span>{" "}
                        · {fmt(poolMatch.pool.walletCount)} wallets now
                      </>
                    ) : (
                      <span className="text-[#f59e0b]">{poolUnavailableText(poolMatch)}</span>
                    )
                  }
                />
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <WalletModeCard
                mode="HD_SINGLE_SEED"
                selected={walletMode === "HD_SINGLE_SEED"}
                onSelect={() => chooseMode("HD_SINGLE_SEED")}
                disabled={isGenerating}
              />
              <WalletModeCard
                mode="INDEPENDENT_SEEDS"
                selected={walletMode === "INDEPENDENT_SEEDS"}
                onSelect={() => chooseMode("INDEPENDENT_SEEDS")}
                disabled={isGenerating}
              />
            </div>
            {walletMode === "MANAGED_POOL" ? (
              <div className="border border-[#3b82f622] bg-[#3b82f608] p-3 mt-3 flex gap-3 items-start">
                <span className="text-[#60a5fa] text-sm mt-0.5">●</span>
                <p className="text-[11px] font-mono text-[#a3a3a3] leading-relaxed">
                  The session's {fmt(poolMatch?.needed ?? status?.totalWallets ?? 0)} wallets are added to the pool. Tokens you
                  distribute show in the pool and in Treasury, and Sweep to master brings them back. No private keys are
                  written to disk: the pool's master key controls every wallet.
                </p>
              </div>
            ) : walletMode === "HD_SINGLE_SEED" ? (
              <div className="border border-[#f59e0b22] bg-[#f59e0b08] p-3 mt-3 flex gap-3 items-start">
                <span className="text-[#f59e0b] text-sm mt-0.5">⚠</span>
                <p className="text-[11px] font-mono text-[#f59e0b] leading-relaxed">
                  All wallets share one master mnemonic. A blockchain analyst can detect these wallets are
                  related. Use Independent Seeds for more realistic distribution.
                </p>
              </div>
            ) : (
              <div className="border border-[#00d4aa22] bg-[#00d4aa08] p-3 mt-3 flex gap-3 items-start">
                <span className="text-[#00d4aa] text-sm mt-0.5">●</span>
                <p className="text-[11px] font-mono text-[#6b6b6b] leading-relaxed">
                  Each wallet has its own 12-word seed phrase saved to output/mnemonics/. Generation is
                  slightly slower but wallets appear as independent real users on-chain.
                </p>
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="flex gap-3">
            <button
              onClick={startGenerate}
              disabled={loading || isGenerating}
              className="flex-1 py-2.5 border border-accent text-accent font-mono text-xs uppercase tracking-widest hover:bg-accent hover:text-black transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isGenerating ? "GENERATING..." : loading ? "STARTING..." : "GENERATE WALLETS"}
            </button>
            {isDone && (
              <a
                href={`/api/export?sessionId=${sessionId}&file=wallets`}
                download
                className="px-4 py-2.5 border border-border text-text-muted font-mono text-xs uppercase tracking-widest hover:border-accent hover:text-accent transition-colors flex items-center gap-2"
              >
                <Download size={12} />
                CSV
              </a>
            )}
          </div>

          {isDone && (
            <button
              onClick={() => navigate("/dashboard/plan")}
              className="w-full py-2.5 border border-success text-success font-mono text-xs uppercase tracking-widest hover:bg-success hover:text-black transition-colors flex items-center justify-center gap-2"
            >
              PROCEED TO PLAN <ArrowRight size={12} />
            </button>
          )}

          {isDone && sessionPoolId && isAdmin && (
            <Link
              to={`/admin/managed/pools/${sessionPoolId}`}
              className="w-full py-2.5 border border-[#3b82f6] text-[#60a5fa] font-mono text-xs uppercase tracking-widest hover:bg-[#3b82f6] hover:text-white transition-colors flex items-center justify-center gap-2"
            >
              <WalletIcon size={12} /> OPEN POOL — BALANCES &amp; SWEEP
            </Link>
          )}

          {/* Mnemonic */}
          {mnemonic && (
            <div className="dash-card border-warning/45 p-4 sm:p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-mono uppercase tracking-widest text-warning">MASTER MNEMONIC — SAVE THIS</p>
                <button
                  onClick={() => setMnemonicVisible((v) => !v)}
                  className="text-text-muted hover:text-text-primary transition-colors"
                >
                  {mnemonicVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <div className={`grid grid-cols-4 gap-1.5 ${!mnemonicVisible ? "blur-sm select-none" : ""}`}>
                {words.map((word, i) => (
                  <div key={i} className={`flex items-center gap-1 border border-border px-2 py-1 ${bgChip}`}>
                    <span className="text-[9px] font-mono text-text-muted w-4">{i + 1}.</span>
                    <span className={`text-xs font-mono ${ink}`}>{word}</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[10px] font-mono text-warning">
                ⚠ This phrase controls all generated wallets. It cannot be recovered.
              </p>
            </div>
          )}
        </div>

        {/* Right panel — wallet preview */}
        <div className="col-span-2 dash-card flex flex-col overflow-hidden">
          <div className={`px-3 py-2 border-b border-border ${bgInset}`}>
            <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted">
              LIVE PREVIEW — {fmt(walletsData?.total ?? 0)} wallets
            </p>
          </div>
          <div className="overflow-y-auto" style={{ height: "480px" }}>
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left py-2 px-3 text-[10px] text-text-muted font-normal">#</th>
                  <th className="text-left py-2 px-3 text-[10px] text-text-muted font-normal">ADDRESS</th>
                </tr>
              </thead>
              <tbody>
                {(walletsData?.wallets ?? []).map((w, i) => (
                  <tr key={w.index} className={`border-b border-border/30 ${i % 2 === 1 ? rowZebra : ""}`}>
                    <td className="py-1.5 px-3 text-text-muted">{w.index}</td>
                    <td className="py-1.5 px-3">
                      <AddressCell address={w.address} />
                    </td>
                  </tr>
                ))}
                {(walletsData?.wallets ?? []).length === 0 && (
                  <tr>
                    <td colSpan={2} className="py-8 text-center text-text-muted">
                      {isGenerating ? "Generating..." : "No wallets yet"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
