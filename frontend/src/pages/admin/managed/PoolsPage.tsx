import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Plus, Loader2, RefreshCw, KeyRound, Sparkles, Archive } from "lucide-react";
import type { Network, Pool } from "@/lib/managedTypes";
import RouteErrorFallback from "@/components/RouteErrorFallback";
import StatCard from "@/components/ui/StatCard";
import { managedApi } from "@/components/managed/client";
import PoolCard from "@/components/managed/PoolCard";
import Modal from "@/components/managed/Modal";
import RevealMnemonicModal from "@/components/managed/RevealMnemonicModal";
import { useReauth } from "@/components/managed/ReauthDialog";
import { apiErrorMessage, isValidMnemonicShape, mnemonicWordCount, networkLabel } from "@/components/managed/format";
import { ghostBtn, inputCls, outlineBtn, primaryBtn, selectCls, useManagedTheme } from "@/components/managed/theme";

type SeedSource = "generate" | "import";

/** F1: list pools, create a pool (generate or import seed). */
export default function PoolsPage() {
  const { ink, soft } = useManagedTheme();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [reveal, setReveal] = useState<{ pool: Pool; mnemonic: string; accountPath: string } | null>(null);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["managed", "pools"],
    queryFn: () => managedApi.listPools(),
    refetchInterval: 30000,
  });

  const pools = data?.pools ?? [];
  const visible = useMemo(() => pools.filter((p) => showArchived || p.status === "ACTIVE"), [pools, showArchived]);
  const archivedCount = pools.filter((p) => p.status === "ARCHIVED").length;
  const totalWallets = pools.filter((p) => p.status === "ACTIVE").reduce((n, p) => n + p.walletCount, 0);

  if (error) return <RouteErrorFallback message={apiErrorMessage(error, "Unable to load pools.")} onRetry={() => void refetch()} />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className={`text-[11px] uppercase tracking-widest ${soft}`}>Admin · Managed wallets</p>
          <h1 className={`mt-1 font-display text-xl font-semibold tracking-tight ${ink}`}>Pools</h1>
          <p className={`mt-1 max-w-2xl text-xs leading-relaxed ${soft}`}>
            One encrypted master seed per pool. Managed wallets are derived from it, handed to holders as read-only addresses, and swept back by the master.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className={ghostBtn} onClick={() => void refetch()} title="Refresh">
            <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} /> Refresh
          </button>
          <button type="button" className={primaryBtn} onClick={() => setShowNew(true)}>
            <Plus size={14} /> New pool
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Active pools" value={pools.length - archivedCount} accent />
        <StatCard label="Managed wallets" value={totalWallets} />
        <StatCard label="Archived" value={archivedCount} sub={archivedCount ? "hidden by default" : undefined} />
      </div>

      {isLoading ? (
        <p className={`inline-flex items-center gap-2 py-10 text-[11px] uppercase tracking-widest ${soft}`}>
          <Loader2 size={14} className="animate-spin" /> Loading pools…
        </p>
      ) : visible.length === 0 ? (
        <div className="dash-card flex flex-col items-center gap-3 p-10 text-center">
          <KeyRound size={28} className="text-accent" />
          <p className={`text-sm font-semibold ${ink}`}>No pools yet</p>
          <p className={`max-w-sm text-xs ${soft}`}>Create a pool to generate a master seed and start deriving managed deposit addresses.</p>
          <button type="button" className={primaryBtn} onClick={() => setShowNew(true)}>
            <Plus size={14} /> New pool
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((p) => (
            <PoolCard key={p.id} pool={p} />
          ))}
        </div>
      )}

      {archivedCount > 0 ? (
        <button type="button" className={ghostBtn} onClick={() => setShowArchived((v) => !v)}>
          <Archive size={12} /> {showArchived ? "Hide" : "Show"} {archivedCount} archived
        </button>
      ) : null}

      <NewPoolDialog
        open={showNew}
        onClose={() => setShowNew(false)}
        onCreated={(pool, phrase) => {
          setShowNew(false);
          void qc.invalidateQueries({ queryKey: ["managed", "pools"] });
          if (phrase) setReveal({ pool, mnemonic: phrase.mnemonic, accountPath: phrase.accountPath });
          else navigate(`/admin/managed/pools/${pool.id}`);
        }}
      />

      <RevealMnemonicModal
        open={reveal !== null}
        mnemonic={reveal?.mnemonic ?? ""}
        masterAddress={reveal?.pool.masterAddress ?? ""}
        accountPath={reveal?.accountPath}
        mode="created"
        onClose={() => {
          const id = reveal?.pool.id;
          setReveal(null);
          if (id) navigate(`/admin/managed/pools/${id}`);
        }}
      />
    </div>
  );
}

function NewPoolDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (pool: Pool, phrase: { mnemonic: string; accountPath: string } | null) => void;
}) {
  const { ink, soft, bgInset } = useManagedTheme();
  const [name, setName] = useState("");
  const [network, setNetwork] = useState<Network>("bscTestnet");
  const [source, setSource] = useState<SeedSource>("generate");
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { withReauth, reauthDialog } = useReauth("Creating a pool stores a new encrypted master seed.");

  useEffect(() => {
    if (open) {
      setName("");
      setNetwork("bscTestnet");
      setSource("generate");
      setPhrase("");
      setBusy(false);
      setError("");
    }
  }, [open]);

  const words = mnemonicWordCount(phrase);
  const phraseOk = source === "generate" || isValidMnemonicShape(phrase);
  const canSubmit = name.trim().length > 0 && phraseOk;

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    if (!canSubmit) {
      setError(source === "import" && !phraseOk ? "Phrase must be 12 or 24 lowercase words" : "Name is required");
      return;
    }
    withReauth(async () => {
      setBusy(true);
      setError("");
      try {
        const res = await managedApi.createPool({
          name: name.trim(),
          network,
          ...(source === "import" ? { mnemonic: phrase.trim().split(/\s+/).join(" ") } : {}),
        });
        toast.success(`Pool "${res.pool.name}" created`);
        if (source === "generate") {
          // The create response never echoes the seed; fetch it once for the
          // one-time "save your recovery phrase" modal (re-auth is still valid).
          try {
            const r = await managedApi.revealMnemonic(res.pool.id);
            onCreated(res.pool, { mnemonic: r.mnemonic, accountPath: r.accountPath });
          } catch (err) {
            toast.error(apiErrorMessage(err, "Pool created, but the phrase could not be revealed. Use Settings › Reveal seed."));
            onCreated(res.pool, null);
          }
        } else {
          onCreated(res.pool, null);
        }
        setPhrase("");
      } catch (err) {
        setError(apiErrorMessage(err, "Could not create the pool"));
      } finally {
        setBusy(false);
      }
    });
  }

  return (
    <>
      <Modal
        open={open}
        title="New pool"
        subtitle="A pool is one master seed on one network. The master wallet is derivation index 0."
        onClose={busy ? undefined : onClose}
        size="md"
        footer={
          <>
            <button type="button" className={outlineBtn} onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" form="managed-new-pool-form" className={primaryBtn} disabled={busy || !canSubmit}>
              {busy ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Creating…
                </>
              ) : (
                <>
                  <Sparkles size={14} /> Create pool
                </>
              )}
            </button>
          </>
        }
      >
        <form id="managed-new-pool-form" onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-text-secondary">Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Community A" maxLength={80} autoFocus />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">Network</label>
              <select value={network} onChange={(e) => setNetwork(e.target.value as Network)} className={selectCls}>
                <option value="bscTestnet">{networkLabel("bscTestnet")}</option>
                <option value="bscMainnet">{networkLabel("bscMainnet")}</option>
              </select>
            </div>
          </div>

          <fieldset>
            <legend className="mb-1.5 text-xs font-medium text-text-secondary">Seed source</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(
                [
                  { v: "generate", t: "Generate 12 words", d: "A fresh BIP-39 phrase is generated server side and shown once." },
                  { v: "import", t: "Import phrase", d: "Use an existing 12 or 24 word phrase (e.g. from MetaMask)." },
                ] as Array<{ v: SeedSource; t: string; d: string }>
              ).map((o) => (
                <label key={o.v} className={`flex cursor-pointer gap-2 rounded-lg border p-3 ${source === o.v ? "border-accent bg-accent/10" : "border-border"}`}>
                  <input type="radio" name="seed-source" value={o.v} checked={source === o.v} onChange={() => setSource(o.v)} className="mt-0.5 accent-accent" />
                  <span>
                    <span className={`block text-xs font-semibold ${source === o.v ? "text-accent" : ink}`}>{o.t}</span>
                    <span className={`block text-[11px] ${soft}`}>{o.d}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {source === "import" ? (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs font-medium text-text-secondary">Recovery phrase</label>
                <span className={`font-mono text-[10px] ${words === 12 || words === 24 ? "text-success" : soft}`}>{words} / 12 or 24 words</span>
              </div>
              <textarea
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                rows={3}
                spellCheck={false}
                autoComplete="off"
                className={`${inputCls} resize-none ${phrase && !phraseOk ? "!border-danger" : ""}`}
                placeholder="word1 word2 word3 …"
              />
              <p className={`mt-1 text-[11px] ${soft}`}>Sent once over HTTPS, encrypted at rest with AES-256-GCM, never logged or echoed back.</p>
            </div>
          ) : (
            <div className={`rounded-lg border border-border p-3 text-[11px] ${bgInset} ${soft}`}>
              After creation you will see the phrase exactly once. Store it offline before generating wallets.
            </div>
          )}
          {error ? <p className="text-xs text-danger">{error}</p> : null}
        </form>
      </Modal>
      {reauthDialog}
    </>
  );
}
