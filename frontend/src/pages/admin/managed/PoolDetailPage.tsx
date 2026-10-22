import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ArrowLeft, Plus, Layers, Search, RefreshCw, Download, Eye, Archive, ArchiveRestore, Save, Loader2, AlertTriangle } from "lucide-react";
import type { ManagedWalletWithBalances, TransferJob } from "@/lib/managedTypes";
import RouteErrorFallback from "@/components/RouteErrorFallback";
import StatCard from "@/components/ui/StatCard";
import AddressCell from "@/components/ui/AddressCell";
import { copyToClipboard } from "@/lib/utils";
import { managedApi } from "@/components/managed/client";
import NetworkBadge from "@/components/managed/NetworkBadge";
import SeedTypeBadge from "@/components/managed/SeedTypeBadge";
import ManagedWalletTable from "@/components/managed/ManagedWalletTable";
import GenerateWalletsDialog from "@/components/managed/GenerateWalletsDialog";
import AssignHolderDialog from "@/components/managed/AssignHolderDialog";
import TransferDialog from "@/components/managed/TransferDialog";
import SweepDialog from "@/components/managed/SweepDialog";
import DepositFeed from "@/components/managed/DepositFeed";
import AssetSelect, { useAssetOptions, useSelectedAsset, type AssetOption } from "@/components/managed/AssetSelect";
import TokenIcon from "@/components/managed/TokenIcon";
import TransferJobsTable from "@/components/managed/TransferJobsTable";
import JobStatusDrawer from "@/components/managed/JobStatusDrawer";
import RevealMnemonicModal from "@/components/managed/RevealMnemonicModal";
import Modal from "@/components/managed/Modal";
import { useReauth } from "@/components/managed/ReauthDialog";
import { apiErrorMessage, fmtDateTime, formatUnits, hasActiveJob, isMainnet, isZeroWei, pollingInterval, timeAgo } from "@/components/managed/format";
import { NATIVE_ASSET } from "@/lib/managedTypes";
import { dangerBtn, ghostBtn, inputCls, outlineBtn, primaryBtn, useManagedTheme } from "@/components/managed/theme";

const TABS = ["wallets", "deposits", "transfers", "settings"] as const;
type Tab = (typeof TABS)[number];
const PAGE = 50;
/** SPEC §6.8 default MANAGED_MAX_WALLETS_PER_POOL; the API does not expose it. */
const MAX_WALLETS_PER_POOL = 10_000;

