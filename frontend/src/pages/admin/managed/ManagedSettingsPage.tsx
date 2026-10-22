import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Play, Loader2, RefreshCw, Plus, Eye, EyeOff, ShieldCheck, ShieldAlert, Database } from "lucide-react";
import type { ManagedToken, Network } from "@/lib/managedTypes";
import RouteErrorFallback from "@/components/RouteErrorFallback";
import AddressCell from "@/components/ui/AddressCell";
import { managedApi } from "@/components/managed/client";
import IndexerStatusBadge from "@/components/managed/IndexerStatusBadge";
import NetworkBadge from "@/components/managed/NetworkBadge";
import TokenBadge from "@/components/managed/TokenBadge";
import { apiErrorMessage, formatInt, isValidAddress, networkLabel } from "@/components/managed/format";
import { ghostBtn, inputCls, primaryBtn, tdCls, thCls, useManagedTheme } from "@/components/managed/theme";

const NETWORKS: Network[] = ["bscMainnet", "bscTestnet"];

/** F10: tracked tokens per network, spam hiding, indexer status + run now, key-vault health. */
export default function ManagedSettingsPage() {
  const { ink, soft, bgInset } = useManagedTheme();
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);

  const health = useQuery({ queryKey: ["managed", "health"], queryFn: () => managedApi.health(), refetchInterval: 30000 });
  const indexer = useQuery({ queryKey: ["managed", "indexer"], queryFn: () => managedApi.getIndexerStatus(), refetchInterval: 30000 });

  async function runNow(): Promise<void> {
    setRunning(true);
    try {
      await managedApi.runIndexer();
      toast.success("Indexer run requested");
      setTimeout(() => void qc.invalidateQueries({ queryKey: ["managed", "indexer"] }), 3000);
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not start the indexer"));
    } finally {
      setRunning(false);
    }
  }

  if (health.error && indexer.error) return <RouteErrorFallback message={apiErrorMessage(health.error, "Unable to load settings.")} onRetry={() => void health.refetch()} />;

  const h = health.data;

  return (
    <div className="space-y-5">
      <div>
        <p className={`text-[11px] uppercase tracking-widest ${soft}`}>Admin · Managed wallets</p>
        <h1 className={`mt-1 font-display text-xl font-semibold tracking-tight ${ink}`}>Tokens &amp; indexer</h1>
        <p className={`mt-1 text-xs ${soft}`}>Operational settings for deposit discovery and the key vault.</p>
      </div>

      {/* Key vault + feature health */}
      <section className="dash-card p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="dash-section-title">Key vault &amp; feature health</p>
          <button type="button" className={ghostBtn} onClick={() => void health.refetch()}>
            <RefreshCw size={12} className={health.isFetching ? "animate-spin" : ""} />
          </button>
        </div>
        {health.isLoading ? (
          <p className={`mt-3 inline-flex items-center gap-2 text-[11px] ${soft}`}>
            <Loader2 size={14} className="animate-spin" /> Checking…
          </p>
        ) : h ? (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <HealthTile
              ok={h.keyVault === "ok"}
              label="Encryption key"
              value={h.keyVault === "ok" ? "Loaded" : "Missing"}
              hint={h.keyVault === "ok" ? "WALLET_ENCRYPTION_KEY decrypts pool seeds." : "Set WALLET_ENCRYPTION_KEY; every managed route returns 503 until then."}
            />
            <HealthTile ok={h.migrated} label="Database" value={h.migrated ? "Migrated" : "Not migrated"} hint={h.migrated ? "managed_* tables present." : "Run `node dist/migrate.js` inside the backend pod."} icon={Database} />
            <HealthTile
              ok={h.indexer.enabled}
              label="Indexer"
              value={h.indexer.enabled ? "Enabled" : "Disabled"}
              hint={
                Object.keys(h.indexer.lastBlockByNetwork).length
                  ? Object.entries(h.indexer.lastBlockByNetwork)
                      .map(([n, b]) => `${n}: ${formatInt(b)}`)
                      .join(" · ")
                  : "MANAGED_INDEXER_ENABLED controls the in-process scanner."
              }
            />
          </div>
        ) : (
          <p className="mt-3 text-xs text-danger">{apiErrorMessage(health.error, "Health check failed")}</p>
        )}
      </section>

      {/* Indexer status per network */}
      <section className="dash-card overflow-hidden">
        <div className={`flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2 ${bgInset}`}>
          <p className={`text-[10px] font-mono uppercase tracking-widest ${soft}`}>Deposit indexer</p>
          <div className="flex items-center gap-2">
            <button type="button" className={ghostBtn} onClick={() => void indexer.refetch()}>
              <RefreshCw size={12} className={indexer.isFetching ? "animate-spin" : ""} />
            </button>
            <button type="button" className={primaryBtn} onClick={() => void runNow()} disabled={running}>
              {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Run now
            </button>
          </div>
        </div>
        <div className="divide-y divide-border/60">
          {indexer.isLoading ? (
            <p className={`px-4 py-6 text-[11px] ${soft}`}>Loading indexer status…</p>
          ) : (indexer.data?.byNetwork ?? []).length === 0 ? (
            <p className={`px-4 py-6 text-[11px] ${soft}`}>No networks with active pools yet.</p>
          ) : (
            (indexer.data?.byNetwork ?? []).map((s) => (
              <div key={s.network} className="space-y-2 px-4 py-3">
                <div className="flex items-center gap-2">
                  <NetworkBadge network={s.network} />
                </div>
                <IndexerStatusBadge status={s} detailed />
              </div>
            ))
          )}
        </div>
        <p className={`border-t border-border px-4 py-2 text-[10px] ${soft}`}>
          Scans Transfer logs to managed addresses behind a confirmation lag; native BNB shows as balance changes. Errors here usually mean RPC rate limits.
        </p>
      </section>

      {/* Tracked tokens per network */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {NETWORKS.map((n) => (
          <TokensCard key={n} network={n} />
        ))}
      </div>
    </div>
  );
}

function HealthTile({ ok, label, value, hint, icon }: { ok: boolean; label: string; value: string; hint: string; icon?: typeof ShieldCheck }) {
  const { ink, soft, bgInset } = useManagedTheme();
  const Icon = icon ?? (ok ? ShieldCheck : ShieldAlert);
  return (
    <div className={`flex gap-3 rounded-lg border p-3 ${ok ? "border-border" : "border-danger/40"} ${bgInset}`}>
      <Icon size={18} className={`mt-0.5 shrink-0 ${ok ? "text-success" : "text-danger"}`} />
      <div className="min-w-0">
        <p className={`text-[10px] uppercase tracking-wider ${soft}`}>{label}</p>
        <p className={`text-sm font-semibold ${ok ? ink : "text-danger"}`}>{value}</p>
        <p className={`mt-0.5 break-words text-[10px] leading-snug ${soft}`}>{hint}</p>
      </div>
    </div>
  );
}

function TokensCard({ network }: { network: Network }) {
  const { ink, soft, bgInset, rowZebra } = useManagedTheme();
  const qc = useQueryClient();
  const [address, setAddress] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["managed", "tokens", network, "all"],
    queryFn: () => managedApi.listTokens({ network, includeHidden: true }),
    refetchInterval: 30000,
  });
  const tokens = data?.tokens ?? [];
  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: ["managed", "tokens"] });
    void qc.invalidateQueries({ queryKey: ["managed", "treasury"] });
  };

  async function add(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!isValidAddress(address)) {
      toast.error("Enter a 0x token contract address");
      return;
    }
    setAdding(true);
    try {
      const res = await managedApi.trackToken({ network, tokenAddress: address.trim() });
      toast.success(`Tracking ${res.token.symbol}`);
      setAddress("");
      invalidate();
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not track the token"));
    } finally {
      setAdding(false);
    }
  }

  async function toggleHidden(t: ManagedToken): Promise<void> {
    setBusyId(t.id);
    try {
      await managedApi.setTokenHidden(t.id, { hidden: !t.hidden });
      toast.success(t.hidden ? `${t.symbol} is visible again` : `${t.symbol} hidden from all views`);
      invalidate();
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not update the token"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="dash-card overflow-hidden">
      <div className={`flex items-center justify-between border-b border-border px-4 py-2 ${bgInset}`}>
        <div className="flex items-center gap-2">
          <p className={`text-[10px] font-mono uppercase tracking-widest ${soft}`}>Tokens</p>
          <NetworkBadge network={network} compact />
        </div>
        <span className={`text-[10px] ${soft}`}>{tokens.length} known</span>
      </div>
      <form onSubmit={(e) => void add(e)} className="flex gap-2 border-b border-border px-4 py-3">
        <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} placeholder={`0x… BEP-20 on ${networkLabel(network)}`} className={inputCls} spellCheck={false} />
        <button type="submit" className={`${primaryBtn} shrink-0`} disabled={adding || !isValidAddress(address)}>
          {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Track
        </button>
      </form>
      {error ? <p className="px-4 py-3 text-xs text-danger">{apiErrorMessage(error, "Could not load tokens")}<button type="button" className="ml-2 underline" onClick={() => void refetch()}>Retry</button></p> : null}
      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="border-b border-border">
              {["Token", "Contract", "Decimals", "Source", "Visibility"].map((h) => (
                <th key={h} className={`${thCls} ${soft}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={5} className={`py-6 text-center text-[11px] ${soft}`}>
                  Loading…
                </td>
              </tr>
            ) : tokens.length === 0 ? (
              <tr>
                <td colSpan={5} className={`py-6 text-center text-[11px] ${soft}`}>
                  No tokens yet. Discovered tokens appear here automatically after the first deposit.
                </td>
              </tr>
            ) : (
              tokens.map((t, i) => (
                <tr key={t.id} className={`border-b border-border/50 ${i % 2 ? rowZebra : ""} ${t.hidden ? "opacity-60" : ""}`}>
                  <td className={tdCls}>
                    <span className="inline-flex items-center gap-2">
                      <TokenBadge symbol={t.symbol} asset={t.tokenAddress} hidden={t.hidden} size="sm" />
                      <span className={`max-w-[160px] truncate text-[11px] ${soft}`} title={t.name}>
                        {t.name}
                      </span>
                    </span>
                  </td>
                  <td className={tdCls}>
                    <AddressCell address={t.tokenAddress} />
                  </td>
                  <td className={`${tdCls} tabular-nums ${ink}`}>{t.decimals}</td>
                  <td className={tdCls}>
                    <span className={`rounded-full border px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide ${t.source === "TRACKED" ? "border-success/35 text-success" : "border-border text-text-muted"}`}>
                      {t.source}
                    </span>
                  </td>
                  <td className={tdCls}>
                    <button type="button" className={ghostBtn} onClick={() => void toggleHidden(t)} disabled={busyId === t.id} title={t.hidden ? "Show in balances, treasury and holder views" : "Hide as spam everywhere"}>
                      {busyId === t.id ? <Loader2 size={12} className="animate-spin" /> : t.hidden ? <Eye size={12} /> : <EyeOff size={12} />}
                      {t.hidden ? "Unhide" : "Hide"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
