import { useEffect } from "react";
import { Loader2, Download, X, AlertCircle } from "lucide-react";
import { useWallet } from "@/context/WalletContext";
import type { WalletInfo } from "@/lib/wallet/detect";

interface WalletModalProps {
  open: boolean;
  onClose: () => void;
  onConnected?: () => void;
}

const FALLBACK_ICONS: Record<string, string> = {
  metamask: "🦊",
  trust: "🛡️",
  phantom: "👻",
};

function WalletRow({
  name,
  icon,
  installed,
  installUrl,
  connecting,
  onPick,
}: {
  name: string;
  icon?: string;
  installed: boolean;
  installUrl?: string;
  connecting: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={!installed || connecting}
      onClick={onPick}
      className={`flex w-full items-center gap-3 rounded-lg border border-[var(--app-border)] px-4 py-3 text-left transition ${
        installed
          ? "bg-[var(--app-surface)] hover:border-accent hover:bg-accent/5"
          : "cursor-not-allowed opacity-50"
      }`}
    >
      <span className="flex h-8 w-8 items-center justify-center text-xl">
        {icon ? <img src={icon} alt="" className="h-6 w-6 rounded" /> : FALLBACK_ICONS[name.toLowerCase().split(" ")[0]] || "🔗"}
      </span>
      <span className="flex-1 text-sm font-medium text-[var(--app-text)]">{name}</span>
      {connecting ? (
        <Loader2 size={16} className="animate-spin text-accent" aria-label="Connecting" />
      ) : installed ? (
        <span className="text-[10px] font-semibold uppercase tracking-wide text-success">Installed</span>
      ) : (
        <a
          href={installUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
        >
          <Download size={12} aria-hidden />
          Install
        </a>
      )}
    </button>
  );
}

export default function WalletModal({ open, onClose, onConnected }: WalletModalProps) {
  const { wallets, status, connectError, connect, refreshWallets } = useWallet();

  // Re-detect each time the modal opens (wallets can be installed mid-session).
  useEffect(() => {
    if (open) void refreshWallets();
  }, [open, refreshWallets]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handlePick = async (wallet: WalletInfo) => {
    try {
      await connect(wallet);
      onConnected?.();
      onClose();
    } catch {
      // error state stays visible inside the modal
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Connect a wallet"
    >
      <div
        className="w-full max-w-sm rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-[var(--app-text)]">Connect a wallet</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[var(--app-muted)] hover:text-[var(--app-text)]"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {wallets.length === 0 && status === "detecting" ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-[var(--app-muted)]">
              <Loader2 size={16} className="animate-spin" aria-hidden />
              Detecting wallets…
            </div>
          ) : (
            wallets.map((w) => (
              <WalletRow
                key={w.id}
                name={w.name}
                icon={w.icon}
                installed={w.installed}
                installUrl={w.installed ? undefined : w.installUrl}
                connecting={status === "connecting"}
                onPick={() => void handlePick(w as WalletInfo)}
              />
            ))
          )}
        </div>

        {connectError && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
            <AlertCircle size={14} className="mt-0.5 flex-shrink-0" aria-hidden />
            <span>{connectError}</span>
          </div>
        )}

        <p className="mt-4 text-[11px] leading-relaxed text-[var(--app-muted)]">
          Works with BNB Smart Chain. Your keys never leave the wallet — transactions are signed in
          the browser.
        </p>
      </div>
    </div>
  );
}