/** F2–F5: pool detail with Wallets | Deposits | Transfers | Settings tabs (?tab=). */
export default function PoolDetailPage() {
  const { poolId = "" } = useParams<{ poolId: string }>();
  const [params, setParams] = useSearchParams();
  const { ink, soft } = useManagedTheme();
  const qc = useQueryClient();
  const rawTab = params.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(rawTab ?? "") ? (rawTab as Tab) : "wallets";
  const setTab = (t: Tab): void => {
    const next = new URLSearchParams(params);
    if (t === "wallets") next.delete("tab");
    else next.set("tab", t);
    setParams(next, { replace: true });
  };

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["managed", "pool", poolId],
    queryFn: () => managedApi.getPool(poolId),
    enabled: Boolean(poolId),
    refetchInterval: 30000,
  });

  const [assetKey, setAssetKey] = useSelectedAsset();
  const { options: assetOptions } = useAssetOptions(data?.pool.network ?? null);
  const selectedAsset: AssetOption | null = assetKey ? (assetOptions.find((o) => o.asset === assetKey) ?? null) : null;
  const { data: treasury } = useQuery({
    queryKey: ["managed", "treasury", "pool", poolId],
    queryFn: () => managedApi.getPoolTreasury(poolId),
    enabled: Boolean(poolId),
    refetchInterval: 30000,
  });

  if (error) return <RouteErrorFallback message={apiErrorMessage(error, "Unable to load this pool.")} onRetry={() => void refetch()} />;
  if (isLoading || !data) {
    return (
      <p className={`inline-flex items-center gap-2 py-10 text-[11px] uppercase tracking-widest ${soft}`}>
        <Loader2 size={14} className="animate-spin" /> Loading pool…
      </p>
    );
  }
  const { pool, stats } = data;
  const archived = pool.status === "ARCHIVED";
  const invalidatePool = (): void => {
    void qc.invalidateQueries({ queryKey: ["managed", "pool", poolId] });
    void qc.invalidateQueries({ queryKey: ["managed", "pools"] });
  };

  return (
    <div className="space-y-5">
      <div>
        <Link to="/admin/managed" className={`mb-3 inline-flex items-center gap-1.5 border border-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest ${soft} hover:border-accent hover:text-accent`}>
          <ArrowLeft size={11} /> Pools
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className={`font-display text-xl font-semibold tracking-tight ${ink}`}>{pool.name}</h1>
              <NetworkBadge network={pool.network} />
              <SeedTypeBadge seedType={pool.seedType} />
              {archived ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                  <Archive size={10} /> Archived
                </span>
              ) : null}
            </div>
            <p className={`mt-1 flex flex-wrap items-center gap-x-2 text-xs ${soft}`}>
              <span>Master (index 0)</span>
              <AddressCell address={pool.masterAddress} full />
            </p>
          </div>
          <Link to={`/admin/treasury`} className={ghostBtn}>
            Treasury
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Wallets" value={stats.wallets} accent />
        <AssetStatCard treasury={treasury} asset={selectedAsset} wallets={stats.wallets} />
        <StatCard label="Last deposit" value={timeAgo(stats.lastDepositAt)} sub={stats.lastDepositAt ? fmtDateTime(stats.lastDepositAt) : "none yet"} />
        <StatCard label="Next index" value={pool.nextIndex} sub={`${(MAX_WALLETS_PER_POOL - (pool.nextIndex - 1)).toLocaleString()} remaining`} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
      <nav className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`font-mono text-[11px] uppercase tracking-widest px-3 py-1 border rounded-none transition-colors ${tab === t ? "border-accent text-accent" : `border-transparent ${soft} hover:text-accent`}`}
          >
            {t}
          </button>
        ))}
      </nav>
        {tab === "wallets" || tab === "deposits" ? (
          <AssetSelect options={assetOptions} value={assetKey} onChange={setAssetKey} />
        ) : null}
      </div>

      {tab === "wallets" ? <WalletsTab poolId={poolId} pool={pool} archived={archived} onChanged={invalidatePool} asset={selectedAsset} /> : null}
      {tab === "deposits" ? <DepositsTab poolId={poolId} mainnet={isMainnet(pool.network)} asset={selectedAsset} /> : null}
      {tab === "transfers" ? <TransfersTab poolId={poolId} mainnet={isMainnet(pool.network)} /> : null}
      {tab === "settings" ? <SettingsTab poolId={poolId} pool={pool} onChanged={invalidatePool} /> : null}
    </div>
  );
}

// ─── Wallets tab (F2) ────────────────────────────────────────────────────────

