import { Asset, Network } from "../types";
import {
  CHUNK_SIZE,
  intFromRow,
  isoFromRow,
  requirePool,
  toWei,
  valuesList,
  weiFromRow,
  WeiInput,
} from "./common";

/** One (wallet, asset) balance row. `asset` is 'native' or a lowercase token address. */
export interface BalanceRecord {
  walletId: string;
  asset: Asset;
  balanceWei: string;
  blockNumber: number | null;
  updatedAt: string;
}

export interface MasterBalanceRecord {
  poolId: string;
  asset: Asset;
  balanceWei: string;
  blockNumber: number | null;
  updatedAt: string;
}

export interface BalanceUpsert {
  walletId: string;
  asset: Asset;
  balanceWei: WeiInput;
  blockNumber?: number | null;
}

export interface MasterBalanceUpsert {
  poolId: string;
  asset: Asset;
  balanceWei: WeiInput;
  blockNumber?: number | null;
}

export interface AssetTotal {
  asset: Asset;
  totalWei: string;
  walletsWithBalance: number;
  updatedAt: string | null;
}

export interface NetworkAssetTotal extends AssetTotal {
  network: Network;
}

export interface PoolAssetTotal extends AssetTotal {
  poolId: string;
}

function mapBalance(row: any): BalanceRecord {
  return {
    walletId: row.wallet_id,
    asset: row.asset,
    balanceWei: weiFromRow(row.balance_wei),
    blockNumber: intFromRow(row.block_number),
    updatedAt: isoFromRow(row.updated_at),
  };
}

function mapMasterBalance(row: any): MasterBalanceRecord {
  return {
    poolId: row.pool_id,
    asset: row.asset,
    balanceWei: weiFromRow(row.balance_wei),
    blockNumber: intFromRow(row.block_number),
    updatedAt: isoFromRow(row.updated_at),
  };
}

function mapTotal(row: any): AssetTotal {
  return {
    asset: row.asset,
    totalWei: weiFromRow(row.total_wei),
    walletsWithBalance: intFromRow(row.wallets_with_balance) ?? 0,
    updatedAt: row.updated_at ? isoFromRow(row.updated_at) : null,
  };
}

