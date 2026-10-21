import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Loader2, Sparkles } from "lucide-react";
import { managedApi } from "./client";
import { apiErrorMessage } from "./format";
import Modal from "./Modal";
import { inputCls, outlineBtn, primaryBtn, useManagedTheme } from "./theme";

interface GenerateWalletsDialogProps {
  open: boolean;
  poolId: string;
  /** Remaining capacity (limit − existing). */
  remaining: number;
  nextIndex: number;
  onClose: () => void;
  onGenerated: (count: number) => void;
}

/** Flow 2: derive N new managed wallets server side (no keys ever leave the server). */
export default function GenerateWalletsDialog({ open, poolId, remaining, nextIndex, onClose, onGenerated }: GenerateWalletsDialogProps) {
  const { ink, bgInset } = useManagedTheme();
  const [countInput, setCountInput] = useState("10");
  const [labelPrefix, setLabelPrefix] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setCountInput(String(Math.min(10, Math.max(1, remaining))));
      setLabelPrefix("");
      setError("");
      setBusy(false);
    }
  }, [open, remaining]);

  const count = Number(countInput);
  const countOk = Number.isInteger(count) && count >= 1 && count <= remaining;
  const from = nextIndex;
  const to = nextIndex + (countOk ? count : 0) - 1;

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!countOk) {
      setError(`Enter a whole number between 1 and ${remaining.toLocaleString()}`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await managedApi.generateWallets(poolId, { count, labelPrefix: labelPrefix.trim() || undefined });
      toast.success(`Generated ${res.created.length.toLocaleString()} wallets`);
      onGenerated(res.created.length);
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err, "Generation failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Generate wallets"
      subtitle="Addresses are derived from the pool seed at the next free indexes. Private keys are never stored."
      onClose={busy ? undefined : onClose}
      size="sm"
      footer={
        <>
          <button type="button" className={outlineBtn} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="managed-generate-form" className={primaryBtn} disabled={busy || !countOk}>
            {busy ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Deriving…
              </>
            ) : (
              <>
                <Sparkles size={14} /> Generate {countOk ? count.toLocaleString() : ""}
              </>
            )}
          </button>
        </>
      }
    >
      <form id="managed-generate-form" onSubmit={(e) => void submit(e)} className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">
            Count <span className="font-normal">(1 – {remaining.toLocaleString()} remaining)</span>
          </label>
          <input
            type="number"
            min={1}
            max={remaining}
            value={countInput}
            onChange={(e) => setCountInput(e.target.value)}
            className={`${inputCls} ${!countOk && countInput ? "!border-danger" : ""}`}
            disabled={remaining < 1}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">
            Label prefix <span className="font-normal">(optional)</span>
          </label>
          <input type="text" value={labelPrefix} onChange={(e) => setLabelPrefix(e.target.value)} placeholder="member-" className={inputCls} maxLength={40} />
          <p className="mt-1 text-[11px] text-text-secondary">Labels become “{labelPrefix || "prefix"}{from}”, “{labelPrefix || "prefix"}{from + 1}”, …</p>
        </div>
        <div className={`rounded-lg border border-border p-3 text-[11px] ${bgInset}`}>
          <div className="flex justify-between">
            <span className="text-text-secondary">Derivation indexes</span>
            <span className={`font-mono ${ink}`}>{countOk ? `${from} … ${to}` : "—"}</span>
          </div>
          <div className="mt-1 flex justify-between">
            <span className="text-text-secondary">Path</span>
            <span className={`font-mono ${ink}`}>m/44'/60'/0'/0/i</span>
          </div>
        </div>
        {remaining < 1 ? <p className="text-xs text-warning">This pool has reached its wallet limit.</p> : null}
        {error ? <p className="text-xs text-danger">{error}</p> : null}
      </form>
    </Modal>
  );
}