function WalletsTab({ poolId, pool, archived, onChanged, asset }: { poolId: string; pool: { masterAddress: string; network: "bscMainnet" | "bscTestnet"; nextIndex: number }; archived: boolean; onChanged: () => void; asset: AssetOption | null }) {
  const { soft, bgInset } = useManagedTheme();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showGenerate, setShowGenerate] = useState(false);
  const [showSweep, setShowSweep] = useState(false);
  const [assigning, setAssigning] = useState<ManagedWalletWithBalances | null>(null);
  const [transferring, setTransferring] = useState<ManagedWalletWithBalances | null>(null);
  const { withReauth, reauthDialog } = useReauth("Rotating a view link invalidates the old one immediately.");

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search.trim());
      setPage(0);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["managed", "wallets", poolId, page, debounced],
    queryFn: () => managedApi.listWallets(poolId, { skip: page * PAGE, limit: PAGE, search: debounced || undefined }),
    refetchInterval: 30000,
    placeholderData: (prev) => prev,
  });
  const wallets = data?.wallets ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const remaining = Math.max(0, MAX_WALLETS_PER_POOL - (pool.nextIndex - 1));

  const refreshWallets = (): void => {
    void qc.invalidateQueries({ queryKey: ["managed", "wallets", poolId] });
    onChanged();
  };

  function rotate(w: ManagedWalletWithBalances): void {
    withReauth(async () => {
      try {
        const res = await managedApi.rotateViewToken(w.id);
        await copyToClipboard(res.viewUrl);
        toast.success("Link rotated; the new link is on your clipboard");
      } catch (err) {
        toast.error(apiErrorMessage(err, "Could not rotate the link"));
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative w-full max-w-xs">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search address, label, holder…" className={`${inputCls} pl-9`} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={ghostBtn} onClick={() => void refetch()} title="Refresh">
            <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} />
          </button>
          <button type="button" className={outlineBtn} onClick={() => setShowSweep(true)} disabled={archived || total === 0}>
            <Layers size={14} /> Sweep to master{selected.size ? ` (${selected.size})` : ""}
          </button>
          <button type="button" className={primaryBtn} onClick={() => setShowGenerate(true)} disabled={archived || remaining < 1}>
            <Plus size={14} /> Generate wallets
          </button>
        </div>
      </div>

      {archived ? (
        <p className="flex items-center gap-2 rounded-lg border border-warning/35 bg-warning/[0.08] px-3 py-2 text-[11px] text-warning">
          <AlertTriangle size={14} /> This pool is archived: generation, transfers and sweeps are disabled. Restore it from Settings.
        </p>
      ) : null}

      <div className="dash-card overflow-hidden">
        <div className={`flex items-center justify-between border-b border-border px-4 py-2 ${bgInset}`}>
          <p className={`text-[10px] font-mono uppercase tracking-widest ${soft}`}>
            Wallets · {total.toLocaleString()}
            {selected.size ? ` · ${selected.size} selected` : ""}
          </p>
          {selected.size ? (
            <button type="button" className="text-[10px] font-medium text-accent hover:underline" onClick={() => setSelected(new Set())}>
              Clear selection
            </button>
          ) : null}
        </div>
        <ManagedWalletTable
          wallets={wallets}
          network={pool.network}
          loading={isLoading}
          selected={selected}
          onToggle={(id) =>
            setSelected((prev) => {
              const n = new Set(prev);
              if (n.has(id)) n.delete(id);
              else n.add(id);
              return n;
            })
          }
          onToggleAll={(ids, select) =>
            setSelected((prev) => {
              const n = new Set(prev);
              for (const id of ids) {
                if (select) n.add(id);
                else n.delete(id);
              }
              return n;
            })
          }
          onAssign={setAssigning}
          onTransfer={setTransferring}
          onRotate={rotate}
          readOnly={archived}
          asset={asset}
        />
        <div className={`flex items-center justify-between border-t border-border px-4 py-2 text-[11px] font-mono ${soft}`}>
          <span>
            Page {page + 1} / {pages}
          </span>
          <div className="flex gap-2">
            <button type="button" disabled={page <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className="border border-border px-3 py-1 disabled:opacity-30">
              Prev
            </button>
            <button type="button" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} className="border border-border px-3 py-1 disabled:opacity-30">
              Next
            </button>
          </div>
        </div>
      </div>

      <GenerateWalletsDialog open={showGenerate} poolId={poolId} remaining={remaining} nextIndex={pool.nextIndex} onClose={() => setShowGenerate(false)} onGenerated={refreshWallets} />
      <AssignHolderDialog open={assigning !== null} wallet={assigning} onClose={() => setAssigning(null)} onSaved={refreshWallets} />
      <TransferDialog open={transferring !== null} wallet={transferring} pool={{ masterAddress: pool.masterAddress, network: pool.network }} onClose={() => setTransferring(null)} />
      <SweepDialog open={showSweep} poolId={poolId} masterAddress={pool.masterAddress} network={pool.network} selectedWalletIds={[...selected]} initialAsset={asset?.asset ?? null} onClose={() => setShowSweep(false)} />
      {reauthDialog}
    </div>
  );
}

// ─── Deposits tab (F3) ───────────────────────────────────────────────────────

function DepositsTab({ poolId, mainnet, asset }: { poolId: string; mainnet: boolean; asset: AssetOption | null }) {
  const { soft, bgInset } = useManagedTheme();
  const [page, setPage] = useState(0);
  const tokenFilter = asset && asset.asset !== NATIVE_ASSET ? asset.asset : undefined;
  useEffect(() => setPage(0), [tokenFilter]);
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["managed", "deposits", poolId, page, tokenFilter ?? "all"],
    queryFn: () => managedApi.listDeposits(poolId, { skip: page * PAGE, limit: PAGE, asset: tokenFilter }),
    refetchInterval: 30000,
    placeholderData: (prev) => prev,
  });
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  return (
    <div className="dash-card overflow-hidden">
      <div className={`flex items-center justify-between border-b border-border px-4 py-2 ${bgInset}`}>
        <p className={`text-[10px] font-mono uppercase tracking-widest ${soft}`}>
          {tokenFilter ? `${asset?.symbol} deposits` : "Token deposits"} · {total.toLocaleString()}
        </p>
        <button type="button" className={ghostBtn} onClick={() => void refetch()}>
          <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} />
        </button>
      </div>
      {asset?.asset === NATIVE_ASSET ? (
        <p className={`px-4 py-8 text-center text-[11px] ${soft}`}>
          Native {asset.symbol} deposits are not itemized; they show up as balance changes in the Wallets tab. Pick a token to filter its deposits.
        </p>
      ) : (
        <DepositFeed deposits={data?.deposits ?? []} mainnet={mainnet} loading={isLoading} />
      )}
      <div className={`flex items-center justify-between border-t border-border px-4 py-2 text-[11px] font-mono ${soft}`}>
        <span>Native BNB deposits are not itemized; they appear as balance changes.</span>
        <div className="flex gap-2">
          <button type="button" disabled={page <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className="border border-border px-3 py-1 disabled:opacity-30">
            Prev
          </button>
          <button type="button" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} className="border border-border px-3 py-1 disabled:opacity-30">
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Transfers tab (F4) ──────────────────────────────────────────────────────

