/**
 * Switch for the managed-wallets feature.
 *
 * The feature is ON by default: access is gated by the ADMIN role
 * (requireAdmin on every admin route), so any admin can use it once the
 * server has WALLET_ENCRYPTION_KEY and the migration applied. Setting
 * MANAGED_WALLETS_ENABLED to "false", "0", "off" or "no" (any casing) is the
 * kill switch: nothing is mounted and no worker starts.
 *
 * Read at call time so tests can toggle it.
 */
const OFF_VALUES = new Set(["false", "0", "off", "no"]);

export function isManagedEnabled(): boolean {
  const raw = process.env.MANAGED_WALLETS_ENABLED;
  if (raw === undefined) return true;
  return !OFF_VALUES.has(raw.trim().toLowerCase());
}

/** Whether the deposit indexer should run in this process. */
export function isIndexerEnabled(): boolean {
  return process.env.MANAGED_INDEXER_ENABLED !== "false";
}

/**
 * Whether the transfer worker (which signs and broadcasts from master and
 * managed wallets) should run in this process. Default on. Set
 * MANAGED_WORKER_ENABLED=false on any backend that shares a database with the
 * production server (e.g. a developer laptop), so only one worker ever
 * processes the job queue and master-wallet nonces never collide.
 */
export function isWorkerEnabled(): boolean {
  return process.env.MANAGED_WORKER_ENABLED !== "false";
}
