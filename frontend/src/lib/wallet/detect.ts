/**
 * Browser wallet detection — EIP-6963 multi-provider discovery with
 * legacy fallbacks. Supports MetaMask, Trust Wallet, and Phantom (EVM mode).
 *
 * EIP-6963: wallets dispatch `eip6963:announceProvider` CustomEvents with
 * { info: { uuid, name, icon, rdns }, provider }. We listen for ~600ms, then
 * fall back to well-known injected globals for wallets without EIP-6963.
 */

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
  isMetaMask?: boolean;
  isTrust?: boolean;
  isTrustWallet?: boolean;
}

export type WalletId = "metamask" | "trust" | "phantom";

export interface WalletInfo {
  id: WalletId;
  name: string;
  /** SVG data-URI from EIP-6963 announce, when available. */
  icon?: string;
  eip1193: Eip1193Provider;
  installed: true;
}

/** A wallet that is NOT installed in this browser — shown with a download link. */
export interface NotInstalledWallet {
  id: WalletId;
  name: string;
  icon?: string;
  installed: false;
  installUrl: string;
}

export type DiscoveredWallet = WalletInfo | NotInstalledWallet;

interface Eip6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

const RDNS_TO_ID: Record<string, WalletId> = {
  "io.metamask": "metamask",
  "com.trustwallet.app": "trust",
  "app.phantom": "phantom",
};

export const WALLET_CATALOG: { id: WalletId; name: string; installUrl: string; icon?: string }[] = [
  { id: "metamask", name: "MetaMask", installUrl: "https://metamask.io/download/" },
  { id: "trust", name: "Trust Wallet", installUrl: "https://trustwallet.com/download" },
  { id: "phantom", name: "Phantom (EVM)", installUrl: "https://phantom.app/download" },
];

function eip1193From(global: unknown): Eip1193Provider | undefined {
  if (global && typeof global === "object" && "request" in global) {
    return global as Eip1193Provider;
  }
  return undefined;
}

function idForProvider(p: Eip1193Provider, rdns?: string): WalletId | undefined {
  if (rdns && RDNS_TO_ID[rdns]) return RDNS_TO_ID[rdns];
  if (p.isTrust || p.isTrustWallet) return "trust";
  if (p.isMetaMask) return "metamask";
  return undefined;
}

/** Collect EIP-6963 announced providers over `waitMs`. */
function collectAnnounced(waitMs: number): Promise<Map<WalletId, WalletInfo>> {
  return new Promise((resolve) => {
    const found = new Map<WalletId, WalletInfo>();

    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ info: Eip6963ProviderInfo; provider: Eip1193Provider }>).detail;
      if (!detail?.info?.rdns || !detail.provider?.request) return;
      const id = RDNS_TO_ID[detail.info.rdns];
      if (!id || found.has(id)) return;
      found.set(id, {
        id,
        name: detail.info.name || WALLET_CATALOG.find((w) => w.id === id)!.name,
        icon: detail.info.icon,
        eip1193: detail.provider,
        installed: true,
      });
    };

    window.addEventListener("eip6963:announceProvider", handler);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    window.setTimeout(() => {
      window.removeEventListener("eip6963:announceProvider", handler);
      resolve(found);
    }, waitMs);
  });
}

/**
 * Detect the three supported wallets. Resolves quickly (~600ms worst case).
 * Never throws; an absent wallet is reported via `installed: false`.
 */
export async function detectWallets(): Promise<DiscoveredWallet[]> {
  const announced = await collectAnnounced(600);

  // Legacy fallbacks for wallets that didn't announce (last-resort globals).
  if (!announced.has("trust")) {
    const tw = eip1193From((window as unknown as { trustwallet?: unknown }).trustwallet);
    if (tw) {
      const id = idForProvider(tw);
      if (id === "trust") {
        announced.set("trust", { id: "trust", name: "Trust Wallet", eip1193: tw, installed: true });
      }
    }
  }

  if (!announced.has("metamask") && !announced.has("trust")) {
    // window.ethereum is usually MetaMask, but Trust's in-wallet browser also
    // injects it — only claim it for MetaMask when nothing else claimed it.
    const eth = eip1193From((window as unknown as { ethereum?: unknown }).ethereum);
    if (eth && !announced.has("phantom") === false) {
      // no-op — keep logic simple; the check below does the real work
    }
    if (eth) {
      const claimedByTrust = announced.has("trust");
      const id = claimedByTrust ? undefined : idForProvider(eth);
      if (id === "metamask") {
        announced.set("metamask", { id: "metamask", name: "MetaMask", eip1193: eth, installed: true });
      }
    }
  }

  if (!announced.has("phantom")) {
    const phantomEth = eip1193From(
      (window as unknown as { phantom?: { ethereum?: unknown } }).phantom?.ethereum
    );
    if (phantomEth) {
      announced.set("phantom", {
        id: "phantom",
        name: "Phantom (EVM)",
        eip1193: phantomEth,
        installed: true,
      });
    }
  }

  // Merge into catalog order; mark absent wallets as not installed.
  return WALLET_CATALOG.map((entry) => {
    const found = announced.get(entry.id);
    if (found) return found;
    return {
      id: entry.id,
      name: entry.name,
      installUrl: entry.installUrl,
      installed: false as const,
    };
  });
}

/** True when running inside a wallet's in-app browser (mobile deep-link UX). */
export function isInWalletBrowser(): "trust" | "phantom" | "metamask" | null {
  const ua = navigator.userAgent;
  if (/TrustWalletBrowser|Trust Browser/i.test(ua)) return "trust";
  if (/Phantom/i.test(ua)) return "phantom";
  if (/MetaMaskMobile/i.test(ua)) return "metamask";
  return null;
}