function TransfersTab({ poolId, mainnet }: { poolId: string; mainnet: boolean }) {
  const { ink, soft, bgInset } = useManagedTheme();
  const qc = useQueryClient();
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const { withReauth, reauthDialog } = useReauth("Retrying re-queues the job for the worker.");
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["managed", "transfers", "pool", poolId, page],
    queryFn: () => managedApi.listTransfers({ poolId, skip: page * PAGE, limit: PAGE }),
    refetchInterval: (q) => pollingInterval(hasActiveJob(q.state.data?.jobs)),
    placeholderData: (prev) => prev,
  });
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const byStatus = data?.byStatus ?? {};

  function retry(job: TransferJob): void {
    withReauth(async () => {
      try {
        await managedApi.retryTransfer(job.id);
        toast.success("Job re-queued");
        void qc.invalidateQueries({ queryKey: ["managed", "transfers"] });
        setOpen(job.id);
      } catch (err) {
        toast.error(apiErrorMessage(err, "Retry failed"));
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {(["PENDING", "FUNDING_GAS", "SENDING", "CONFIRMED", "FAILED", "CANCELLED"] as const).map((s) => (
          <span key={s} className={`rounded-full border border-border px-2 py-0.5 font-mono text-[10px] ${byStatus[s] ? ink : "text-text-muted"}`}>
            {s} <span className="font-semibold">{byStatus[s] ?? 0}</span>
          </span>
        ))}
      </div>
      <div className="dash-card overflow-hidden">
        <div className={`flex items-center justify-between border-b border-border px-4 py-2 ${bgInset}`}>
          <p className={`text-[10px] font-mono uppercase tracking-widest ${soft}`}>Transfer jobs · {total.toLocaleString()}</p>
          <button type="button" className={ghostBtn} onClick={() => void refetch()}>
            <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} />
          </button>
        </div>
        <TransferJobsTable jobs={data?.jobs ?? []} loading={isLoading} networkOf={() => (mainnet ? "bscMainnet" : "bscTestnet")} onOpen={(j) => setOpen(j.id)} onRetry={retry} />
        <div className={`flex items-center justify-between border-t border-border px-4 py-2 text-[11px] font-mono ${soft}`}>
          <span>
            Page {page + 1} / {pages}
          </span>
          <div className="flex gap-2">
            <button type="button" disabled={page <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className="border border-border px-3 py-1 disabled:opacity-30">
              Prev
            </button>
            <button type="button" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} className="border border-border px-3 py-1 disabled:opacity-30">
              Next
            </button>
          </div>
        </div>
      </div>
      <JobStatusDrawer jobId={open} mainnet={mainnet} onClose={() => setOpen(null)} />
      {reauthDialog}
    </div>
  );
}

// ─── Settings tab (F5) ───────────────────────────────────────────────────────

function SettingsTab({ poolId, pool, onChanged }: { poolId: string; pool: { name: string; status: "ACTIVE" | "ARCHIVED"; masterAddress: string; accountPath: string; mnemonicRevealedAt: string | null; seedType: "MNEMONIC" | "PRIVATE_KEY" }; onChanged: () => void }) {
  const { ink, soft } = useManagedTheme();
  const [name, setName] = useState(pool.name);
  const [saving, setSaving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [reveal, setReveal] = useState<{ secret: string; seedType: "MNEMONIC" | "PRIVATE_KEY"; accountPath: string } | null>(null);
  const isKeyPool = pool.seedType === "PRIVATE_KEY";
  const [revealing, setRevealing] = useState(false);
  const { withReauth, reauthDialog } = useReauth("Revealing the seed exposes control of every wallet in this pool.");
  const archived = pool.status === "ARCHIVED";
  const csvHref = useMemo(() => managedApi.exportPoolCsvUrl(poolId), [poolId]);

  useEffect(() => setName(pool.name), [pool.name]);

  async function rename(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!name.trim() || name.trim() === pool.name) return;
    setSaving(true);
    try {
      await managedApi.updatePool(poolId, { name: name.trim() });
      toast.success("Pool renamed");
      onChanged();
    } catch (err) {
      toast.error(apiErrorMessage(err, "Rename failed"));
    } finally {
      setSaving(false);
    }
  }

  async function toggleArchive(): Promise<void> {
    setArchiving(true);
    try {
      await managedApi.updatePool(poolId, { status: archived ? "ACTIVE" : "ARCHIVED" });
      toast.success(archived ? "Pool restored" : "Pool archived");
      setConfirmArchive(false);
      onChanged();
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not update the pool"));
    } finally {
      setArchiving(false);
    }
  }

  function revealSeed(): void {
    withReauth(async () => {
      setRevealing(true);
      try {
        const r = await managedApi.revealMnemonic(poolId);
        setReveal({ secret: (r.seedType === "PRIVATE_KEY" ? r.privateKey : r.mnemonic) ?? "", seedType: r.seedType, accountPath: r.accountPath });
        onChanged();
      } catch (err) {
        toast.error(apiErrorMessage(err, isKeyPool ? "Could not reveal the private key" : "Could not reveal the seed"));
      } finally {
        setRevealing(false);
      }
    });
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section className="dash-card space-y-3 p-4 sm:p-5">
        <p className="dash-section-title">General</p>
        <form onSubmit={(e) => void rename(e)} className="space-y-2">
          <label className="block text-xs font-medium text-text-secondary">Pool name</label>
          <div className="flex gap-2">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} maxLength={80} />
            <button type="submit" className={`${primaryBtn} shrink-0`} disabled={saving || !name.trim() || name.trim() === pool.name}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
            </button>
          </div>
        </form>
        <dl className="space-y-1 border-t border-border/60 pt-3 text-[11px]">
          <div className="flex justify-between gap-3">
            <dt className="text-text-secondary">Master address</dt>
            <dd>
              <AddressCell address={pool.masterAddress} />
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-text-secondary">Derivation path</dt>
            <dd className={`font-mono ${ink}`}>{pool.accountPath}/i</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-text-secondary">Seed last revealed</dt>
            <dd className={`font-mono ${ink}`}>{pool.mnemonicRevealedAt ? fmtDateTime(pool.mnemonicRevealedAt) : "never"}</dd>
          </div>
        </dl>
      </section>

      <section className="dash-card space-y-3 p-4 sm:p-5">
        <p className="dash-section-title">Export</p>
        <p className={`text-[11px] ${soft}`}>CSV with index, address, label, holder and visible balances. Contains no keys and no view tokens.</p>
        <a href={csvHref} download={`pool-${poolId}.csv`} className={outlineBtn}>
          <Download size={14} /> Export CSV
        </a>
      </section>

      <section className="dash-card space-y-3 border-warning/35 p-4 sm:p-5">
        <p className="dash-section-title text-warning">Recovery phrase</p>
        <p className={`text-[11px] ${soft}`}>{isKeyPool ? "Shows the imported private key after a password check. Every reveal is audited. This key is the master wallet and rebuilds every managed wallet." : "Shows the pool seed after a password check. Every reveal is audited. Import it into MetaMask to see the master as account 1."}</p>
        <button type="button" className={outlineBtn} onClick={revealSeed} disabled={revealing}>
          {revealing ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />} {isKeyPool ? "Reveal private key" : "Reveal seed"}
        </button>
      </section>

      <section className="dash-card space-y-3 border-danger/40 p-4 sm:p-5">
        <p className="dash-section-title text-danger">{archived ? "Restore" : "Archive"}</p>
        <p className={`text-[11px] ${soft}`}>
          {archived
            ? "Restoring re-enables generation, transfers, sweeps and holder view links."
            : "Archiving disables generation, transfers, sweeps and every holder view link. Balances stay on-chain and the seed is kept."}
        </p>
        <button type="button" className={archived ? outlineBtn : dangerBtn} onClick={() => setConfirmArchive(true)}>
          {archived ? <ArchiveRestore size={14} /> : <Archive size={14} />} {archived ? "Restore pool" : "Archive pool"}
        </button>
      </section>

      <Modal
        open={confirmArchive}
        title={archived ? "Restore this pool?" : "Archive this pool?"}
        onClose={archiving ? undefined : () => setConfirmArchive(false)}
        size="sm"
        footer={
          <>
            <button type="button" className={outlineBtn} onClick={() => setConfirmArchive(false)} disabled={archiving}>
              Cancel
            </button>
            <button type="button" className={archived ? primaryBtn : dangerBtn} onClick={() => void toggleArchive()} disabled={archiving}>
              {archiving ? <Loader2 size={14} className="animate-spin" /> : null} {archived ? "Restore" : "Archive"}
            </button>
          </>
        }
      >
        <p className={ink}>
          {archived ? `"${pool.name}" becomes active again.` : `"${pool.name}" will be hidden from Treasury and all holder links will stop working until restored.`}
        </p>
      </Modal>

      <RevealMnemonicModal open={reveal !== null} mnemonic={reveal?.secret ?? ""} seedType={reveal?.seedType} masterAddress={pool.masterAddress} accountPath={reveal?.accountPath} mode="reveal" onClose={() => setReveal(null)} />
      {reauthDialog}
    </div>
  );
}

