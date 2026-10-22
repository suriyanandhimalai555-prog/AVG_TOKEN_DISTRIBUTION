import { useEffect, useState } from "react";
import { Eye, EyeOff, Copy, Check, ShieldAlert } from "lucide-react";
import { copyToClipboard } from "@/lib/utils";
import Modal from "./Modal";
import { primaryBtn, useManagedTheme } from "./theme";

interface RevealMnemonicModalProps {
  open: boolean;
  /** The phrase (MNEMONIC pools) or the private key (PRIVATE_KEY pools). */
  mnemonic: string;
  /** Defaults to MNEMONIC. */
  seedType?: "MNEMONIC" | "PRIVATE_KEY";
  masterAddress: string;
  accountPath?: string;
  /** "created" shows the one-time wording; "reveal" is the Settings tab flow. */
  mode?: "created" | "reveal";
  onClose: () => void;
}

/**
 * One-time "Save your recovery phrase" modal. Close is only possible after the
 * admin ticks "I stored it". The phrase is held in component state only.
 */
export default function RevealMnemonicModal({ open, mnemonic, seedType = "MNEMONIC", masterAddress, accountPath, mode = "created", onClose }: RevealMnemonicModalProps) {
  const isKey = seedType === "PRIVATE_KEY";
  const { ink, bgInset } = useManagedTheme();
  const [revealed, setRevealed] = useState(false);
  const [stored, setStored] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      setRevealed(false);
      setStored(false);
      setCopied(false);
    }
  }, [open]);

  const words = mnemonic.trim().split(/\s+/).filter(Boolean);

  async function copy(): Promise<void> {
    await copyToClipboard(mnemonic.trim());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Modal
      open={open}
      title={isKey ? "Pool private key" : mode === "created" ? "Save your recovery phrase" : "Recovery phrase"}
      subtitle={
        isKey
          ? "This key is the pool master and the only backup of every managed wallet. Anyone with it controls them all. This reveal is audited."
          : mode === "created"
            ? "This is the only time the phrase is shown automatically. Anyone with it controls every wallet in the pool."
            : "Anyone with this phrase controls every wallet in the pool. This reveal is audited."
      }
      closable={false}
      size="md"
      z={60}
      footer={
        <button type="button" className={primaryBtn} disabled={!stored} onClick={onClose}>
          {stored ? "Close" : "Tick the checkbox to close"}
        </button>
      }
    >
      <div className="space-y-3">
        <div className="flex gap-2 rounded-lg border border-warning/35 bg-warning/[0.08] p-3">
          <ShieldAlert size={16} className="mt-0.5 shrink-0 text-warning" />
          <p className="text-[11px] leading-relaxed text-warning">
            Store the {isKey ? "key" : "phrase"} offline. Losing it together with the server encryption key makes the pool unrecoverable. Never paste it into chat, email, or a ticket.
          </p>
        </div>

        <div className={`relative rounded-lg border border-border p-3 ${bgInset}`}>
          {isKey ? (
            <p className={`break-all font-mono text-[12px] leading-relaxed ${revealed ? ink : "select-none blur-sm"}`} aria-hidden={!revealed}>
              {revealed ? mnemonic.trim() : "0x" + "•".repeat(64)}
            </p>
          ) : (
          <ol className={`grid grid-cols-3 gap-x-3 gap-y-1.5 font-mono text-[12px] sm:grid-cols-4 ${revealed ? ink : "select-none blur-sm"}`} aria-hidden={!revealed}>
            {words.map((w, i) => (
              <li key={`${i}-${w}`} className="flex items-baseline gap-1.5">
                <span className="w-5 text-right text-[10px] text-text-muted">{i + 1}.</span>
                <span>{revealed ? w : "••••••"}</span>
              </li>
            ))}
          </ol>
          )}
          {!revealed ? (
            <button
              type="button"
              onClick={() => setRevealed(true)}
              className="absolute inset-0 flex items-center justify-center gap-2 rounded-lg bg-black/5 text-xs font-semibold text-accent backdrop-blur-[1px] hover:bg-black/10 dark:bg-black/20 dark:hover:bg-black/30"
            >
              <Eye size={14} /> {isKey ? "Reveal private key" : `Reveal ${words.length} words`}
            </button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setRevealed((v) => !v)} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[11px] font-medium text-text-secondary hover:border-accent hover:text-accent">
            {revealed ? <EyeOff size={12} /> : <Eye size={12} />}
            {revealed ? "Hide" : "Reveal"}
          </button>
          <button type="button" onClick={() => void copy()} disabled={!revealed} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[11px] font-medium text-text-secondary hover:border-accent hover:text-accent disabled:opacity-40">
            {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
            {copied ? "Copied" : isKey ? "Copy key" : "Copy phrase"}
          </button>
        </div>

        <dl className="space-y-1 border-t border-border/60 pt-3 text-[11px]">
          <div className="flex justify-between gap-3">
            <dt className="text-text-secondary">{isKey ? "Master address (this key)" : "Master address (index 0)"}</dt>
            <dd className={`break-all text-right font-mono ${ink}`}>{masterAddress}</dd>
          </div>
          {accountPath ? (
            <div className="flex justify-between gap-3">
              <dt className="text-text-secondary">{isKey ? "Managed wallets" : "Derivation path"}</dt>
              <dd className={`text-right font-mono ${ink}`}>{isKey ? `key-derived seed, ${accountPath}/i` : `${accountPath}/i`}</dd>
            </div>
          ) : null}
        </dl>

        <label className={`flex cursor-pointer items-start gap-2 rounded-lg border border-border p-3 text-xs ${ink}`}>
          <input type="checkbox" checked={stored} onChange={(e) => setStored(e.target.checked)} className="mt-0.5 accent-accent" />
          <span>
            {isKey
              ? "I keep this private key in a safe place. It is the only way to recover the managed wallets outside this app."
              : "I stored the recovery phrase in a safe place and understand it will not be shown again automatically."}
          </span>
        </label>
      </div>
    </Modal>
  );
}
