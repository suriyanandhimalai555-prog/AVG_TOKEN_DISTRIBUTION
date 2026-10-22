/**
 * Managed Wallets — real typed client over the existing axios instance.
 *
 * Paths: `/api/admin/managed/*` (admin, cookie session) and `/api/view/*`
 * (public holder page). Method names, signatures and return shapes mirror
 * `./managedApi.mock.ts` exactly so the admin UI under
 * `components/managed/client.ts` compiles unchanged after the swap.
 *
 * Errors propagate as axios errors (`err.response?.status`,
 * `err.response?.data?.{error,code}`), which `apiErrorMessage()` in
 * `components/managed/format.ts` already understands.
 */
import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  CreatePoolRequest,
  CreatePoolResponse,
  CreateTransferRequest,
  CreateTransferResponse,
  GenerateWalletsRequest,
  GenerateWalletsResponse,
  GetPoolResponse,
  GetTransferResponse,
  GetWalletResponse,
  GlobalTreasuryResponse,
  HealthResponse,
  IndexerRunResponse,
  IndexerStatusResponse,
  ListDepositsQuery,
  ListDepositsResponse,
  ListPoolsResponse,
  ListTokensQuery,
  ListTokensResponse,
  ListTransfersQuery,
  ListTransfersResponse,
  ListWalletsQuery,
  ListWalletsResponse,
  PlanTransferRequest,
  PlanTransferResponse,
  PoolTreasuryResponse,
  ReauthResponse,
  RevealMnemonicResponse,
  RotateViewTokenResponse,
  SweepRequest,
  SweepResponse,
  TrackTokenRequest,
  TrackTokenResponse,
  UpdatePoolRequest,
  UpdatePoolResponse,
  UpdateTokenRequest,
  UpdateTokenResponse,
  UpdateWalletRequest,
  UpdateWalletResponse,
  WalletViewResponse,
} from "@/lib/managedTypes";

/** Same base the shared axios instance uses (see lib/api.ts). */
const BASE_URL = import.meta.env.VITE_API_URL ?? "";
const ADMIN = "/api/admin/managed";
const VIEW = "/api/view";

/** `/health` additionally returns `maxWalletsPerPool` (additive field). */
export type ManagedHealth = HealthResponse & { maxWalletsPerPool?: number };

/** Public view payload plus the additive `explorerUrl` the backend adds per deposit. */
export type PublicWalletView = Omit<WalletViewResponse, "deposits"> & {
  deposits: Array<WalletViewResponse["deposits"][number] & { explorerUrl?: string }>;
};

/** Drops undefined/empty entries so the query string stays clean. */
function params(q: Record<string, string | number | boolean | undefined>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === "") continue;
    out[k] = v;
  }
  return out;
}