// ─── Asset stat card (follows the token selector) ────────────────────────────

function AssetStatCard({
  treasury,
  asset,
  wallets,
}: {
  treasury: { totals: Array<{ asset: string; totalWei: string; decimals: number; walletsWithBalance: number }> } | undefined;
  asset: AssetOption | null;
  wallets: number;
}) {
  const totals = treasury?.totals ?? [];
  if (!asset) {
    const held = totals.filter((t) => !isZeroWei(t.totalWei)).length;
    return <StatCard label="Assets with balance" value={treasury ? held : "—"} sub="pick a token to see its total" />;
  }
  const row = totals.find((t) => t.asset.toLowerCase() === asset.asset);
  const wei = row?.totalWei ?? "0";
  const holders = row?.walletsWithBalance ?? 0;
  return (
    <StatCard
      label={
        <span className="inline-flex items-center gap-1.5">
          <TokenIcon asset={asset.asset} symbol={asset.symbol} size={14} />
          {`Total ${asset.symbol}`}
        </span>
      }
      value={treasury ? formatUnits(wei, row?.decimals ?? asset.decimals, 8) : "—"}
      sub={`${holders.toLocaleString()} of ${wallets.toLocaleString()} wallet${wallets === 1 ? "" : "s"} hold${holders === 1 ? "s" : ""} it`}
      accent={!isZeroWei(wei)}
    />
  );
}
