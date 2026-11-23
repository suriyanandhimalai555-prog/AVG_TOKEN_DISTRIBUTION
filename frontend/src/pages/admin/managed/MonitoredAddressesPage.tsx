import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Plus, Loader2, RefreshCw, Trash2, Edit3, Eye, EyeOff } from "lucide-react";
import type { MonitoredAddress } from "@/lib/managedTypes";
import RouteErrorFallback from "@/components/RouteErrorFallback";
import StatCard from "@/components/ui/StatCard";
import { managedApi } from "@/components/managed/client";
import { useReauth } from "@/components/managed/ReauthDialog";
import { apiErrorMessage } from "@/components/managed/format";
import { ghostBtn, inputCls, outlineBtn, primaryBtn, useManagedTheme } from "@/components/managed/theme";
import Modal from "@/components/managed/Modal";

/** 0x + 64 hex, or 64 hex. */
function isAddressShape(v: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(v.trim());
}
/** 0x + 64 hex, or 64 hex. */
function isPrivateKeyShape(v: string): boolean {
  return /^(0x)?[0-9a-fA-F]{64}$/.test(v.trim());
}

export default function MonitoredAddressesPage() {
  const { ink, soft } = useManagedTheme();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [revealBusy, setRevealBusy] = useState(false);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["managed", "monitored-addresses"],
    queryFn: () => managedApi.listMonitoredAddresses(),
    refetchInterval: 30000,
  });

  const addresses = data?.addresses ?? [];

  const { withReauth: deleteReauth, reauthDialog: deleteReauthDialog } = useReauth(
    "Deleting a monitored address discards its stored private key."
  );
  const { withReauth: revealReauth, reauthDialog: revealReauthDialog } = useReauth(
    "Revealing a stored private key is sensitive — confirm your password."
  );

  if (error) return <RouteErrorFallback message={apiErrorMessage(error, "Unable to load monitored addresses.")} onRetry={() => void refetch()} />;
  if (isLoading) return <p className={`py-10 text-[11px] uppercase tracking-widest ${soft}`}><Loader2 size={14} className="animate-spin" /> Loading addresses…</p>;

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this monitored address? Its stored private key will be lost.")) return;
    await deleteReauth(async () => {
      try {
        await managedApi.deleteMonitoredAddress(id);
        toast.success("Address removed");
        void qc.invalidateQueries({ queryKey: ["managed", "monitored-addresses"] });
      } catch (err) {
        toast.error(apiErrorMessage(err, "Could not delete the address"));
      }
    });
  }

  async function handleReveal(id: string) {
    const a = addresses.find((x) => x.id === id);
    if (!a) return;
    setRevealingId(id);
    setRevealedKey(null);
    setRevealBusy(true);
    try {
      await revealReauth(async () => {
        try {
          const g = await managedApi.getMonitoredAddress(id);
          setRevealedKey(g.address.privateKey);
        } catch (err) {
          toast.error(apiErrorMessage(err, "Could not reveal the private key"));
          setRevealingId(null);
        } finally {
          setRevealBusy(false);
        }
      });
    } catch {
      setRevealingId(null);
      setRevealBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className={`text-[11px] uppercase tracking-widest ${soft}`}>Admin · Managed wallets</p>
          <h1 className={`mt-1 font-display text-xl font-semibold tracking-tight ${ink}`}>Monitored addresses</h1>
          <p className={`mt-1 max-w-2xl text-xs leading-relaxed ${soft}`}>
            Store a label, wallet address and private key for balance monitoring. Keys are entered manually — wallet connect (MetaMask/Trust/Phantom) only ever shows an address, never a private key.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className={ghostBtn} onClick={() => void refetch()} title="Refresh">
            <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} /> Refresh
          </button>
          <button type="button" className={primaryBtn} onClick={() => setShowNew(true)}>
            <Plus size={14} /> Add address
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Monitored addresses" value={addresses.length} accent />
      </div>

      {isLoading ? (
        <p className={`py-10 text-[11px] uppercase tracking-widest ${soft}`}><Loader2 size={14} className="animate-spin" /> Loading addresses…</p>
      ) : addresses.length === 0 ? (
        <div className="dash-card flex flex-col items-center gap-3 p-10 text-center">
          <p className={`text-sm font-semibold ${ink}`}>No monitored addresses yet</p>
          <p className={`max-w-sm text-xs ${soft}`}>Add a wallet address and its private key to track its balance here.</p>
          <button type="button" className={primaryBtn} onClick={() => setShowNew(true)}>
            <Plus size={14} /> Add address
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {addresses.map((a) => (
            <MonitoredAddressCard key={a.id} a={a} editing={editingId === a.id} onEdit={(id) => setEditingId(id)} onCancel={() => setEditingId(null)} onReveal={() => handleReveal(id)} onDelete={(id) => handleDelete(id)} />
          ))}
        </div>
      )}

      <NewAddressDialog open={showNew} onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); void qc.invalidateQueries({ queryKey: ["managed", "monitored-addresses"] }); }} />

      {editingId !== null && (
        <EditAddressDialog open a={addresses.find((x) => x.id === editingId)!} onClose={() => setEditingId(null)} onSaved={() => { setEditingId(null); void qc.invalidateQueries({ queryKey: ["managed", "monitored-addresses"] }); }} />
      )}

      {revealingId !== null && (
        <RevealKeyDialog
          open
          address={addresses.find((x) => x.id === revealingId)}
          key={revealedKey}
          busy={revealBusy}
          onClose={() => { setRevealingId(null); setRevealedKey(null); setRevealBusy(false); }}
          onReveal={handleReveal}
        />
      )}

      {deleteReauthDialog}
      {revealReauthDialog}
    </div>
  );
}