export const managedApi = {
  // Health and re-auth
  async health(): Promise<ManagedHealth> {
    const { data } = await api.get<ManagedHealth>(`${ADMIN}/health`);
    return data;
  },

  async reauth(password: string): Promise<ReauthResponse> {
    const { data } = await api.post<ReauthResponse>(`${ADMIN}/reauth`, { password });
    return data;
  },

  // Pools
  async listPools(): Promise<ListPoolsResponse> {
    const { data } = await api.get<ListPoolsResponse>(`${ADMIN}/pools`);
    return data;
  },

  async createPool(req: CreatePoolRequest): Promise<CreatePoolResponse> {
    const { data } = await api.post<CreatePoolResponse>(`${ADMIN}/pools`, req);
    return data;
  },

  async getPool(id: string): Promise<GetPoolResponse> {
    const { data } = await api.get<GetPoolResponse>(`${ADMIN}/pools/${encodeURIComponent(id)}`);
    return data;
  },

  async updatePool(id: string, req: UpdatePoolRequest): Promise<UpdatePoolResponse> {
    const { data } = await api.patch<UpdatePoolResponse>(`${ADMIN}/pools/${encodeURIComponent(id)}`, req);
    return data;
  },

  async revealMnemonic(id: string): Promise<RevealMnemonicResponse> {
    const { data } = await api.post<RevealMnemonicResponse>(
      `${ADMIN}/pools/${encodeURIComponent(id)}/reveal-mnemonic`,
      {}
    );
    return data;
  },

  // Wallets
  async generateWallets(poolId: string, req: GenerateWalletsRequest): Promise<GenerateWalletsResponse> {
    const { data } = await api.post<GenerateWalletsResponse>(
      `${ADMIN}/pools/${encodeURIComponent(poolId)}/wallets/generate`,
      req
    );
    return data;
  },

  async listWallets(poolId: string, q: ListWalletsQuery = {}): Promise<ListWalletsResponse> {
    const { data } = await api.get<ListWalletsResponse>(`${ADMIN}/pools/${encodeURIComponent(poolId)}/wallets`, {
      params: params({ skip: q.skip, limit: q.limit, search: q.search }),
    });
    return data;
  },

  async getWallet(id: string): Promise<GetWalletResponse> {
    const { data } = await api.get<GetWalletResponse>(`${ADMIN}/wallets/${encodeURIComponent(id)}`);
    return data;
  },

  async updateWallet(id: string, req: UpdateWalletRequest): Promise<UpdateWalletResponse> {
    const { data } = await api.patch<UpdateWalletResponse>(`${ADMIN}/wallets/${encodeURIComponent(id)}`, req);
    return data;
  },

  async rotateViewToken(id: string): Promise<RotateViewTokenResponse> {
    const { data } = await api.post<RotateViewTokenResponse>(
      `${ADMIN}/wallets/${encodeURIComponent(id)}/rotate-view-token`,
      {}
    );
    return data;
  },

  // Deposits and treasury
  async listDeposits(poolId: string, q: ListDepositsQuery = {}): Promise<ListDepositsResponse> {
    const { data } = await api.get<ListDepositsResponse>(`${ADMIN}/pools/${encodeURIComponent(poolId)}/deposits`, {
      params: params({ skip: q.skip, limit: q.limit, asset: q.asset }),
    });
    return data;
  },

  async getPoolTreasury(poolId: string): Promise<PoolTreasuryResponse> {
    const { data } = await api.get<PoolTreasuryResponse>(`${ADMIN}/pools/${encodeURIComponent(poolId)}/treasury`);
    return data;
  },

  async getTreasury(): Promise<GlobalTreasuryResponse> {
    const { data } = await api.get<GlobalTreasuryResponse>(`${ADMIN}/treasury`);
    return data;
  },

  // Transfers
  async planTransfer(req: PlanTransferRequest): Promise<PlanTransferResponse> {
    const { data } = await api.post<PlanTransferResponse>(`${ADMIN}/transfers/plan`, req);
    return data;
  },

  async createTransfer(req: CreateTransferRequest): Promise<CreateTransferResponse> {
    const { data } = await api.post<CreateTransferResponse>(`${ADMIN}/transfers`, req);
    return data;
  },

  async createSweep(req: SweepRequest): Promise<SweepResponse> {
    const { data } = await api.post<SweepResponse>(`${ADMIN}/transfers/sweep`, req);
    return data;
  },

  async listTransfers(q: ListTransfersQuery = {}): Promise<ListTransfersResponse> {
    const { data } = await api.get<ListTransfersResponse>(`${ADMIN}/transfers`, {
      params: params({ poolId: q.poolId, batchId: q.batchId, status: q.status, skip: q.skip, limit: q.limit }),
    });
    return data;
  },

  async getTransfer(id: string): Promise<GetTransferResponse> {
    const { data } = await api.get<GetTransferResponse>(`${ADMIN}/transfers/${encodeURIComponent(id)}`);
    return data;
  },

  async retryTransfer(id: string): Promise<GetTransferResponse> {
    const { data } = await api.post<GetTransferResponse>(`${ADMIN}/transfers/${encodeURIComponent(id)}/retry`, {});
    return data;
  },

  // Tokens and indexer
  async listTokens(q: ListTokensQuery = {}): Promise<ListTokensResponse> {
    const { data } = await api.get<ListTokensResponse>(`${ADMIN}/tokens`, {
      params: params({ network: q.network, includeHidden: q.includeHidden ? "true" : undefined }),
    });
    return data;
  },

  async trackToken(req: TrackTokenRequest): Promise<TrackTokenResponse> {
    const { data } = await api.post<TrackTokenResponse>(`${ADMIN}/tokens`, req);
    return data;
  },

  async setTokenHidden(id: string, req: UpdateTokenRequest): Promise<UpdateTokenResponse> {
    const { data } = await api.patch<UpdateTokenResponse>(`${ADMIN}/tokens/${encodeURIComponent(id)}`, req);
    return data;
  },

  async getIndexerStatus(): Promise<IndexerStatusResponse> {
    const { data } = await api.get<IndexerStatusResponse>(`${ADMIN}/indexer/status`);
    return data;
  },

  async runIndexer(): Promise<IndexerRunResponse> {
    const { data } = await api.post<IndexerRunResponse>(`${ADMIN}/indexer/run`, {});
    return data;
  },

  /** URL for the CSV export (synchronous URL builder, like exportApi.url). */
  exportPoolCsvUrl(poolId: string): string {
    return `${BASE_URL}${ADMIN}/export/pools/${encodeURIComponent(poolId)}.csv`;
  },

  // Public holder page (no auth; the shared instance is fine, cookies are ignored)
  async getPublicWallet(viewToken: string): Promise<PublicWalletView> {
    const { data } = await api.get<PublicWalletView>(`${VIEW}/${encodeURIComponent(viewToken)}`);
    return data;
  },
};

