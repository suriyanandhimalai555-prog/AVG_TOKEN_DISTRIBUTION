/**
 * Managed Wallets — entry point used by src/index.ts (ARCHITECTURE.md §2).
 *
 *   mountManagedWallets(app)  mounts /api/admin/managed and /api/view, only
 *                             when MANAGED_WALLETS_ENABLED === "true"
 *   startManagedWorkers()     starts the indexer and the transfer worker
 *   stopManagedWorkers()      awaits both on shutdown
 */
import type { Express } from "express";
import {
  auditPort,
  balancesPort,
  depositsPort,
  indexerStatePort,
  loggerPort,
  poolsPort,
  tokensPort,
  transfersPort,
  vaultPort,
  walletsPort,
} from "./adapters";
import { BalanceService } from "./chain/balances";
import { ManagedIndexer } from "./chain/indexer";
import { resilientProvider } from "./chain/rpc";
import { TransferWorker } from "./chain/transferWorker";
import { isKeyVaultAvailable } from "./keyVault";
import { isIndexerEnabled, isManagedEnabled } from "./middleware/featureFlag";
import { managedLog } from "./redact";
import { createAdminRouter } from "./routes/admin";
import { createViewRouter } from "./routes/view";
import { registerIndexer } from "./service/indexerService";

export { isManagedEnabled } from "./middleware/featureFlag";

interface Runtime {
  balances: BalanceService;
  indexer: ManagedIndexer | null;
  worker: TransferWorker;
}

let runtime: Runtime | null = null;

function buildRuntime(): Runtime {
  const balances = new BalanceService({
    balances: balancesPort,
    wallets: walletsPort,
    tokens: tokensPort,
    providerFor: resilientProvider,
    logger: loggerPort,
  });

  const indexer = isIndexerEnabled()
    ? new ManagedIndexer({
        pools: poolsPort,
        wallets: walletsPort,
        tokens: tokensPort,
        deposits: depositsPort,
        indexerState: indexerStatePort,
        balances,
        logger: loggerPort,
      })
    : null;

  const worker = new TransferWorker({
    pools: poolsPort,
    wallets: walletsPort,
    transfers: transfersPort,
    vault: vaultPort,
    audits: auditPort,
    balances,
    logger: loggerPort,
  });

  return { balances, indexer, worker };
}

/** Mounts the managed routers. A no-op when the feature flag is off (R3). */
export function mountManagedWallets(app: Express): void {
  if (!isManagedEnabled()) return;

  app.use("/api/admin/managed", createAdminRouter());
  app.use("/api/view", createViewRouter());

  managedLog("info", "routes mounted", {
    keyVault: isKeyVaultAvailable() ? "ok" : "missing",
    indexer: isIndexerEnabled(),
  });
}

/**
 * Starts the indexer (if enabled) and the transfer worker. Both need the key
 * vault: without it nothing starts and a warning is logged.
 */
export async function startManagedWorkers(): Promise<void> {
  if (!isManagedEnabled()) return;

  if (!isKeyVaultAvailable()) {
    managedLog(
      "warn",
      "WALLET_ENCRYPTION_KEY missing or invalid: indexer and transfer worker NOT started; managed routes answer 503 KEY_VAULT_UNAVAILABLE"
    );
    return;
  }

  if (runtime) return;
  runtime = buildRuntime();
  registerIndexer(runtime.indexer);

  if (runtime.indexer) {
    runtime.indexer.start();
  } else {
    managedLog("info", "indexer disabled by MANAGED_INDEXER_ENABLED=false");
  }
  runtime.worker.start();
}

/** Stops the indexer and the worker; safe to call when nothing started. */
export async function stopManagedWorkers(): Promise<void> {
  const current = runtime;
  if (!current) return;
  runtime = null;
  registerIndexer(null);

  const results = await Promise.allSettled([
    current.indexer ? current.indexer.stop() : Promise.resolve(),
    current.worker.stop(),
  ]);
  for (const r of results) {
    if (r.status === "rejected") {
      managedLog("error", "worker stop failed", { error: r.reason });
    }
  }
}
