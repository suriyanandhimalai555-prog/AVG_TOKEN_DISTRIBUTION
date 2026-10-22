/**
 * Indexer status and "run now". The ManagedIndexer instance is registered by
 * managed/index.ts at start; without one (MANAGED_INDEXER_ENABLED=false or
 * workers not started) status still reports persisted state.
 */
import { recordManagedAudit } from "../audit";
import type { ManagedIndexer } from "../chain/indexer";
import { resilientProvider } from "../chain/rpc";
import { isIndexerEnabled } from "../middleware/featureFlag";
import { indexerState } from "../models/indexerState";
import { pools } from "../models/pools";
import { managedLog } from "../redact";
import type { IndexerNetworkStatus, IndexerRunResponse, IndexerStatusResponse, Network } from "../types";
import { conflict } from "./errors";

let registered: ManagedIndexer | null = null;

export function registerIndexer(indexer: ManagedIndexer | null): void {
  registered = indexer;
}

/** Fire-and-forget balance refresh for a network; a no-op when no indexer runs here. */
export function refreshBalancesSoon(network: Network): void {
  const indexer = getRegisteredIndexer();
  if (!indexer) return;
  void indexer.refreshBalancesNow(network).catch((err: unknown) => {
    managedLog("error", "on-demand balance refresh failed", { network, error: err });
  });
}

export function getRegisteredIndexer(): ManagedIndexer | null {
  return registered;
}

async function headFor(network: Network): Promise<number | null> {
  try {
    return await resilientProvider(network).getBlockNumber();
  } catch {
    return null;
  }
}

export async function indexerStatus(): Promise<IndexerStatusResponse> {
  const [states, activePools] = await Promise.all([
    indexerState.listAll(),
    pools.listAll({ status: "ACTIVE" }),
  ]);

  const networks = new Set<Network>();
  for (const s of states) networks.add(s.network);
  for (const p of activePools) networks.add(p.network);
  const stateByNetwork = new Map(states.map((s) => [s.network, s]));
  const running = isIndexerEnabled() && registered !== null && registered.running;

  const byNetwork: IndexerNetworkStatus[] = [];
  for (const network of [...networks].sort()) {
    const state = stateByNetwork.get(network);
    const lastScannedBlock = state?.lastScannedBlock ?? 0;
    const head = await headFor(network);
    byNetwork.push({
      network,
      enabled: running,
      lastScannedBlock,
      head,
      lag: head === null ? null : Math.max(0, head - lastScannedBlock),
      lastRunAt: state?.lastRunAt ?? null,
      lastError: state?.lastError ?? null,
    });
  }

  return { byNetwork };
}

/** Kicks a scan of every active network without awaiting it (202). */
export async function runIndexerNow(userId: string): Promise<IndexerRunResponse> {
  if (!registered) {
    throw conflict("INDEXER_DISABLED", "The deposit indexer is not running in this process");
  }
  const indexer = registered;
  const networks = await indexer.activeNetworks();

  for (const network of networks) {
    void indexer.runOnce(network, { ignoreBackoff: true }).catch((err: unknown) => {
      managedLog("error", "manual indexer run failed", { network, error: err });
    });
  }

  await recordManagedAudit({
    userId,
    action: "INDEXER_RUN_REQUESTED",
    details: { networks },
  });

  return { started: true };
}

/** Last scanned block per network for GET /health; {} when not migrated. */
export async function lastBlockByNetwork(): Promise<Partial<Record<Network, number>>> {
  const out: Partial<Record<Network, number>> = {};
  for (const s of await indexerState.listAll()) out[s.network] = s.lastScannedBlock;
  return out;
}
