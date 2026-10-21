/**
 * Managed Wallets — client entry module (the ONE swap point for N6).
 *
 * Every admin page and component under pages/admin/managed/** and
 * components/managed/** imports the API client ONLY from this file:
 *
 *   import { managedApi, useManagedEnabled } from "@/components/managed/client";
 *
 * N6 replaces the single import line below with the real client
 * (`import { managedApi } from "@/lib/managedApi";`) and replaces the
 * `useManagedEnabled` stub with the real health-backed hook. Nothing else in
 * the admin UI needs to change, provided the surface stays identical:
 *
 *   managedApi.health(): Promise<HealthResponse>
 *   managedApi.reauth(password): Promise<ReauthResponse>
 *   managedApi.listPools(): Promise<ListPoolsResponse>
 *   managedApi.createPool(req): Promise<CreatePoolResponse>
 *   managedApi.getPool(id): Promise<GetPoolResponse>
 *   managedApi.updatePool(id, req): Promise<UpdatePoolResponse>
 *   managedApi.revealMnemonic(id): Promise<RevealMnemonicResponse>
 *   managedApi.generateWallets(poolId, req): Promise<GenerateWalletsResponse>
 *   managedApi.listWallets(poolId, query?): Promise<ListWalletsResponse>
 *   managedApi.getWallet(id): Promise<GetWalletResponse>
 *   managedApi.updateWallet(id, req): Promise<UpdateWalletResponse>
 *   managedApi.rotateViewToken(id): Promise<RotateViewTokenResponse>
 *   managedApi.listDeposits(poolId, query?): Promise<ListDepositsResponse>
 *   managedApi.getPoolTreasury(poolId): Promise<PoolTreasuryResponse>
 *   managedApi.getTreasury(): Promise<GlobalTreasuryResponse>
 *   managedApi.planTransfer(req): Promise<PlanTransferResponse>
 *   managedApi.createTransfer(req): Promise<CreateTransferResponse>
 *   managedApi.createSweep(req): Promise<SweepResponse>
 *   managedApi.listTransfers(query?): Promise<ListTransfersResponse>
 *   managedApi.getTransfer(id): Promise<GetTransferResponse>
 *   managedApi.retryTransfer(id): Promise<GetTransferResponse>
 *   managedApi.listTokens(query?): Promise<ListTokensResponse>
 *   managedApi.trackToken(req): Promise<TrackTokenResponse>
 *   managedApi.setTokenHidden(id, req): Promise<UpdateTokenResponse>
 *   managedApi.getIndexerStatus(): Promise<IndexerStatusResponse>
 *   managedApi.runIndexer(): Promise<IndexerRunResponse>
 *   managedApi.exportPoolCsvUrl(poolId): string          (sync URL builder)
 *
 * Errors must carry the axios shape (`err.response?.status`,
 * `err.response?.data?.{error,code}`); see apiErrorMessage() in ./format.ts.
 */
import { managedApi } from "@/lib/managedApi.mock";

export { managedApi };
export type ManagedApiClient = typeof managedApi;

/**
 * Stub: whether the backend reports the feature enabled. N6 replaces this with
 * a hook backed by GET /api/admin/managed/health (404 → enabled: false).
 */
export function useManagedEnabled(): { enabled: boolean; loading: boolean } {
  return { enabled: true, loading: false };
}
