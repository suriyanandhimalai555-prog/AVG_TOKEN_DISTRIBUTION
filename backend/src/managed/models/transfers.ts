import { randomUUID } from "crypto";
import { Pool, PoolClient } from "pg";
import { Asset, TransferJob, TransferStatus } from "../types";
import {
  CHUNK_SIZE,
  clampLimit,
  clampSkip,
  intFromRow,
  isoFromRow,
  nullableIsoFromRow,
  nullableWeiFromRow,
  requirePool,
  toNullableWei,
  toWei,
  valuesList,
  weiFromRow,
  WeiInput,
} from "./common";

/**
 * A transfer job as stored, plus the wallet address (joined). Token display
 * fields (symbol, decimals, human amount) and the parsed errorCode are
 * resolved by the service layer.
 */
export type TransferRecord = Omit<TransferJob, "symbol" | "decimals" | "amount" | "errorCode">;

export interface NewTransfer {
  poolId: string;
  walletId: string;
  toAddress: string;
  /** 'native' or lowercase token address. */
  asset: Asset;
  /** 0 with sweepAll = true means "all". */
  amountWei: WeiInput;
  sweepAll?: boolean;
  idempotencyKey: string;
  requestedBy: string;
  batchId?: string | null;
}

export interface TransferPatch {
  status?: TransferStatus;
  gasTopupTxHash?: string | null;
  transferTxHash?: string | null;
  gasPriceWei?: WeiInput | null;
  gasLimit?: number | bigint | null;
  error?: string | null;
  attempts?: number;
  confirmedAt?: Date | null;
  amountWei?: WeiInput;
}

export interface ListTransfersOptions {
  poolId?: string;
  walletId?: string;
  batchId?: string;
  status?: TransferStatus;
  skip?: number;
  limit?: number;
}

/** A job locked by pickNextPending together with the client that holds the lock. */
export interface PickedTransfer {
  job: TransferRecord;
  client: PoolClient;
}

type Queryable = Pool | PoolClient;

const COLUMNS: Record<keyof TransferPatch, string> = {
  status: "status",
  gasTopupTxHash: "gas_topup_tx_hash",
  transferTxHash: "transfer_tx_hash",
  gasPriceWei: "gas_price_wei",
  gasLimit: "gas_limit",
  error: "error",
  attempts: "attempts",
  confirmedAt: "confirmed_at",
  amountWei: "amount_wei",
};

const TRANSFER_SELECT = `
  t.*,
  w.address AS wallet_address
`;

const TRANSFER_FROM = `
  FROM managed_transfers t
  JOIN managed_wallets w ON w.id = t.wallet_id
`;

function mapTransfer(row: any): TransferRecord {
  return {
    id: row.id,
    poolId: row.pool_id,
    walletId: row.wallet_id,
    walletAddress: row.wallet_address,
    batchId: row.batch_id ?? null,
    toAddress: row.to_address,
    asset: row.asset,
    amountWei: weiFromRow(row.amount_wei),
    sweepAll: row.sweep_all,
    status: row.status,
    gasTopupTxHash: row.gas_topup_tx_hash ?? null,
    transferTxHash: row.transfer_tx_hash ?? null,
    gasPriceWei: nullableWeiFromRow(row.gas_price_wei),
    gasLimit: intFromRow(row.gas_limit),
    error: row.error ?? null,
    attempts: row.attempts,
    requestedBy: row.requested_by,
    createdAt: isoFromRow(row.created_at),
    updatedAt: isoFromRow(row.updated_at),
    confirmedAt: nullableIsoFromRow(row.confirmed_at),
  };
}

function patchValue(key: keyof TransferPatch, value: unknown): unknown {
  if (value === undefined || value === null) return null;
  switch (key) {
    case "gasPriceWei":
    case "amountWei":
      return toWei(value as WeiInput);
    case "gasLimit":
      return typeof value === "bigint" ? value.toString() : value;
    default:
      return value;
  }
}

async function findByIdWith(db: Queryable, id: string): Promise<TransferRecord | null> {
  const result = await db.query(
    `
      SELECT ${TRANSFER_SELECT}
      ${TRANSFER_FROM}
      WHERE t.id = $1
      LIMIT 1
    `,
    [id]
  );

  return result.rows[0] ? mapTransfer(result.rows[0]) : null;
}

