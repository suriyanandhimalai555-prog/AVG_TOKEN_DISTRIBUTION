import { randomUUID } from "crypto";
import { postgresPool } from "../lib/postgres";

export type BatchStatus = "pending" | "confirmed" | "failed";

export interface IBatch {
  _id: string;
  sessionId: string;
  batchIndex: number;
  walletCount: number;
  txHash?: string;
  gasUsed?: string;
  status: BatchStatus;
  createdAt: Date;
  updatedAt: Date;
  confirmedAt?: Date;
}

function mapBatch(row: any): IBatch {
  return {
    _id: row.id,
    sessionId: row.session_id,
    batchIndex: row.batch_index,
    walletCount: row.wallet_count,
    txHash: row.tx_hash ?? undefined,
    gasUsed: row.gas_used ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    confirmedAt: row.confirmed_at ?? undefined,
  };
}

function requirePool() {
  if (!postgresPool) {
    throw new Error("[PostgreSQL] DATABASE_URL is not configured");
  }

  return postgresPool;
}

export const Batch = {
  async count(sessionId: string, status?: BatchStatus): Promise<number> {
    const pool = requirePool();

    const values: unknown[] = [sessionId];
    let statusFilter = "";

    if (status) {
      values.push(status);
      statusFilter = "AND status = $2";
    }

    const result = await pool.query(
      `
        SELECT COUNT(*)::int AS count
        FROM batches
        WHERE session_id = $1
          ${statusFilter}
      `,
      values
    );

    return result.rows[0].count;
  },

  async sumConfirmedWalletCount(sessionId: string): Promise<number> {
    const pool = requirePool();

    const result = await pool.query(
      `
        SELECT COALESCE(SUM(wallet_count), 0)::int AS total
        FROM batches
        WHERE session_id = $1
          AND status = 'confirmed'
      `,
      [sessionId]
    );

    return result.rows[0].total;
  },

  async findBySession(
    sessionId: string,
    page: { skip: number; limit: number }
  ): Promise<IBatch[]> {
    const pool = requirePool();

    const result = await pool.query(
      `
        SELECT *
        FROM batches
        WHERE session_id = $1
        ORDER BY batch_index DESC
        LIMIT $2
        OFFSET $3
      `,
      [sessionId, page.limit, page.skip]
    );

    return result.rows.map(mapBatch);
  },

  async upsertConfirmed(data: {
    sessionId: string;
    batchIndex: number;
    walletCount: number;
    txHash?: string;
    gasUsed?: string;
  }): Promise<void> {
    const pool = requirePool();
    const now = new Date();

    await pool.query(
      `
        INSERT INTO batches (
          id,
          session_id,
          batch_index,
          wallet_count,
          tx_hash,
          gas_used,
          status,
          created_at,
          updated_at,
          confirmed_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', $7, $7, $7)
        ON CONFLICT (session_id, batch_index) DO UPDATE SET
          wallet_count = EXCLUDED.wallet_count,
          tx_hash = EXCLUDED.tx_hash,
          gas_used = EXCLUDED.gas_used,
          status = 'confirmed',
          updated_at = EXCLUDED.updated_at,
          confirmed_at = EXCLUDED.confirmed_at
      `,
      [
        randomUUID(),
        data.sessionId,
        data.batchIndex,
        data.walletCount,
        data.txHash ?? null,
        data.gasUsed ?? null,
        now,
      ]
    );
  },

  async deleteBySession(sessionId: string): Promise<void> {
    const pool = requirePool();

    await pool.query(
      `
        DELETE FROM batches
        WHERE session_id = $1
      `,
      [sessionId]
    );
  },
};
