/**
 * Treasury aggregates and the deposit feed. Pure reads over N2 aggregates;
 * balances are whatever the indexer last wrote (no RPC calls here).
 */
import { balances } from "../models/balances";
import type { AssetTotal, MasterBalanceRecord } from "../models/balances";
import { deposits } from "../models/deposits";
import type { DepositRecord } from "../models/deposits";
import { pools } from "../models/pools";
import type { PoolRecord } from "../models/pools";
import { NATIVE_ASSET } from "../types";
import type {
  Deposit,
  GlobalTreasuryResponse,
  ListDepositsQuery,
  ListDepositsResponse,
  ManagedToken,
  Network,
  PoolTreasuryResponse,
  TreasuryMasterBalance,
  TreasuryTotal,
} from "../types";
import {
  assetMeta,
  formatAmount,
  normalizeAsset,
  tokenMetaForAllNetworks,
  tokenMetaForNetwork,
  topUpBufferWei,
} from "./common";
import { requirePoolRecord } from "./poolService";

/** Master native balance below MANAGED_TOPUP_BUFFER_WEI × 50 means "low gas" (API.md). */
const LOW_GAS_TOPUPS = 50n;

export function toDeposit(network: Network, record: DepositRecord, meta: Map<string, ManagedToken>): Deposit {
  const m = assetMeta(network, record.asset, meta);
  return {
    ...record,
    symbol: m.symbol,
    decimals: m.decimals,
    amount: formatAmount(record.amountWei, m.decimals),
  };
}

function toTotals(
  network: Network,
  rows: AssetTotal[],
  meta: Map<string, ManagedToken>,
  key?: (asset: string) => string
): TreasuryTotal[] {
  const out: TreasuryTotal[] = [];
  for (const row of rows) {
    const m = assetMeta(network, row.asset, meta, key);
    if (m.hidden) continue;
    out.push({
      asset: m.asset,
      symbol: m.symbol,
      name: m.name,
      decimals: m.decimals,
      totalWei: row.totalWei,
      total: formatAmount(row.totalWei, m.decimals),
      walletsWithBalance: row.walletsWithBalance,
    });
  }
  return out;
}

function toMaster(
  network: Network,
  rows: MasterBalanceRecord[],
  meta: Map<string, ManagedToken>,
  key?: (asset: string) => string
): TreasuryMasterBalance[] {
  const out: TreasuryMasterBalance[] = [];
  for (const row of rows) {
    const m = assetMeta(network, row.asset, meta, key);
    if (m.hidden) continue;
    out.push({
      asset: m.asset,
      symbol: m.symbol,
      decimals: m.decimals,
      balanceWei: row.balanceWei,
      balance: formatAmount(row.balanceWei, m.decimals),
    });
  }
  return out;
}

function latest(...values: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  for (const v of values) {
    if (v && (!best || v > best)) best = v;
  }
  return best;
}

function buildPoolTreasury(
  pool: PoolRecord,
  totals: AssetTotal[],
  master: MasterBalanceRecord[],
  meta: Map<string, ManagedToken>,
  key?: (asset: string) => string
): PoolTreasuryResponse {
  const masterNative = master.find((m) => m.asset === NATIVE_ASSET);
  const masterNativeWei = BigInt(masterNative?.balanceWei ?? "0");
  return {
    poolId: pool.id,
    network: pool.network,
    masterAddress: pool.masterAddress,
    totals: toTotals(pool.network, totals, meta, key),
    master: toMaster(pool.network, master, meta, key),
    walletCount: pool.walletCount,
    lowGas: masterNativeWei < topUpBufferWei() * LOW_GAS_TOPUPS,
    updatedAt: latest(...totals.map((t) => t.updatedAt), ...master.map((m) => m.updatedAt)),
  };
}

export async function poolTreasury(poolId: string): Promise<PoolTreasuryResponse> {
  const pool = await requirePoolRecord(poolId);
  const [totals, master, meta] = await Promise.all([
    balances.aggregateByPool(poolId),
    balances.listMaster(poolId),
    tokenMetaForNetwork(pool.network),
  ]);
  return buildPoolTreasury(pool, totals, master, meta);
}

export async function globalTreasury(): Promise<GlobalTreasuryResponse> {
  const [allPools, perPool, perNetwork, meta] = await Promise.all([
    pools.listAll(),
    balances.aggregateByPools(),
    balances.aggregateAll(),
    tokenMetaForAllNetworks(),
  ]);

  const totalsByPool = new Map<string, AssetTotal[]>();
  for (const row of perPool) {
    const list = totalsByPool.get(row.poolId) ?? [];
    list.push(row);
    totalsByPool.set(row.poolId, list);
  }

  const byPool: PoolTreasuryResponse[] = [];
  for (const pool of allPools) {
    const master = await balances.listMaster(pool.id);
    const key = (a: string) => `${pool.network}:${a}`;
    byPool.push(buildPoolTreasury(pool, totalsByPool.get(pool.id) ?? [], master, meta, key));
  }

  const totalsByNetworkMap = new Map<Network, AssetTotal[]>();
  for (const row of perNetwork) {
    const list = totalsByNetworkMap.get(row.network) ?? [];
    list.push(row);
    totalsByNetworkMap.set(row.network, list);
  }
  const totalsByNetwork = [...totalsByNetworkMap.entries()].map(([network, rows]) => ({
    network,
    totals: toTotals(network, rows, meta, (a) => `${network}:${a}`),
  }));

  return {
    totalsByNetwork,
    byPool,
    poolCount: allPools.length,
    walletCount: allPools.reduce((sum, p) => sum + p.walletCount, 0),
  };
}

export async function listDeposits(poolId: string, query: ListDepositsQuery): Promise<ListDepositsResponse> {
  const pool = await requirePoolRecord(poolId);
  const asset = query.asset ? normalizeAsset(query.asset) : undefined;
  const [page, meta] = await Promise.all([
    deposits.listByPool(poolId, { skip: query.skip, limit: query.limit, asset }),
    tokenMetaForNetwork(pool.network),
  ]);
  return {
    deposits: page.deposits.map((d) => toDeposit(pool.network, d, meta)),
    total: page.total,
  };
}