export const transfers = {
  /**
   * Creates a PENDING job. A repeated idempotency key returns the existing
   * job with `created: false` (API: 200 instead of 201).
   */
  async create(data: NewTransfer): Promise<{ job: TransferRecord; created: boolean }> {
    const pool = requirePool();

    const inserted = await pool.query(
      `
        INSERT INTO managed_transfers (
          id,
          pool_id,
          wallet_id,
          batch_id,
          to_address,
          asset,
          amount_wei,
          sweep_all,
          status,
          idempotency_key,
          requested_by,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING', $9, $10, NOW(), NOW())
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id
      `,
      [
        randomUUID(),
        data.poolId,
        data.walletId,
        data.batchId ?? null,
        data.toAddress,
        data.asset.toLowerCase() === "native" ? "native" : data.asset.toLowerCase(),
        toWei(data.amountWei),
        data.sweepAll ?? false,
        data.idempotencyKey,
        data.requestedBy,
      ]
    );

    if (inserted.rows[0]) {
      const job = await findByIdWith(pool, inserted.rows[0].id);
      if (!job) throw new Error("managed transfer vanished after insert");
      return { job, created: true };
    }

    const existing = await transfers.findByIdempotencyKey(data.idempotencyKey);
    if (!existing) throw new Error("managed transfer idempotency conflict without a row");
    return { job: existing, created: false };
  },

  /**
   * Inserts one PENDING job per entry under a shared batch id, in chunks of
   * 500, skipping entries whose idempotency key already exists. Returns the
   * number of jobs actually inserted.
   */
  async createBatch(batchId: string, entries: Omit<NewTransfer, "batchId">[]): Promise<number> {
    const pool = requirePool();
    let inserted = 0;

    for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
      const chunk = entries.slice(i, i + CHUNK_SIZE);
      const values = chunk.flatMap((e) => [
        randomUUID(),
        e.poolId,
        e.walletId,
        batchId,
        e.toAddress,
        e.asset.toLowerCase() === "native" ? "native" : e.asset.toLowerCase(),
        toWei(e.amountWei),
        e.sweepAll ?? false,
        e.idempotencyKey,
        e.requestedBy,
      ]);

      const result = await pool.query(
        `
          INSERT INTO managed_transfers (
            id,
            pool_id,
            wallet_id,
            batch_id,
            to_address,
            asset,
            amount_wei,
            sweep_all,
            status,
            idempotency_key,
            requested_by,
            created_at,
            updated_at
          )
          SELECT v.id::uuid, v.pool_id::uuid, v.wallet_id::uuid, v.batch_id::uuid, v.to_address,
                 v.asset, v.amount_wei::numeric, v.sweep_all::boolean, 'PENDING',
                 v.idempotency_key, v.requested_by, NOW(), NOW()
          FROM (VALUES ${valuesList(chunk.length, 10)})
            AS v(id, pool_id, wallet_id, batch_id, to_address, asset, amount_wei, sweep_all,
                 idempotency_key, requested_by)
          ON CONFLICT (idempotency_key) DO NOTHING
          RETURNING id
        `,
        values
      );

      inserted += result.rowCount ?? 0;
    }

    return inserted;
  },

  /**
   * Locks the oldest PENDING job inside a dedicated transaction
   * (FOR UPDATE SKIP LOCKED), moves it to `options.status` (default SENDING)
   * and increments attempts. Returns the job and the client holding the lock;
   * the caller MUST finish with `transfers.release(client, commit)`.
   * Returns null when nothing is pending.
   */
  async pickNextPending(
    options: { status?: Extract<TransferStatus, "FUNDING_GAS" | "SENDING"> } = {}
  ): Promise<PickedTransfer | null> {
    const pool = requirePool();
    const nextStatus = options.status ?? "SENDING";
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const picked = await client.query(
        `
          SELECT id
          FROM managed_transfers
          WHERE status = 'PENDING'
          ORDER BY created_at ASC, id ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        `
      );

      if (!picked.rows[0]) {
        await client.query("ROLLBACK");
        client.release();
        return null;
      }

      const result = await client.query(
        `
          UPDATE managed_transfers t
          SET status = $2,
              attempts = t.attempts + 1,
              error = NULL,
              updated_at = NOW()
          FROM managed_wallets w
          WHERE t.id = $1
            AND w.id = t.wallet_id
          RETURNING t.*, w.address AS wallet_address
        `,
        [picked.rows[0].id, nextStatus]
      );

      return { job: mapTransfer(result.rows[0]), client };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
      throw err;
    }
  },

  /** Ends the transaction opened by pickNextPending and returns the client to the pool. */
  async release(client: PoolClient, commit: boolean): Promise<void> {
    try {
      await client.query(commit ? "COMMIT" : "ROLLBACK");
    } finally {
      client.release();
    }
  },

  /**
   * Partial update. Keys present with an `undefined` value are cleared (set to NULL).
   * Unknown keys are ignored. Pass the client from pickNextPending to update
   * inside that transaction.
   */
  async update(
    id: string,
    patch: TransferPatch,
    client?: PoolClient
  ): Promise<TransferRecord | null> {
    const db: Queryable = client ?? requirePool();

    const sets: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(patch)) {
      const column = COLUMNS[key as keyof TransferPatch];
      if (!column) continue;

      values.push(patchValue(key as keyof TransferPatch, value));
      sets.push(`${column} = $${values.length}`);
    }

    values.push(new Date());
    sets.push(`updated_at = $${values.length}`);

    values.push(id);

    await db.query(
      `
        UPDATE managed_transfers
        SET ${sets.join(", ")}
        WHERE id = $${values.length}
      `,
      values
    );

    return findByIdWith(db, id);
  },

  async findById(id: string, client?: PoolClient): Promise<TransferRecord | null> {
    return findByIdWith(client ?? requirePool(), id);
  },

  async findByIdempotencyKey(idempotencyKey: string): Promise<TransferRecord | null> {
    const pool = requirePool();

    const result = await pool.query(
      `
        SELECT ${TRANSFER_SELECT}
        ${TRANSFER_FROM}
        WHERE t.idempotency_key = $1
        LIMIT 1
      `,
      [idempotencyKey]
    );

    return result.rows[0] ? mapTransfer(result.rows[0]) : null;
  },

  async list(
    options: ListTransfersOptions = {}
  ): Promise<{ jobs: TransferRecord[]; total: number }> {
    const pool = requirePool();

    const conditions: string[] = [];
    const values: unknown[] = [];

    if (options.poolId) {
      values.push(options.poolId);
      conditions.push(`t.pool_id = $${values.length}`);
    }
    if (options.walletId) {
      values.push(options.walletId);
      conditions.push(`t.wallet_id = $${values.length}`);
    }
    if (options.batchId) {
      values.push(options.batchId);
      conditions.push(`t.batch_id = $${values.length}`);
    }
    if (options.status) {
      values.push(options.status);
      conditions.push(`t.status = $${values.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        ${TRANSFER_FROM}
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
        SELECT ${TRANSFER_SELECT}
        ${TRANSFER_FROM}
        ${where}
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT $${limitParam} OFFSET $${skipParam}
      `,
      values
    );

    return { jobs: result.rows.map(mapTransfer), total: countResult.rows[0].total };
  },

  async listByWallet(walletId: string, limit = 50): Promise<TransferRecord[]> {
    const { jobs } = await transfers.list({ walletId, limit, skip: 0 });
    return jobs;
  },

  /** Jobs left in FUNDING_GAS or SENDING by a previous process (ARCHITECTURE.md §3.6). */
  async listInterrupted(): Promise<TransferRecord[]> {
    const pool = requirePool();

    const result = await pool.query(
      `
        SELECT ${TRANSFER_SELECT}
        ${TRANSFER_FROM}
        WHERE t.status IN ('FUNDING_GAS', 'SENDING')
        ORDER BY t.created_at ASC, t.id ASC
      `
    );

    return result.rows.map(mapTransfer);
  },

  async countByStatus(
    filter: { batchId?: string; poolId?: string } = {}
  ): Promise<Partial<Record<TransferStatus, number>>> {
    const pool = requirePool();

    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filter.batchId) {
      values.push(filter.batchId);
      conditions.push(`batch_id = $${values.length}`);
    }
    if (filter.poolId) {
      values.push(filter.poolId);
      conditions.push(`pool_id = $${values.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await pool.query(
      `
        SELECT status, COUNT(*)::int AS count
        FROM managed_transfers
        ${where}
        GROUP BY status
      `,
      values
    );

    const out: Partial<Record<TransferStatus, number>> = {};
    for (const row of result.rows) {
      out[row.status as TransferStatus] = row.count;
    }
    return out;
  },
};
