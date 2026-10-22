import { randomUUID } from "crypto";
import { Asset, Deposit } from "../types";
import {
  CHUNK_SIZE,
  clampLimit,
  clampSkip,
  intFromRow,
  isoFromRow,
  nullableIsoFromRow,
  requirePool,
  toWei,
  valuesList,
  weiFromRow,
  WeiInput,
} from "./common";

/**
 * A deposit as stored, plus the wallet address (joined). Token display
 * fields (symbol, decimals, human amount) are resolved by the service layer
 * from managed_tokens, so they are omitted here.
 */
export type DepositRecord = Omit<Deposit, "symbol" | "decimals" | "amount">;

export interface NewDeposit {
  walletId: string;
  /** Lowercase token address. */
  asset: Asset;
  fromAddress: string;
  amountWei: WeiInput;
  txHash: string;
  logIndex: number;
  blockNumber: number;
  blockTime?: Date | null;
}

export interface ListDepositsOptions {
  skip?: number;
  limit?: number;
  asset?: Asset;
}

const DEPOSIT_SELECT = `
  d.*,
  w.address AS wallet_address
`;

function mapDeposit(row: any): DepositRecord {
  return {
    id: row.id,
    walletId: row.wallet_id,
    walletAddress: row.wallet_address,
    asset: row.asset,
    fromAddress: row.from_address,
    amountWei: weiFromRow(row.amount_wei),
    txHash: row.tx_hash,
    logIndex: row.log_index,
    blockNumber: intFromRow(row.block_number) ?? 0,
    blockTime: nullableIsoFromRow(row.block_time),
    createdAt: isoFromRow(row.created_at),
  };
}

export const deposits = {
  /**
   * Inserts in chunks of 500, ignoring rows whose (tx_hash, log_index) is
   * already stored. Returns the number of rows actually inserted.
   */
  async insertManyIgnoreDuplicates(rows: NewDeposit[]): Promise<number> {
    const pool = requirePool();
    let inserted = 0;

    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      const values = chunk.flatMap((d) => [
        randomUUID(),
        d.walletId,
        d.asset.toLowerCase(),
        d.fromAddress,
        toWei(d.amountWei),
        d.txHash,
        d.logIndex,
        d.blockNumber,
        d.blockTime ?? null,
      ]);

      const result = await pool.query(
        `
          INSERT INTO managed_deposits (
            id,
            wallet_id,
            asset,
            from_address,
            amount_wei,
            tx_hash,
            log_index,
            block_number,
            block_time
          )
          SELECT v.id::uuid, v.wallet_id::uuid, v.asset, v.from_address, v.amount_wei::numeric,
                 v.tx_hash, v.log_index::int, v.block_number::bigint, v.block_time::timestamptz
          FROM (VALUES ${valuesList(chunk.length, 9)})
            AS v(id, wallet_id, asset, from_address, amount_wei, tx_hash, log_index, block_number, block_time)
          ON CONFLICT (tx_hash, log_index) DO NOTHING
          RETURNING id
        `,
        values
      );

      inserted += result.rowCount ?? 0;
    }

    return inserted;
  },

  async listByPool(
    poolId: string,
    options: ListDepositsOptions = {}
  ): Promise<{ deposits: DepositRecord[]; total: number }> {
    const pool = requirePool();

    const conditions = ["w.pool_id = $1"];
    const values: unknown[] = [poolId];

    if (options.asset) {
      values.push(options.asset.toLowerCase());
      conditions.push(`d.asset = $${values.length}`);
    }

    const where = `WHERE ${conditions.join(" AND ")}`;

    const countResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM managed_deposits d
        JOIN managed_wallets w ON w.id = d.wallet_id
        ${where}
      `,
      values
    );

    values.push(clampLimit(options.limit, 50));
    const limitParam = values.length;
    values.push(clampSkip(options.skip));
    const skipParam = values.length;

    const result = await pool.query(
      `
        SELECT ${DEPOSIT_SELECT}
        FROM managed_deposits d
        JOIN managed_wallets w ON w.id = d.wallet_id
        ${where}
        ORDER BY d.block_number DESC, d.log_index DESC
        LIMIT $${limitParam} OFFSET $${skipParam}
      `,
      values
    );

    return { deposits: result.rows.map(mapDeposit), total: countResult.rows[0].total };
  },

  async listByWallet(walletId: string, limit = 50): Promise<DepositRecord[]> {
    const pool = requirePool();

    const result = await pool.query(
      `
        SELECT ${DEPOSIT_SELECT}
        FROM managed_deposits d
        JOIN managed_wallets w ON w.id = d.wallet_id
        WHERE d.wallet_id = $1
        ORDER BY d.block_number DESC, d.log_index DESC
        LIMIT $2
      `,
      [walletId, clampLimit(limit, 50)]
    );

    return result.rows.map(mapDeposit);
  },

  /** Newest deposit time in a pool (PoolStats.lastDepositAt), or null. */
  async lastDepositAtByPool(poolId: string): Promise<string | null> {
    const pool = requirePool();

    const result = await pool.query(
      `
        SELECT MAX(COALESCE(d.block_time, d.created_at)) AS last_at
        FROM managed_deposits d
        JOIN managed_wallets w ON w.id = d.wallet_id
        WHERE w.pool_id = $1
      `,
      [poolId]
    );

    return nullableIsoFromRow(result.rows[0]?.last_at);
  },

  /** Newest deposit time per wallet, for wallet list pages. Wallets without deposits are absent. */
  async lastDepositAtByWallets(walletIds: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (walletIds.length === 0) return out;
    const pool = requirePool();

    const result = await pool.query(
      `
        SELECT wallet_id, MAX(COALESCE(block_time, created_at)) AS last_at
        FROM managed_deposits
        WHERE wallet_id = ANY($1::uuid[])
        GROUP BY wallet_id
      `,
      [walletIds]
    );

    for (const row of result.rows) {
      out.set(row.wallet_id, isoFromRow(row.last_at));
    }

    return out;
  },
};
