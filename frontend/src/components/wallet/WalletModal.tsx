import { useEffect, useState } from "react";
import { Loader2, Download, X, ArrowLeft, AlertCircle, CheckCircle } from "lucide-react";
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

const ICON_BY_NAME: Record<string, string> = {
  metamask: "🦊",
  trustwallet: "🛡️",
  trust: "🛡️",
  phantom: "👻",
};

function iconFor(name: string, icon?: string): React.ReactNode {
  if (icon) return <img src={icon} alt="" className="h-6 w-6 rounded" />;
  return ICON_BY_NAME[name.toLowerCase().replace(/\s+/g, "")] || "🔗";
}

interface WalletRowProps {
  name: string;
  icon?: string;
  installed: boolean;
  installUrl?: string;
  connecting: boolean;
  onPick: () => void;
}

function WalletRow({ name, icon, installed, installUrl, connecting, onPick }: WalletRowProps) {
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
      <span className="flex h-8 w-8 items-center justify-center text-xl">{iconFor(name, icon)}</span>
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

interface AccountRowProps {
  address: string;
  selected: boolean;
  onSelect: () => void;
}

function AccountRow({ address, selected, onSelect }: AccountRowProps) {
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition ${
        selected
          ? "border-accent bg-accent/10"
          : "bg-[var(--app-surface)] hover:border-accent hover:bg-accent/5"
      }`}
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--app-border)] text-[10px] font-bold">
        {address.slice(2, 4).toUpperCase()}
      </span>
      <span className="flex-1 font-mono text-xs text-[var(--app-text)]">{short}</span>
      <span className="w-px h-4 bg-[var(--app-border)] flex-shrink-0" aria-hidden />
      {selected ? (
        <span className="text-xs font-semibold text-success">Selected</span>
      ) : (
        <span className="text-[10px] text-text-secondary">Select account</span>
      )}
    </button>
  );
}

type Step = "pickWallet" | "pickAccount" | "confirm";

export default function WalletModal({ open, onClose, onConnected }: WalletModalProps) {
  const { wallets, status, connectError, connect, refreshWallets, accounts } = useWallet();
  const [step, setStep] = useState<Step>("pickWallet");
  const [selectedWallet, setSelectedWallet] = useState<WalletInfo | null>(null);
  const [confirmAddress, setConfirmAddress] = useState<string | null>(null);

  // Re-detect each time the modal opens (wallets can be installed mid-session).
  useEffect(() => {
    if (open) {
      setStep("pickWallet");
      setSelectedWallet(null);
      setConfirmAddress(null);
      void refreshWallets();
    }
  }, [open, refreshWallets]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handlePickWallet = async (wallet: WalletInfo) => {
    setSelectedWallet(wallet);
    setStep("pickAccount");
    try {
      // Request accounts — this is the wallet's permission dialog where the
      // user chooses which account(s) to share.
      const requested = (await wallet.eip1193.request({
        method: "eth_requestAccounts",
      })) as string[];
      if (!requested?.length) {
        setStep("pickWallet");
        return;
      }
      setConfirmAddress(requested[0]);
    } catch (err: unknown) {
      const e = err as { code?: number };
      if (e.code === 4001) {
        setStep("pickWallet");
      }
      setSelectedWallet(null);
    }
  };

  const handleBack = () => {
    setStep("pickWallet");
    setSelectedWallet(null);
    setConfirmAddress(null);
  };

  const handleConnect = async () => {
    if (!selectedWallet || !confirmAddress) return;
    try {
      await connect(selectedWallet);
      onConnected?.();
      onClose();
    } catch {
      // error state stays visible inside the modal
    }
  };

  if (!open) return null;

  const header = (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-base font-semibold text-[var(--app-text)]">{step === "pickWallet" ? "Connect a wallet" : step === "pickAccount" ? "Choose an account" : "Confirm connection"}</h2>
      <button
        type="button"
        onClick={step === "pickWallet" ? onClose : handleBack}
        className="rounded p-1 text-[var(--app-muted)] hover:text-[var(--app-text)]"
        aria-label={step === "pickWallet" ? "Close" : "Back"}
      >
        {step === "pickWallet" ? <X size={18} /> : <ArrowLeft size={18} />}
      </button>
    </div>
  );

  const footer =
    step === "pickWallet" ? (
      <p className="mt-4 text-[11px] leading-relaxed text-[var(--app-muted)]">
        Works with BNB Smart Chain. Your keys never leave the wallet — transactions are signed in
        the browser.
      </p>
    ) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={step === "pickWallet" ? "Connect a wallet" : step === "pickAccount" ? "Choose an account" : "Confirm wallet connection"}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {header}

        <div className="flex flex-col gap-2">
          {step === "pickWallet" ? (
            <>
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
                    onPick={() => void handlePickWallet(w as WalletInfo)}
                  />
                ))
              )}
            </>
          ) : step === "pickAccount" ? (
            <>
              <p className="text-[11px] font-medium text-[var(--app-text-secondary)] mb-2">
                Select the account to connect:
              </p>
              {accounts.length > 0 ? (
                accounts.map((addr) => (
                  <AccountRow
                    key={addr}
                    address={addr}
                    selected={addr === confirmAddress}
                    onSelect={() => setConfirmAddress(addr)}
                  />
                ))
              ) : (
                <div className="flex items-center justify-center gap-2 py-6 text-sm text-[var(--app-muted)]">
                  No accounts found in wallet
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center gap-3 rounded-lg border border-[var(--app-border)] bg-accent/5 px-4 py-3 mb-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--app-border)] text-[10px] font-bold bg-success/10 text-success border-success/30">
                  {confirmAddress?.slice(2, 4).toUpperCase()}
                </span>
                <div>
                  <span className="block font-mono text-xs text-[var(--app-text)]">{confirmAddress}</span>
                  <span className="block text-[10px] text-[var(--app-text-secondary)] mt-0.5">
                    {selectedWallet?.name} • BNB Smart Chain
                  </span>
                </div>
              </div>
              <p className="text-[11px] leading-relaxed text-[var(--app-muted)]">
                This account will sign transactions. Connecting does not share your private key.
              </p>
            </>
          )}
        </div>

        {connectError && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
            <AlertCircle size={14} className="mt-0.5 flex-shrink-0" aria-hidden />
            <span>{connectError}</span>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-2">
          {step !== "pickWallet" && (
            <button
              type="button"
              onClick={handleBack}
              className="flex-1 py-2.5 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] text-xs font-semibold text-[var(--app-text)] hover:border-accent"
              disabled={status === "connecting"}
            >
              Back
            </button>
          )}
          {step === "pickAccount" ? (
            <button
              type="button"
              onClick={handleConnect}
              disabled={!confirmAddress || status === "connecting"}
              className={`flex-1 py-2.5 rounded-lg text-xs font-semibold transition ${
                !confirmAddress || status === "connecting"
                  ? "border border-[var(--app-border)] bg-[var(--app-surface-disabled, var(--app-surface))] text-[var(--app-muted)] cursor-not-allowed"
                  : "bg-accent text-white hover:bg-accent/90"
              }`}
            >
              {status === "connecting" ? <Loader2 size={14} className="animate-spin" /> : "Connect"}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleConnect}
                disabled={!selectedWallet || status === "connecting"}
                className={`flex-1 py-2.5 rounded-lg text-xs font-semibold transition ${
                  !selectedWallet || status === "connecting"
                    ? "border border-[var(--app-border)] bg-[var(--app-surface-disabled, var(--app-surface))] text-[var(--app-muted)] cursor-not-allowed"
                    : "bg-accent text-white hover:bg-accent/90"
                }`}
              >
                {status === "connecting" ? <Loader2 size={14} className="animate-spin" /> : "Connect"}
              </button>
              {step === "confirm" && accounts.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    setStep("pickAccount");
                    setSelectedWallet(null);
                    setConfirmAddress(null);
                  }}
                  className="flex-1 py-2.5 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] text-xs font-semibold text-[var(--app-text)] hover:border-accent"
                >
                  Choose a different account
                </button>
              )}
            </>
          )}
        </div>

        {footer}
      </div>
    </div>
  );
}
