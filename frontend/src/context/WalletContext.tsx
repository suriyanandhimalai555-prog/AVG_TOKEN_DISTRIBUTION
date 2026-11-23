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
  /** Which BSC network the wallet is on, or null when on an unknown chain. */
  network: Network | null;
  status: WalletStatus;
  connectError: string | null;
  connect: (wallet: WalletInfo) => Promise<void>;
  disconnect: () => void;
  /** Fresh ethers BrowserProvider bound to the connected wallet (per-tx use). */
  getProvider: () => BrowserProvider | null;
  /** Prompt the wallet to switch to BSC mainnet or testnet. */
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

  const providerRef = useRef<BrowserProvider | null>(null);
  const eip1193Ref = useRef<Eip1193Provider | null>(null);

  const refreshWallets = useCallback(async () => {
    setStatus((s) => (s === "connected" ? s : "detecting"));
    const found = await detectWallets();
    setWallets(found);
    setStatus((s) => (s === "connected" ? s : "idle"));
    return;
  }, []);

  // Initial detection.
  useEffect(() => {
    void refreshWallets();
  }, [refreshWallets]);

  const attachListeners = useCallback((p: Eip1193Provider) => {
    p.on?.("accountsChanged", (...args: unknown[]) => {
      const accounts = args[0] as string[] | undefined;
      if (!accounts || accounts.length === 0) {
        setAddress(null);
        providerRef.current = null;
        setStatus("idle");
        localStorage.removeItem(STORAGE_ADDRESS);
      } else {
        setAddress(accounts[0]);
        localStorage.setItem(STORAGE_ADDRESS, accounts[0]);
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
        const accounts = (await match.eip1193.request({ method: "eth_accounts" })) as string[];
        if (accounts?.length) {
          eip1193Ref.current = match.eip1193;
          providerRef.current = new BrowserProvider(match.eip1193);
          setAddress(accounts[0]);
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
        const accounts = (await wallet.eip1193.request({
          method: "eth_requestAccounts",
        })) as string[];
        if (!accounts?.length) throw new Error("No accounts returned");

        eip1193Ref.current = wallet.eip1193;
        providerRef.current = new BrowserProvider(wallet.eip1193);
        setAddress(accounts[0]);
        localStorage.setItem(STORAGE_PROVIDER_ID, wallet.id);
        localStorage.setItem(STORAGE_ADDRESS, accounts[0]);
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

  const disconnect = useCallback(() => {
    eip1193Ref.current = null;
    providerRef.current = null;
    setAddress(null);
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
      // 4902 = chain not added to the wallet yet.
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
      connect,
      disconnect,
      getProvider,
      switchToBsc,
    }),
    [wallets, refreshWallets, address, chainId, network, status, connectError, connect, disconnect, getProvider, switchToBsc]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}
