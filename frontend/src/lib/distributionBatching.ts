/**
 * Mirrors backend `src/lib/distributionBatching.ts` for client-side estimates.
 * Preflight API remains authoritative; keep these functions in sync when policy changes.
 */
export const MULTISENDER_MAX_PER_TX = 350;

/** Default wallets per multisend tx (matches backend `DEFAULT_MULTI_BATCH_SIZE`). */
export const DEFAULT_MULTI_BATCH_SIZE = 100;

export const PARALLEL_WORKERS_MIN = 1;
export const PARALLEL_WORKERS_MAX = 10;
/** Default parallel multisend txs (matches backend `DEFAULT_PARALLEL_WORKERS`). */
export const DEFAULT_PARALLEL_WORKERS = 5;

function clampMultiBatchSize(n: number): number {
  return Math.min(MULTISENDER_MAX_PER_TX, Math.max(1, Math.floor(n)));
}

export function clampParallelWorkerCount(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_PARALLEL_WORKERS;
  return Math.max(PARALLEL_WORKERS_MIN, Math.min(PARALLEL_WORKERS_MAX, Math.floor(n)));
}

/** Same policy as backend `resolveMultiBatchSizeForWalletCount`. */
export function resolveMultiBatchSizeForWalletCount(_totalWallets: number): number {
  void _totalWallets;
  return clampMultiBatchSize(DEFAULT_MULTI_BATCH_SIZE);
}

/** Same policy as backend `resolveParallelWorkerCountForWalletCount`. */
export function resolveParallelWorkerCountForWalletCount(_totalWallets: number): number {
  void _totalWallets;
  return clampParallelWorkerCount(DEFAULT_PARALLEL_WORKERS);
}

export function countBatchesForWalletCount(walletCount: number, multiBatchSize: number): number {
  if (walletCount <= 0) return 0;
  const size = Math.min(MULTISENDER_MAX_PER_TX, Math.max(1, multiBatchSize));
  return Math.ceil(walletCount / size);
}
