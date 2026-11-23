import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { BrowserProvider } from "ethers";
import { detectWallets, type DiscoveredWallet, type Eip1193Provider, type WalletInfo } from "@/lib/wallet/detect";
import { CHAINS, networkFromChainId, type Network } from "@/lib/wallet/chains";

export type WalletStatus = "idle" | "detecting" | "connecting" | "connected";

interface WalletState {
  wallets: DiscoveredWallet[];
  refreshWallets: () => Promise<void>;
  address: string | null;
  chainId: number | null;
  network: Network | null;
  status: WalletStatus;
  connectError: string | null;
  /** Connected wallet provider (set only after explicit account confirm). */
  connectedWallet: WalletInfo | null;
  /** Selected accounts (post `eth_requestAccounts`). */
  accounts: string[];
  connect: (wallet: WalletInfo) => Promise<void>;
  /** Re-request accounts from an already-selected wallet (account switcher). */
  switchAccounts: () => Promise<void>;
  /** Switch to an already-granted account without re-prompting the wallet. */
  setActiveAddress: (address: string) => void;
  disconnect: () => void;
  getProvider: () => BrowserProvider | null;
  switchToBsc: (network: Network) => Promise<boolean>;
}

const STORAGE_PROVIDER_ID = "walletProviderId";
const STORAGE_ADDRESS = "walletAddress";

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallets, setWallets] = useState<DiscoveredWallet[]>([]);
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [status, setStatus] = useState<WalletStatus>("idle");
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectedWallet, setConnectedWallet] = useState<WalletInfo | null>(null);
  const [accounts, setAccounts] = useState<string[]>([]);

  const providerRef = useRef<BrowserProvider | null>(null);
  const eip1193Ref = useRef<Eip1193Provider | null>(null);

  const refreshWallets = useCallback(async () => {
    setStatus((s) => (s === "connected" ? s : "detecting"));
    const found = await detectWallets();
    setWallets(found);
    setStatus((s) => (s === "connected" ? s : "idle"));
  }, []);

  useEffect(() => {
    void refreshWallets();
  }, [refreshWallets]);

  const attachListeners = useCallback((p: Eip1193Provider) => {
    p.on?.("accountsChanged", (...args: unknown[]) => {
      const accts = args[0] as string[] | undefined;
      if (!accts || accts.length === 0) {
        setAddress(null);
        setAccounts([]);
        providerRef.current = null;
        setConnectedWallet(null);
        setStatus("idle");
        localStorage.removeItem(STORAGE_ADDRESS);
        localStorage.removeItem(STORAGE_PROVIDER_ID);
      } else {
        setAddress(accts[0]);
        setAccounts(accts);
        localStorage.setItem(STORAGE_ADDRESS, accts[0]);
      }
    });
    p.on?.("chainChanged", (...args: unknown[]) => {
      const hex = args[0] as string | number;
      setChainId(typeof hex === "string" ? parseInt(hex, 16) : hex);
    });
  }, []);

  // Eager reconnect from localStorage.
  useEffect(() => {
    const storedId = localStorage.getItem(STORAGE_PROVIDER_ID);
    const storedAddress = localStorage.getItem(STORAGE_ADDRESS);
    if (!storedId || !storedAddress) return;

    (async () => {
      const found = await detectWallets();
      setWallets(found);
      const match = found.find((w) => w.installed && w.id === storedId) as WalletInfo | undefined;
      if (!match) {
        localStorage.removeItem(STORAGE_PROVIDER_ID);
        localStorage.removeItem(STORAGE_ADDRESS);
        return;
      }
      try {
        const existing = (await match.eip1193.request({ method: "eth_accounts" })) as string[];
        if (existing?.length) {
          eip1193Ref.current = match.eip1193;
          providerRef.current = new BrowserProvider(match.eip1193);
          setAddress(existing[0]);
          setAccounts(existing);
          setConnectedWallet(match);
          attachListeners(match.eip1193);
          const cid = (await match.eip1193.request({ method: "eth_chainId" })) as string;
          setChainId(parseInt(cid, 16));
          setStatus("connected");
        } else {
          localStorage.removeItem(STORAGE_ADDRESS);
        }
      } catch {
        localStorage.removeItem(STORAGE_ADDRESS);
      }
    })();
  }, [attachListeners]);

  const connect = useCallback(
    async (wallet: WalletInfo) => {
      setConnectError(null);
      setStatus("connecting");
      try {
        // Step 1: request accounts — this is what shows the wallet's permission dialog
        // and lets the user pick which account to share.
        const requested = (await wallet.eip1193.request({
          method: "eth_requestAccounts",
        })) as string[];
        if (!requested?.length) throw new Error("No accounts returned");

        eip1193Ref.current = wallet.eip1193;
        providerRef.current = new BrowserProvider(wallet.eip1193);
        setAddress(requested[0]);
        setAccounts(requested);
        setConnectedWallet(wallet);
        localStorage.setItem(STORAGE_PROVIDER_ID, wallet.id);
        localStorage.setItem(STORAGE_ADDRESS, requested[0]);
        attachListeners(wallet.eip1193);
        const cid = (await wallet.eip1193.request({ method: "eth_chainId" })) as string;
        setChainId(parseInt(cid, 16));
        setStatus("connected");
      } catch (err) {
        setStatus("idle");
        const e = err as { code?: number; message?: string };
        if (e.code === 4001) {
          setConnectError("Connection rejected in wallet");
        } else {
          setConnectError(e.message || "Failed to connect");
        }
        throw err;
      }
    },
    [attachListeners]
  );

  const switchAccounts = useCallback(async () => {
    const p = eip1193Ref.current;
    if (!p) return;
    try {
      const requested = (await p.request({ method: "eth_requestAccounts" })) as string[];
      setAccounts(requested);
      setAddress(requested[0] ?? null);
      localStorage.setItem(STORAGE_ADDRESS, requested[0] ?? "");
    } catch (err) {
      const e = err as { code?: number; message?: string };
      setConnectError(e.code === 4001 ? "Account selection rejected" : e.message || "Failed to switch accounts");
    }
  }, []);

  const setActiveAddress = useCallback((addr: string) => {
    setAddress(addr);
    localStorage.setItem(STORAGE_ADDRESS, addr);
  }, []);

  const disconnect = useCallback(() => {
    eip1193Ref.current = null;
    providerRef.current = null;
    setAddress(null);
    setAccounts([]);
    setConnectedWallet(null);
    setStatus("idle");
    setConnectError(null);
    localStorage.removeItem(STORAGE_PROVIDER_ID);
    localStorage.removeItem(STORAGE_ADDRESS);
  }, []);

  const getProvider = useCallback(() => {
    if (!eip1193Ref.current) return null;
    if (!providerRef.current) providerRef.current = new BrowserProvider(eip1193Ref.current);
    return providerRef.current;
  }, []);

  const switchToBsc = useCallback(async (network: Network): Promise<boolean> => {
    const p = eip1193Ref.current;
    if (!p) return false;
    const params = CHAINS[network];
    try {
      await p.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: params.chainId }],
      });
      setChainId(params.chainIdDecimal);
      return true;
    } catch (err) {
      const e = err as { code?: number; message?: string };
      if (e.code === 4902) {
        try {
          await p.request({
            method: "wallet_addEthereumChain",
            params: [params],
          });
          setChainId(params.chainIdDecimal);
          return true;
        } catch {
          return false;
        }
      }
      return false;
    }
  }, []);

  const network = useMemo(() => networkFromChainId(chainId), [chainId]);

  const value = useMemo<WalletState>(
    () => ({
      wallets,
      refreshWallets,
      address,
      chainId,
      network,
      status,
      connectError,
      connectedWallet,
      accounts,
      connect,
      switchAccounts,
      setActiveAddress,
      disconnect,
      getProvider,
      switchToBsc,
    }),
    [wallets, refreshWallets, address, chainId, network, status, connectError, connectedWallet, accounts, connect, switchAccounts, setActiveAddress, disconnect, getProvider, switchToBsc]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}
