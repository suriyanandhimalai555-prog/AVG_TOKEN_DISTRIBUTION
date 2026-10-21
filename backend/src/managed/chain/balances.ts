/**
 * Balance refresh service.
 *
 * - refreshPairs(network, pairs): dirty (wallet, asset) pairs after a scan or a transfer
 * - refreshAll(network): every ACTIVE wallet × (native + visible tokens), throttled by
 *   MANAGED_FULL_REFRESH_MS (default 600000) unless `force` is passed
 * - refreshMaster(pool): master address native + visible tokens → managed_master_balances
 *
 * Reads go through Multicall3 (multicall.ts). Every upsert carries the block
 * number read at the start of the refresh.
 */

import { NATIVE_ASSET } from "../types";
import type { Asset, Network } from "../types";
import { DEFAULTS, readEnvInt } from "./fees";
import { getEthBalances, getTokenBalances } from "./multicall";
import type {
  BalanceUpsert,
  BalancesPort,
  ChainReader,
  ClockPort,
  LoggerPort,
  MasterBalanceUpsert,
  PoolRow,
  TokensPort,
  WalletsPort,
} from "./ports";
import { systemClock } from "./ports";

/** A (wallet, asset) pair whose balance must be re-read. */
export interface DirtyPair {
  walletId: string;
  address: string;
  asset: Asset;
}

/** What the indexer and the worker need from the balance layer (fakes in tests). */
export interface BalanceRefresher {
  refreshPairs(network: Network, pairs: DirtyPair[]): Promise<void>;
  /** Returns true when a full refresh ran (false when throttled). */
  refreshAll(network: Network, force?: boolean): Promise<boolean>;
  refreshMaster(pool: PoolRow): Promise<void>;
}

export interface BalanceServiceDeps {
  balances: BalancesPort;
  wallets: WalletsPort;
  tokens: TokensPort;
  providerFor: (network: Network) => ChainReader;
  clock?: ClockPort;
  /** Required: a redacting logger (SR-09). */
  logger: LoggerPort;
}

export interface BalanceServiceOptions {
  fullRefreshMs: number;
  multicallAddress?: string;
}

export function balanceOptionsFromEnv(): BalanceServiceOptions {
  return {
    fullRefreshMs: readEnvInt("MANAGED_FULL_REFRESH_MS", DEFAULTS.MANAGED_FULL_REFRESH_MS),
  };
}

export class BalanceService implements BalanceRefresher {
  private readonly clock: ClockPort;
  private readonly logger: LoggerPort;
  private readonly lastFullRefresh = new Map<Network, number>();

  constructor(
    private readonly deps: BalanceServiceDeps,
    private readonly options: BalanceServiceOptions = balanceOptionsFromEnv()
  ) {
    this.clock = deps.clock ?? systemClock;
    this.logger = deps.logger;
  }

  /** Re-reads the given pairs and upserts them. Duplicates are collapsed. */
  async refreshPairs(network: Network, pairs: DirtyPair[]): Promise<void> {
    if (pairs.length === 0) return;
    const provider = this.deps.providerFor(network);
    const blockNumber = await safeBlockNumber(provider);

    // asset → (lowercase address → walletId)
    const byAsset = new Map<string, Map<string, string>>();
    for (const p of pairs) {
      const asset = p.asset.toLowerCase();
      let m = byAsset.get(asset);
      if (!m) {
        m = new Map();
        byAsset.set(asset, m);
      }
      m.set(p.address.toLowerCase(), p.walletId);
    }

    const rows: BalanceUpsert[] = [];
    for (const [asset, addrToWallet] of byAsset) {
      const addresses = [...addrToWallet.keys()];
      const balances = await this.readBalances(provider, asset, addresses);
      for (const [addr, walletId] of addrToWallet) {
        rows.push({
          walletId,
          asset,
          balanceWei: (balances.get(addr) ?? 0n).toString(),
          blockNumber,
        });
      }
    }
    await this.deps.balances.upsertMany(rows);
    this.logger.info("balances refreshed", { network, pairs: rows.length, blockNumber });
  }

  /** Every ACTIVE wallet × (native + visible tokens). Throttled unless forced. */
  async refreshAll(network: Network, force = false): Promise<boolean> {
    const now = this.clock.now();
    const last = this.lastFullRefresh.get(network) ?? 0;
    if (!force && now - last < this.options.fullRefreshMs) return false;
    this.lastFullRefresh.set(network, now);

    const wallets = await this.deps.wallets.listActiveAddressesByNetwork(network);
    if (wallets.length === 0) return true;
    const tokens = await this.deps.tokens.listByNetwork(network, false);
    const assets: Asset[] = [NATIVE_ASSET, ...tokens.map((t) => t.tokenAddress.toLowerCase())];

    const pairs: DirtyPair[] = [];
    for (const w of wallets) {
      for (const asset of assets) {
        pairs.push({ walletId: w.walletId, address: w.address, asset });
      }
    }
    await this.refreshPairs(network, pairs);
    this.logger.info("full balance refresh done", {
      network,
      wallets: wallets.length,
      assets: assets.length,
    });
    return true;
  }

  /** Master address native + visible token balances → managed_master_balances. */
  async refreshMaster(pool: PoolRow): Promise<void> {
    const provider = this.deps.providerFor(pool.network);
    const blockNumber = await safeBlockNumber(provider);
    const master = pool.masterAddress.toLowerCase();
    const tokens = await this.deps.tokens.listByNetwork(pool.network, false);
    const assets: Asset[] = [NATIVE_ASSET, ...tokens.map((t) => t.tokenAddress.toLowerCase())];

    const rows: MasterBalanceUpsert[] = [];
    for (const asset of assets) {
      const balances = await this.readBalances(provider, asset, [master]);
      rows.push({
        poolId: pool.id,
        asset,
        balanceWei: (balances.get(master) ?? 0n).toString(),
        blockNumber,
      });
    }
    await this.deps.balances.upsertMaster(rows);
    this.logger.info("master balances refreshed", { poolId: pool.id, assets: rows.length });
  }

  private readBalances(
    provider: ChainReader,
    asset: Asset,
    addresses: string[]
  ): Promise<Map<string, bigint>> {
    const opts = { multicallAddress: this.options.multicallAddress };
    return asset === NATIVE_ASSET
      ? getEthBalances(provider, addresses, opts)
      : getTokenBalances(provider, asset, addresses, opts);
  }
}

async function safeBlockNumber(provider: ChainReader): Promise<number | null> {
  try {
    return await provider.getBlockNumber();
  } catch {
    return null;
  }
}
