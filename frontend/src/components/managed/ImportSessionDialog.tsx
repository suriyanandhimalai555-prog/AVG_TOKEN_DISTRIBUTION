/**
 * Import a distribution session's wallets (already generated, possibly
 * funded) into this pool. Keys are rebuilt and checked server side from the
 * session's own seed or key file; nothing secret passes through the browser.
 *
 * Steps: pick a session → preview counts → confirm (re-auth) → done.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { AlertTriangle, CheckCircle2, Download, Loader2 } from "lucide-react";
import type { ImportableSession, SessionImportPreview } from "@/lib/managedTypes";
import { managedApi } from "./client";
import { apiErrorMessage, fmtDateTime, networkLabel } from "./format";
import Modal from "./Modal";
import { useReauth } from "./ReauthDialog";
import { outlineBtn, primaryBtn, useManagedTheme } from "./theme";

interface ImportSessionDialogProps {
  open: boolean;
  poolId: string;
  poolName: string;
  onClose: () => void;
  onImported: (count: number) => void;
}

const MODE_LABEL: Record<ImportableSession["mode"], string> = {
  HD: "HD seed",
  INDEPENDENT: "Independent seeds",
  POOL: "Pool wallets",
};

const KEY_SOURCE_TEXT: Record<NonNullable<SessionImportPreview["keySource"]>, string> = {
  SESSION_SEED: "Keys rebuilt from the session's seed phrase.",
  WALLETS_CSV: "Keys taken from output/wallets.csv (matched address by address).",
  MIXED: "Keys rebuilt from the session's seed and output/wallets.csv.",
};

export default function ImportSessionDialog({ open, poolId, poolName, onClose, onImported }: ImportSessionDialogProps) {
  const { ink, soft, bgInset, hoverInset } = useManagedTheme();
  const qc = useQueryClient();
  const { withReauth, reauthDialog } = useReauth("Importing stores these wallets' private keys (encrypted) in the pool.");
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setSelected(null);
      setBusy(false);
      setError("");
    }
  }, [open]);

  const sessions = useQuery({
    queryKey: ["managed", "import-sessions", poolId],
    queryFn: () => managedApi.listImportableSessions(poolId),
    enabled: open,
    staleTime: 0,
  });

  const preview = useQuery({
    queryKey: ["managed", "import-preview", poolId, selected],
    queryFn: () => managedApi.previewSessionImport(poolId, selected as string),
    enabled: open && !!selected,
    staleTime: 0,
    retry: false,
  });

  const p = preview.data;
  const canImport = !!p && p.importable > 0 && p.importable <= p.remaining && !busy;

  function submit(): void {
    if (!selected || !canImport) return;
    setError("");
    withReauth(async () => {
      setBusy(true);
      try {
        const res = await managedApi.importSessionWallets(poolId, selected);
        toast.success(`Imported ${res.imported.toLocaleString()} wallets into “${poolName}”`);
        void qc.invalidateQueries({ queryKey: ["managed"] });
        onImported(res.imported);
        onClose();
      } catch (err) {
        setError(apiErrorMessage(err, "Import failed"));
      } finally {
        setBusy(false);
      }
    });
  }

  const list = sessions.data?.sessions ?? [];

  return (
    <>
      <Modal
        open={open}
        title="Import wallets from a distribution session"
        subtitle="Brings a session's existing wallets (and any tokens already sent to them) into this pool, so they show here and Sweep to master can move them."
        onClose={busy ? undefined : onClose}
        size="lg"
        footer={
          <>
            <button type="button" className={outlineBtn} onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className={primaryBtn} onClick={submit} disabled={!canImport}>
              {busy ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Importing…
                </>
              ) : (
                <>
                  <Download size={14} /> Import {p?.importable ? p.importable.toLocaleString() : ""} wallets
                </>
              )}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <p className={`text-[11px] font-mono uppercase tracking-widest ${soft}`}>
            Your sessions on {sessions.data ? networkLabel(sessions.data.network) : "this network"}
          </p>

          {sessions.isLoading ? (
            <p className={`inline-flex items-center gap-2 text-xs ${soft}`}>
              <Loader2 size={14} className="animate-spin" /> Loading sessions…
            </p>
          ) : sessions.error ? (
            <p className="text-xs text-danger">{apiErrorMessage(sessions.error, "Could not load sessions")}</p>
          ) : list.length === 0 ? (
            <p className={`rounded-lg border border-border p-3 text-xs ${bgInset} ${soft}`}>
              No distribution sessions with wallets on this network yet.
            </p>
          ) : (
            <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1" role="radiogroup" aria-label="Distribution session">
              {list.map((s) => {
                const active = s.id === selected;
                const done = s.inThisPool >= s.walletCount;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={done}
                    onClick={() => setSelected(s.id)}
                    className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition ${
                      active ? "border-accent bg-accent/[0.06]" : `border-border ${hoverInset}`
                    } ${done ? "cursor-not-allowed opacity-50" : ""}`}
                  >
                    <div className="min-w-0">
                      <p className={`truncate font-mono text-xs font-semibold ${ink}`}>
                        {s.shortId} · {s.tokenName}
                      </p>
                      <p className={`mt-0.5 text-[10px] ${soft}`}>
                        {fmtDateTime(s.createdAt)} · {s.status} · {MODE_LABEL[s.mode]}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={`font-mono text-xs ${ink}`}>{s.walletCount.toLocaleString()} wallets</p>
                      {s.inThisPool > 0 ? (
                        <p className="text-[10px] text-success">{done ? "all in this pool" : `${s.inThisPool.toLocaleString()} already here`}</p>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {selected ? (
            <div className={`rounded-lg border border-border p-3 text-xs ${bgInset}`}>
              {preview.isLoading ? (
                <p className={`inline-flex items-center gap-2 ${soft}`}>
                  <Loader2 size={14} className="animate-spin" /> Checking keys…
                </p>
              ) : preview.error ? (
                <p className="text-danger">{apiErrorMessage(preview.error, "Could not check this session")}</p>
              ) : p ? (
                <div className="space-y-2">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                    <Stat label="Will import" value={p.importable} strong />
                    <Stat label="Already here" value={p.alreadyInPool} />
                    <Stat label="In other pools" value={p.inOtherPools} />
                    <Stat label="No key found" value={p.keysUnavailable} warn={p.keysUnavailable > 0} />
                  </dl>
                  {p.keySource ? (
                    <p className={`flex items-start gap-1.5 text-[11px] ${soft}`}>
                      <CheckCircle2 size={13} className="mt-px shrink-0 text-success" /> {KEY_SOURCE_TEXT[p.keySource]} Every key was checked against
                      its wallet address.
                    </p>
                  ) : null}
                  {p.keysUnavailable > 0 ? (
                    <p className="flex items-start gap-1.5 text-[11px] text-warning">
                      <AlertTriangle size={13} className="mt-px shrink-0" /> {p.keysUnavailable.toLocaleString()} wallets are skipped: their keys are
                      not in the session seed or output/wallets.csv any more.
                    </p>
                  ) : null}
                  {p.importable > p.remaining ? (
                    <p className="text-[11px] text-danger">
                      The pool has room for {p.remaining.toLocaleString()} more wallets; this session has {p.importable.toLocaleString()} to import.
                    </p>
                  ) : null}
                  <p className={`border-t border-border pt-2 text-[11px] ${soft}`}>
                    Imported wallets keep their own keys, stored encrypted in the pool. The pool's master key is not a backup for them: keep the
                    session's seed (MASTER_MNEMONIC.txt / wallets.csv) backed up.
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          {error ? <p className="text-xs text-danger">{error}</p> : null}
        </div>
      </Modal>
      {reauthDialog}
    </>
  );
}

function Stat({ label, value, strong, warn }: { label: string; value: number; strong?: boolean; warn?: boolean }) {
  const { ink, soft } = useManagedTheme();
  return (
    <div>
      <dt className={`text-[10px] uppercase tracking-wider ${soft}`}>{label}</dt>
      <dd className={`font-mono ${strong ? "text-base font-semibold" : "text-sm"} ${warn ? "text-warning" : ink}`}>{value.toLocaleString()}</dd>
    </div>
  );
}
