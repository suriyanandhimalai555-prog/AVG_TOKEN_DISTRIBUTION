import { useState } from "react";
import toast from "react-hot-toast";
import { Copy, LogOut, Loader2, AlertTriangle } from "lucide-react";
import { useWallet } from "@/context/WalletContext";
import { CHAINS, type Network } from "@/lib/wallet/chains";
import WalletModal from "./WalletModal";

function shortAddress(v: string): string {
  return `${v.slice(0, 6)}…${v.slice(-4)}`;
}

/** Chain badge: green on BSC mainnet, orange on testnet, red + Switch on wrong chain. */
function ChainBadge() {
  const { network, switchToBsc } = useWallet();

  if (network === "bscMainnet") {
    return (
      <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">
        BSC
      </span>
    );
  }
  if (network === "bscTestnet") {
    return (
      <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-semibold text-warning">
        Testnet
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => void switchToBsc("bscMainnet").then((ok) => ok && toast.success("Switched to BSC mainnet"))}
      className="inline-flex items-center gap-1 rounded-full bg-danger/15 px-2 py-0.5 text-[10px] font-semibold text-danger hover:bg-danger/25"
      title="Wallet is on an unsupported chain — click to switch to BSC"
    >
      <AlertTriangle size={10} aria-hidden />
      Wrong chain
    </button>
  );
}

export function WalletButton() {
  const { address, status, disconnect, accounts, switchAccounts, setActiveAddress } = useWallet();
  const [modalOpen, setModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const connected = status === "connected" && address;

  const copyAddress = () => {
    if (!address) return;
    void navigator.clipboard.writeText(address);
    toast.success("Address copied");
    setMenuOpen(false);
  };

  if (!connected) {
    return (
      <>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--app-text)] transition hover:border-accent hover:text-accent"
        >
          {status === "connecting" && <Loader2 size={12} className="animate-spin" aria-hidden />}
          Connect Wallet
        </button>
        <WalletModal open={modalOpen} onClose={() => setModalOpen(false)} />
      </>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-1.5 text-xs font-medium text-[var(--app-text)] transition hover:border-accent"
      >
        <span className="font-mono">{shortAddress(address)}</span>
        <ChainBadge />
      </button>

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden />
          <div className="absolute right-0 z-50 mt-1 w-48 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] py-1 shadow-lg">
            {accounts.length > 1 && (
              <>
                <div className="px-2 py-1">
                  <span className="block text-[10px] font-semibold uppercase tracking-wide text-[var(--app-muted)]">Accounts</span>
                  {accounts.map((addr) => (
                    <button
                      key={addr}
                      type="button"
                      onClick={() => {
                        setActiveAddress(addr);
                        setMenuOpen(false);
                        toast.success(`Account ${shortAddress(addr)}`);
                      }}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition ${
                        addr === address
                          ? "bg-accent/10 text-accent border-l-2 border-accent"
                          : "text-[var(--app-text)] hover:bg-accent/10"
                      }`}
                    >
                      <span className="font-mono">{shortAddress(addr)}</span>
                      {addr === address && (
                        <span className="ml-auto text-[10px] font-semibold text-success">Active</span>
                      )}
                    </button>
                  ))}
                </div>
                <div className="px-2 py-1 border-t border-[var(--app-border)]" />
              </>
            )}
            <button
              type="button"
              onClick={() => {
                void switchAccounts();
                setMenuOpen(false);
                toast.success("Account picker opened — choose in your wallet");
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--app-text)] hover:bg-accent/10"
            >
              <AlertTriangle size={13} aria-hidden />
              Switch account
            </button>
            <button
              type="button"
              onClick={copyAddress}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--app-text)] hover:bg-accent/10"
            >
              <Copy size={13} aria-hidden />
              Copy address
            </button>
            <button
              type="button"
              onClick={() => {
                disconnect();
                setMenuOpen(false);
                toast.success("Wallet disconnected");
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-danger hover:bg-danger/10"
            >
              <LogOut size={13} aria-hidden />
              Disconnect
            </button>
          </div>
        </>
      )}
    </div>
  );
}