export const balances = {
  /**
   * Upserts in chunks of 500. A row is only overwritten when the incoming
   * block number is not older than the stored one, so a slow refresh cannot
   * clobber a newer reading.
   */
  async upsertMany(entries: BalanceUpsert[]): Promise<void> {
    const pool = requirePool();
    const now = new Date();

    for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
      const chunk = entries.slice(i, i + CHUNK_SIZE);
      const values = chunk.flatMap((e) => [
        e.walletId,
        e.asset.toLowerCase(),
        toWei(e.balanceWei),
        e.blockNumber ?? null,
        now,
      ]);

      await pool.query(
        `
          INSERT INTO managed_balances (wallet_id, asset, balance_wei, block_number, updated_at)
          SELECT v.wallet_id::uuid, v.asset, v.balance_wei::numeric, v.block_number::bigint,
                 v.updated_at::timestamptz
          FROM (VALUES ${valuesList(chunk.length, 5)})
            AS v(wallet_id, asset, balance_wei, block_number, updated_at)
          ON CONFLICT (wallet_id, asset) DO UPDATE SET
            balance_wei = EXCLUDED.balance_wei,
            block_number = EXCLUDED.block_number,
            updated_at = EXCLUDED.updated_at
          WHERE managed_balances.block_number IS NULL
             OR EXCLUDED.block_number IS NULL
             OR EXCLUDED.block_number >= managed_balances.block_number
        `,
        values
      );
    }
  },

  async listByWallet(walletId: string): Promise<BalanceRecord[]> {
    const pool = requirePool();

    const result = await pool.query(
      `
        SELECT *
        FROM managed_balances
        WHERE wallet_id = $1
        ORDER BY asset ASC
      `,
      [walletId]
    );

    return result.rows.map(mapBalance);
  },

  /** Balances for many wallets at once (wallet list pages). */
  async listByWallets(walletIds: string[]): Promise<BalanceRecord[]> {
    if (walletIds.length === 0) return [];
    const pool = requirePool();

    const result = await pool.query(
      `
        SELECT *
        FROM managed_balances
        WHERE wallet_id = ANY($1::uuid[])
        ORDER BY wallet_id ASC, asset ASC
      `,
      [walletIds]
    );

    return result.rows.map(mapBalance);
  },

  /** Non-zero (wallet, asset) pairs in a pool, the input of a sweep. */
  async listNonZeroByPool(
    poolId: string,
    filter: { walletIds?: string[]; assets?: Asset[] } = {}
  ): Promise<BalanceRecord[]> {
    const pool = requirePool();

    const conditions = ["w.pool_id = $1", "b.balance_wei > 0"];
    const values: unknown[] = [poolId];

    if (filter.walletIds) {
      values.push(filter.walletIds);
      conditions.push(`b.wallet_id = ANY($${values.length}::uuid[])`);
    }
    if (filter.assets) {
      values.push(filter.assets.map((a) => a.toLowerCase()));
      conditions.push(`b.asset = ANY($${values.length}::text[])`);
    }

    const result = await pool.query(
      `
        SELECT b.*
        FROM managed_balances b
        JOIN managed_wallets w ON w.id = b.wallet_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY w.derivation_index ASC, b.asset ASC
      `,
      values
    );

    return result.rows.map(mapBalance);
  },

  /** Per-asset totals over all wallets of one pool. */
  async aggregateByPool(poolId: string): Promise<AssetTotal[]> {
    const pool = requirePool();

    const result = await pool.query(
      `
        SELECT b.asset,
               SUM(b.balance_wei) AS total_wei,
               COUNT(*) FILTER (WHERE b.balance_wei > 0)::int AS wallets_with_balance,
               MAX(b.updated_at) AS updated_at
        FROM managed_balances b
        JOIN managed_wallets w ON w.id = b.wallet_id
        WHERE w.pool_id = $1
        GROUP BY b.asset
        ORDER BY b.asset ASC
      `,
      [poolId]
    );

    return result.rows.map(mapTotal);
  },

  /** Per-(pool, asset) totals over every pool, for the global treasury page. */
  async aggregateByPools(): Promise<PoolAssetTotal[]> {
    const pool = requirePool();

    const result = await pool.query(
      `
        SELECT w.pool_id,
               b.asset,
               SUM(b.balance_wei) AS total_wei,
               COUNT(*) FILTER (WHERE b.balance_wei > 0)::int AS wallets_with_balance,
               MAX(b.updated_at) AS updated_at
        FROM managed_balances b
        JOIN managed_wallets w ON w.id = b.wallet_id
        GROUP BY w.pool_id, b.asset
        ORDER BY w.pool_id ASC, b.asset ASC
      `
    );

    return result.rows.map((row) => ({ ...mapTotal(row), poolId: row.pool_id }));
  },

  /** Per-(network, asset) totals over every pool. */
  async aggregateAll(): Promise<NetworkAssetTotal[]> {
    const pool = requirePool();

    const result = await pool.query(
      `
        SELECT p.network,
               b.asset,
               SUM(b.balance_wei) AS total_wei,
               COUNT(*) FILTER (WHERE b.balance_wei > 0)::int AS wallets_with_balance,
               MAX(b.updated_at) AS updated_at
        FROM managed_balances b
        JOIN managed_wallets w ON w.id = b.wallet_id
        JOIN managed_pools p ON p.id = w.pool_id
        GROUP BY p.network, b.asset
        ORDER BY p.network ASC, b.asset ASC
      `
    );

    return result.rows.map((row) => ({ ...mapTotal(row), network: row.network }));
  },

  async upsertMaster(entries: MasterBalanceUpsert[]): Promise<void> {
    const pool = requirePool();
    const now = new Date();

    for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
      const chunk = entries.slice(i, i + CHUNK_SIZE);
      const values = chunk.flatMap((e) => [
        e.poolId,
        e.asset.toLowerCase(),
        toWei(e.balanceWei),
        e.blockNumber ?? null,
        now,
      ]);

      await pool.query(
        `
          INSERT INTO managed_master_balances (pool_id, asset, balance_wei, block_number, updated_at)
          SELECT v.pool_id::uuid, v.asset, v.balance_wei::numeric, v.block_number::bigint,
                 v.updated_at::timestamptz
          FROM (VALUES ${valuesList(chunk.length, 5)})
            AS v(pool_id, asset, balance_wei, block_number, updated_at)
          ON CONFLICT (pool_id, asset) DO UPDATE SET
            balance_wei = EXCLUDED.balance_wei,
            block_number = EXCLUDED.block_number,
            updated_at = EXCLUDED.updated_at
          WHERE managed_master_balances.block_number IS NULL
             OR EXCLUDED.block_number IS NULL
             OR EXCLUDED.block_number >= managed_master_balances.block_number
        `,
        values
      );
    }
  },

  async listMaster(poolId: string): Promise<MasterBalanceRecord[]> {
    const pool = requirePool();

    const result = await pool.query(
      `
        SELECT *
        FROM managed_master_balances
        WHERE pool_id = $1
        ORDER BY asset ASC
      `,
      [poolId]
    );

    return result.rows.map(mapMasterBalance);
  },
};
