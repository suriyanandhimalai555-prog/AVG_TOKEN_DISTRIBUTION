import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Loader2, UserPlus } from "lucide-react";
import type { ManagedWallet } from "@/lib/managedTypes";
import AddressCell from "@/components/ui/AddressCell";
import { managedApi } from "./client";
import { apiErrorMessage } from "./format";
import Modal from "./Modal";
import { inputCls, outlineBtn, primaryBtn, selectCls, useManagedTheme } from "./theme";

interface AssignHolderDialogProps {
  open: boolean;
  wallet: ManagedWallet | null;
  onClose: () => void;
  onSaved: () => void;
}

/** Flow 3: label, holder name, email, optional link to an existing app user, status. */
export default function AssignHolderDialog({ open, wallet, onClose, onSaved }: AssignHolderDialogProps) {
  const { bgInset } = useManagedTheme();
  const [label, setLabel] = useState("");
  const [holderName, setHolderName] = useState("");
  const [holderEmail, setHolderEmail] = useState("");
  const [linkEmail, setLinkEmail] = useState("");
  const [unlink, setUnlink] = useState(false);
  const [status, setStatus] = useState<ManagedWallet["status"]>("ACTIVE");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open && wallet) {
      setLabel(wallet.label ?? "");
      setHolderName(wallet.holderName ?? "");
      setHolderEmail(wallet.holderEmail ?? "");
      setLinkEmail("");
      setUnlink(false);
      setStatus(wallet.status);
      setError("");
      setBusy(false);
    }
  }, [open, wallet]);

  if (!wallet) return null;

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!wallet) return;
    if (holderEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(holderEmail.trim())) {
      setError("Holder email looks invalid");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await managedApi.updateWallet(wallet.id, {
        label: label.trim() || null,
        holderName: holderName.trim() || null,
        holderEmail: holderEmail.trim() || null,
        ...(unlink ? { holderUserEmail: null } : linkEmail.trim() ? { holderUserEmail: linkEmail.trim() } : {}),
        ...(status !== wallet.status ? { status } : {}),
      });
      toast.success("Wallet updated");
      onSaved();
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not save"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Assign holder"
      subtitle="Who receives this address. Holders get a read-only view link; they can never send."
      onClose={busy ? undefined : onClose}
      size="sm"
      footer={
        <>
          <button type="button" className={outlineBtn} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="managed-assign-form" className={primaryBtn} disabled={busy}>
            {busy ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Saving…
              </>
            ) : (
              <>
                <UserPlus size={14} /> Save
              </>
            )}
          </button>
        </>
      }
    >
      <form id="managed-assign-form" onSubmit={(e) => void submit(e)} className="space-y-3">
        <div className={`flex items-center justify-between rounded-lg border border-border px-3 py-2 ${bgInset}`}>
          <span className="text-[11px] text-text-secondary">#{wallet.derivationIndex}</span>
          <AddressCell address={wallet.address} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">Label</label>
          <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} className={inputCls} maxLength={80} placeholder="member-12" />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Holder name</label>
            <input type="text" value={holderName} onChange={(e) => setHolderName(e.target.value)} className={inputCls} maxLength={120} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Holder email</label>
            <input type="email" value={holderEmail} onChange={(e) => setHolderEmail(e.target.value)} className={inputCls} maxLength={200} />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">
            Link existing app user <span className="font-normal">(by email, optional)</span>
          </label>
          <input
            type="email"
            value={linkEmail}
            onChange={(e) => {
              setLinkEmail(e.target.value);
              if (e.target.value) setUnlink(false);
            }}
            className={inputCls}
            placeholder={wallet.holderUserId ? "Linked — enter another email to re-link" : "user@example.com"}
            disabled={unlink}
          />
          {wallet.holderUserId ? (
            <label className="mt-1.5 flex items-center gap-2 text-[11px] text-text-secondary">
              <input type="checkbox" checked={unlink} onChange={(e) => setUnlink(e.target.checked)} className="accent-accent" />
              Unlink the current user
            </label>
          ) : null}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as ManagedWallet["status"])} className={selectCls}>
            <option value="ACTIVE">Active</option>
            <option value="DISABLED">Disabled (view link stops working)</option>
          </select>
        </div>
        {error ? <p className="text-xs text-danger">{error}</p> : null}
      </form>
    </Modal>
  );
}
