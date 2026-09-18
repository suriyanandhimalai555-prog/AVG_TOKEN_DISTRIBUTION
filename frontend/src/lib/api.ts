import axios from "axios";
import { store } from "@/lib/store";

const BASE_URL = import.meta.env.VITE_API_URL ?? "";

export const api = axios.create({
  baseURL: BASE_URL,
  headers: { "Content-Type": "application/json" },
  timeout: 30_000,
  withCredentials: true,
});

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExistingConfig {
  rpcUrl: string;
  testnetRpcUrl: string;
  fallback1: string;
  fallback2: string;
  multisenderAddress: string;   // from output/deployments.json
  deploymentInfo?: {
    network: string;
    chainId: string;
    deployedAt: string;
  };
  // TOKEN_ADDRESS and PRIVATE_KEY are NOT returned — user enters in form
}

export interface Session {
  _id: string;
  createdAt: string;
  totalWallets: number;
  network: "bscMainnet" | "bscTestnet";
  tokenAddress: string;
  tokenName: string;
  multisenderAddress: string;
  status: "idle" | "generating" | "preparing" | "distributing" | "done" | "stopped" | "error";
  sentCount: number;
  failedCount: number;
  bnbSpent: number;
  startedAt?: string;
  completedAt?: string;
  masterMnemonic?: string;
}

export interface SessionAudit {
  _id: string;
  userId: string;
  sessionId: string;
  action: string;
  message?: string;
  details?: Record<string, unknown>;
  createdAt: string;
}

export interface Batch {
  _id: string;
  sessionId: string;
  batchIndex: number;
  walletCount: number;
  txHash?: string;
  gasUsed?: string;
  status: "pending" | "confirmed" | "failed";
  createdAt: string;
  confirmedAt?: string;
}

export interface WalletEntry {
  _id: string;
  sessionId: string;
  index: number;
  address: string;
  derivationPath: string;
  amount: number;
  amountWei: string;
  sent: boolean;
  failed?: boolean;
  failureReason?: string;
  txHash?: string;
  timestamp?: string;
  batchId?: string;
}

export interface StatusResponse {
  sessionId: string;
  status: Session["status"];
  totalWallets: number;
  sentCount: number;
  failedCount: number;
  bnbSpent: number;
  batchCount: number;
  confirmedBatches: number;
  failedBatches: number;
  sentWallets: number;
  isRunning: boolean;
  startedAt?: string;
  completedAt?: string;
}

// ─── API helpers ─────────────────────────────────────────────────────────────

export interface DeployResult {
  address: string;
  network?: string;
  chainId?: string;
  deployedAt?: string;
}

export interface WalletPreview {
  account: string;
  network: "bscMainnet" | "bscTestnet";
  nativeSymbol: "BNB" | "tBNB";
  bnbBalance: string;   // Mainnet BNB
  tBnbBalance: string;  // Testnet tBNB
  tokenOnSelectedNetwork: boolean;
  tokenOnSelectedNetworkError?: string;
  token?: {
    address: string;
    name: string;
    symbol: string;
    decimals: number;
    balance: string;
  };
  tokenError?: string;
}

export interface PreflightEstimate {
  account: string;
  chainId: number;
  network: "bscMainnet" | "bscTestnet";
  nativeSymbol: "BNB" | "tBNB";
  totalWallets: number;
  batchSize: number;
  batchCount: number;
  workerCount?: number;
  token: {
    address: string;
    symbol: string;
    decimals: number;
    balance: string;
    requiredMin: number;
    requiredAvg: number;
    requiredMax: number;
    enoughForMax: boolean;
  };
  tokenSourceNetwork?: "selected" | "mainnet-fallback";
  tokenError?: string;
  gas: {
    gasPriceGwei: string;
    estimatedGasLikely: string;
    estimatedGasMax: string;
    estimatedLikelyGasPerLargestBatch?: string;
    perBatchGasLimit?: string;
    mayExceedPerBatchLimit?: boolean;
    estimatedBnbLikely: string;
    estimatedBnbMax: string;
  };
  bnb: {
    balance: string;
    enoughLikely: boolean;
    enoughMax: boolean;
  };
}

export const configApi = {
  get: () => api.get<ExistingConfig>("/api/config"),
};

export const deployApi = {
  multisender: (privateKey: string, network: "bscMainnet" | "bscTestnet") =>
    api.post<DeployResult>("/api/deploy/multisender", { privateKey, network }, {
      // Deployment can take up to 3 minutes on mainnet — increase timeout
      timeout: 180_000,
    }),
};

export const walletApi = {
  preview: (privateKey: string, tokenAddress: string, network: "bscMainnet" | "bscTestnet") =>
    api.post<WalletPreview>("/api/wallet/preview", { privateKey, tokenAddress, network }),
};

export const estimateApi = {
  preflight: (sessionId: string, privateKey: string, network?: "bscMainnet" | "bscTestnet") =>
    api.post<PreflightEstimate>("/api/estimate/preflight", { sessionId, privateKey, network }),
};

export const sessionsApi = {
  create: (
    totalWallets: number,
    network: "bscMainnet" | "bscTestnet",
    tokenAddress: string,
    tokenName: string,
    multisenderAddress: string
  ) =>
    api.post<{ sessionId: string; session: Session }>("/api/sessions", {
      totalWallets,
      network,
      tokenAddress,
      tokenName,
      multisenderAddress,
    }),

  list: () => api.get<{ sessions: Session[] }>("/api/sessions"),

  history: (limit = 200) =>
    api.get<{ audits: SessionAudit[] }>(`/api/sessions/history?limit=${limit}`),

  get: (id: string) =>
    api.get<{ session: Session; batchCount: number; walletCount: number }>(`/api/sessions/${id}`),

  patch: (id: string, data: Partial<Session>) =>
    api.patch<{ session: Session }>(`/api/sessions/${id}`, data),

  delete: (id: string) =>
    api.delete<{ success: boolean; deletedSessionId: string }>(`/api/sessions/${id}`),
};

export type WalletMode = "HD_SINGLE_SEED" | "INDEPENDENT_SEEDS";

export const generateApi = {
  start: (sessionId: string, privateKey: string, walletMode: WalletMode = "INDEPENDENT_SEEDS") =>
    api.post<{ status: string }>("/api/generate", { sessionId, privateKey, walletMode }),
};

export const prepareApi = {
  start: (sessionId: string) =>
    api.post<{ status: string }>("/api/prepare", { sessionId }),
};

export const distributeApi = {
  start: (sessionId: string, privateKey: string, delayMode = false) =>
    api.post<{ status: string }>("/api/distribute", { sessionId, privateKey, delayMode }),

  stop: (sessionId: string) =>
    api.delete<{ status: string; killed: boolean }>("/api/distribute", {
      data: { sessionId },
    }),
};

export const statusApi = {
  get: async (sessionId: string): Promise<StatusResponse> => {
    try {
      const { data } = await api.get<StatusResponse>(
        `/api/status?sessionId=${encodeURIComponent(sessionId)}`
      );
      return data;
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        store.clearSessionId();
      }
      throw err;
    }
  },
};

export const exportApi = {
  url: (sessionId: string, file: "csv" | "xlsx" | "wallets" | "json") =>
    `${BASE_URL}/api/export?sessionId=${sessionId}&file=${file}`,
};