export type ManagedApi = typeof managedApi;

// ─── Feature-enabled hook ────────────────────────────────────────────────────

export interface ManagedEnabledState {
  /** Backend answered /health: the feature is mounted for this admin. */
  enabled: boolean;
  loading: boolean;
  health?: ManagedHealth;
  /** Backend answered 404: the server kill switch is set (or an older backend). */
  switchedOff: boolean;
  /** Mounted AND the key vault is loaded AND the migration is applied. */
  ready: boolean;
  /** Health request failed for another reason (network, 5xx). */
  error: boolean;
}

export const MANAGED_HEALTH_QUERY_KEY = ["managed", "health"] as const;

/**
 * Whether the backend reports the Managed Wallets feature enabled.
 * Backed by GET /api/admin/managed/health; a 404 (routes not mounted) or 403
 * (not admin) means disabled, not an error. Pass `{ enabled: false }` for
 * non-admin users so they never hit the endpoint.
 */
export function useManagedEnabled(opts: { enabled?: boolean } = {}): ManagedEnabledState {
  const gate = opts.enabled ?? true;
  const q = useQuery({
    queryKey: MANAGED_HEALTH_QUERY_KEY,
    queryFn: async (): Promise<ManagedHealth | null> => {
      try {
        return await managedApi.health();
      } catch (err) {
        if (axios.isAxiosError(err)) {
          const s = err.response?.status;
          // 404: the route is not mounted (kill switch). Anything else, including
          // 403 from an expired admin session, is reported as an error state.
          if (s === 404) return null;
        }
        throw err;
      }
    },
    enabled: gate,
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  if (!gate) return { enabled: false, loading: false, switchedOff: false, ready: false, error: false };
  const health = q.data ?? undefined;
  const enabled = Boolean(health?.enabled);
  return {
    enabled,
    loading: q.isPending,
    health,
    switchedOff: q.isSuccess && q.data === null,
    ready: enabled && health?.keyVault === "ok" && health?.migrated === true,
    error: q.isError,
  };
}