function MonitoredAddressCard({ a, editing, onEdit, onCancel, onReveal, onDelete }: { a: MonitoredAddress; editing: boolean; onEdit: (id: string) => void; onCancel: () => void; onReveal: () => void; onDelete: (id: string) => void }) {
  if (!editing) {
    return (
      <div className="dash-card flex flex-col gap-3 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-[var(--app-text)]">{a.name}</h2>
            <p className="mt-0.5 font-mono text-xs text-[var(--app-text-secondary)] break-all">{a.address}</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={onReveal} className="rounded p-1.5 text-xs text-[var(--app-text-muted)] hover:text-accent" title="Reveal private key"><Eye size={14} /></button>
            <button type="button" onClick={() => onEdit(a.id)} className="rounded p-1.5 text-xs text-[var(--app-text-muted)] hover:text-accent" title="Edit"><Edit3 size={14} /></button>
            <button type="button" onClick={() => onDelete(a.id)} className="rounded p-1.5 text-xs text-danger hover:bg-danger/10" title="Delete"><Trash2 size={14} /></button>
          </div>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--app-text-secondary)]">
          Created <span className="font-mono text-xs">{new Date(a.createdAt).toLocaleString()}</span>
        </p>
      </div>
    );
  }

  return (
    <div className="dash-card flex flex-col gap-3 p-4 sm:p-5">
      <div className="space-y-3">
        <label className="mb-1 block text-xs font-medium text-text-secondary">Name</label>
        <input defaultValue={a.name} className={inputCls} maxLength={200} autoFocus />
        <label className="mt-2 mb-1 block text-xs font-medium text-text-secondary">Address</label>
        <input defaultValue={a.address} className={`${inputCls} pr-10`} spellCheck={false} autoComplete="off" />
        <label className="mt-2 mb-1 block text-xs font-medium text-text-secondary">Private key</label>
        <div className="relative">
          <input type="password" defaultValue="" spellCheck={false} autoComplete="off" className={`${inputCls} pr-10`} placeholder="0x… or 64 hex (leave blank to keep current)" />
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className={primaryBtn} onClick={() => onEdit(a.id)}>Save</button>
          <button type="button" className={outlineBtn} onClick={onCancel}>Cancel</button>
          <button type="button" className={`${outlineBtn} text-danger`} onClick={() => onDelete(a.id)}>Delete</button>
        </div>
      </div>
    </div>
  );
}

function NewAddressDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { ink, soft } = useManagedTheme();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { withReauth, reauthDialog } = useReauth("Storing a private key is sensitive — confirm your password.");

  useEffect(() => { if (open) { setName(""); setAddress(""); setPrivateKey(""); setShowKey(false); setBusy(false); setError(""); } }, [open]);

  const addressOk = isAddressShape(address);
  const keyOk = isPrivateKeyShape(privateKey);
  const canSubmit = name.trim().length > 0 && addressOk && keyOk;

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    if (!canSubmit) { setError("Name, address and private key are required"); return; }
    withReauth(async () => {
      setBusy(true); setError("");
      try {
        await managedApi.createMonitoredAddress({ name: name.trim(), address: address.trim(), privateKey: privateKey.trim() });
        toast.success(`“${name.trim()}” added`);
        onCreated();
      } catch (err) { setError(apiErrorMessage(err, "Could not add the address")); } finally { setBusy(false); }
    });
  }

  return (
    <>
      <Modal open={open} title="Add monitored address" subtitle="Label, wallet address and private key for balance monitoring." onClose={busy ? undefined : onClose} size="lg" footer={
        <>
          <button type="button" className={outlineBtn} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="managed-new-address-form" className={primaryBtn} disabled={busy || !canSubmit}>{busy ? <><Loader2 size={14} className="animate-spin" /> Adding…</> : <>Add address</>}</button>
        </>
      }>
        <form id="managed-new-address-form" onSubmit={submit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="e.g. Community treasury" maxLength={200} autoFocus />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs font-medium text-text-secondary">Wallet address</label>
              <span className={`font-mono text-[10px] ${addressOk ? "text-success" : soft}`}>{addressOk ? "valid format" : "0x + 40 hex"}</span>
            </div>
            <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} spellCheck={false} autoComplete="off" placeholder="0x…" className={`${inputCls} pr-10 ${address && !addressOk ? "!border-danger" : ""}`} />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs font-medium text-text-secondary">Private key</label>
              <span className={`font-mono text-[10px] ${keyOk ? "text-success" : soft}`}>{keyOk ? "valid format" : "64 hex characters"}</span>
            </div>
            <div className="relative">
              <input type={showKey ? "text" : "password"} value={privateKey} onChange={(e) => setPrivateKey(e.target.value)} spellCheck={false} autoComplete="off" placeholder="0x… or 64 hex" className={`${inputCls} pr-10 ${privateKey && !keyOk ? "!border-danger" : ""}`} />
              <button type="button" onClick={() => setShowKey((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-text-muted hover:text-accent" aria-label={showKey ? "Hide private key" : "Show private key"}>{showKey ? <EyeOff size={15} /> : <Eye size={15} />}</button>
            </div>
            <p className={`mt-1 text-[11px] ${soft}`}>Stored in the database. Anyone with DB access can read all keys — internal tool only.</p>
          </div>
          {error ? <p className="text-xs text-danger">{error}</p> : null}
        </form>
      </Modal>
      {reauthDialog}
    </>
  );
}

function EditAddressDialog({ open, a, onClose, onSaved }: { open: boolean; a: MonitoredAddress; onClose: () => void; onSaved: () => void }) {
  const { ink, soft } = useManagedTheme();
  const [name, setName] = useState(a.name);
  const [address, setAddress] = useState(a.address);
  const [privateKey, setPrivateKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { withReauth, reauthDialog } = useReauth("Updating a stored private key confirms your password.");

  const addressOk = isAddressShape(address);
  const keyOk = privateKey.length === 0 || isPrivateKeyShape(privateKey);
  const canSubmit = name.trim().length > 0 && addressOk && keyOk;

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    if (!canSubmit) { setError("Name, address and private key are required"); return; }
    withReauth(async () => {
      setBusy(true); setError("");
      try {
        const patch: { name: string; address: string; privateKey?: string } = { name: name.trim(), address: address.trim() };
        if (privateKey.trim()) patch.privateKey = privateKey.trim();
        await managedApi.updateMonitoredAddress(a.id, patch);
        toast.success(`“${name.trim()}” updated`);
        onSaved();
      } catch (err) { setError(apiErrorMessage(err, "Could not update the address")); } finally { setBusy(false); }
    });
  }

  return (
    <>
      <Modal open={open} title="Edit monitored address" onClose={busy ? undefined : onClose} size="lg" footer={
        <>
          <button type="button" className={outlineBtn} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="managed-edit-address-form" className={primaryBtn} disabled={busy || !canSubmit}>{busy ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : <>Save changes</>}</button>
        </>
      }>
        <form id="managed-edit-address-form" onSubmit={submit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} maxLength={200} autoFocus />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs font-medium text-text-secondary">Wallet address</label>
              <span className={`font-mono text-[10px] ${addressOk ? "text-success" : soft}`}>{addressOk ? "valid format" : "0x + 40 hex"}</span>
            </div>
            <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} spellCheck={false} autoComplete="off" placeholder="0x…" className={`${inputCls} pr-10 ${address && !addressOk ? "!border-danger" : ""}`} />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs font-medium text-text-secondary">Private key</label>
              <span className={`font-mono text-[10px] ${keyOk ? "text-success" : soft}`}>{keyOk ? "valid format" : "leave blank to keep current, or 64 hex"}</span>
            </div>
            <div className="relative">
              <input type={showKey ? "text" : "password"} value={privateKey} onChange={(e) => setPrivateKey(e.target.value)} spellCheck={false} autoComplete="off" placeholder="new private key…" className={`${inputCls} pr-10 ${privateKey && !keyOk ? "!border-danger" : ""}`} />
              <button type="button" onClick={() => setShowKey((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-text-muted hover:text-accent" aria-label={showKey ? "Hide" : "Show"}>{showKey ? <EyeOff size={15} /> : <Eye size={15} />}</button>
            </div>
          </div>
          {error ? <p className="text-xs text-danger">{error}</p> : null}
        </form>
      </Modal>
      {reauthDialog}
    </>
  );
}

function RevealKeyDialog({ open, address, key, busy, onClose, onReveal }: { open: boolean; address: MonitoredAddress | undefined; key: string | null; busy: boolean; onClose: () => void; onReveal: () => void }) {
  const { ink, soft } = useManagedTheme();

  function copyKey() {
    if (!key) return;
    void navigator.clipboard.writeText(key);
    toast.success("Private key copied");
  }

  return (
    <>
      <Modal open={open} title={open && address ? `Reveal private key — ${address.name}` : "Reveal private key"} subtitle={open && address ? `Address: ${address.address}` : ""} onClose={busy ? undefined : onClose} size="lg" footer={
        <>
          <button type="button" className={outlineBtn} onClick={onClose} disabled={busy}>Cancel</button>
        </>
      }>
        <form onSubmit={(e) => e.preventDefault()} className="space-y-3">
          {busy ? (
            <p className={`text-[11px] ${soft}`}><Loader2 size={14} className="animate-spin" /> Revealing…</p>
          ) : key ? (
            <>
              <p className="mb-2 text-xs font-medium text-text-secondary">Private key (copy and store safely):</p>
              <div className="relative">
                <input type="text" readOnly value={key} className={`${inputCls} pr-10 font-mono text-xs break-all`} />
                <button type="button" onClick={copyKey} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-xs font-medium text-accent hover:bg-accent/10">Copy</button>
              </div>
              <p className="mt-2 text-[11px] text-[var(--app-text-secondary)]">Anyone who sees this key can move funds from this address. Store it offline.</p>
            </>
          ) : (
            <button type="button" className={primaryBtn} onClick={onReveal} disabled={busy}>Reveal private key</button>
          )}
        </form>
      </Modal>
    </>
  );
}
