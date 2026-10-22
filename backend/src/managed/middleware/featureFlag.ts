/**
 * Master switch for the managed-wallets feature (SPEC §6.8, R3).
 * Read at call time so tests can toggle it; with the flag off nothing is
 * mounted and no worker starts.
 */
export function isManagedEnabled(): boolean {
  return process.env.MANAGED_WALLETS_ENABLED === "true";
}

/** Whether the deposit indexer should run in this process. */
export function isIndexerEnabled(): boolean {
  return process.env.MANAGED_INDEXER_ENABLED !== "false";
}
