import { randomUUID } from "crypto";
import { postgresPool } from "../lib/postgres";

export interface IWallet {
  _id: string;
  sessionId: string;
  index: number;
  address: string;
  derivationPath: string;
  amount: number;
  amountWei: string;
  packedHex: string;
  sent: boolean;
  failed?: boolean;
  failureReason?: string;
  txHash?: string;
  timestamp?: Date;
  batchId?: string;
}

export type NewWallet = Omit<IWallet, "_id">;

function mapWallet(row: any): IWallet {
  return {
    _id: row.id,
    sessionId: row.session_id,
    index: row.wallet_index,
    address: row.address,
    derivationPath: row.derivation_path,
    amount: Number(row.amount),
    amountWei: row.amount_wei,
    packedHex: row.packed_hex,
    sent: row.sent,
    failed: row.failed,
    failureReason: row.failure_reason ?? undefined,
    txHash: row.tx_hash ?? undefined,
    timestamp: row.timestamp ?? undefined,
    batchId: row.batch_id ?? undefined,
  };
}

function requirePool() {
  if (!postgresPool) {
    throw new Error("[PostgreSQL] DATABASE_URL is not configured");
  }

  return postgresPool;
}

/** Builds "($1, $2, ...), ($n, ...)" for a multi-row VALUES list. */
function valuesList(rowCount: number, columnCount: number, offset = 0): string {
  const rows: string[] = [];

  for (let r = 0; r < rowCount; r++) {
    const params: string[] = [];
    for (let c = 1; c <= columnCount; c++) {
      params.push(`$${offset + r * columnCount + c}`);
    }
    rows.push(`(${params.join(", ")})`);
  }

  return rows.join(", ");
}

const CHUNK_SIZE = 500;

export const Wallet = {
  async count(
    sessionId: string,
    filter: { sent?: boolean; failed?: boolean } = {}
  ): Promise<number> {
    const pool = requirePool();

    const conditions = ["session_id = $1"];
    const values: unknown[] = [sessionId];

    if (filter.sent !== undefined) {
      values.push(filter.sent);
      conditions.push(`sent = $${values.length}`);
    }

    if (filter.failed !== undefined) {
      values.push(filter.failed);
      conditions.push(`failed = $${values.length}`);
    }

    const result = await pool.query(
      `
        SELECT COUNT(*)::int AS count
        FROM wallets
        WHERE ${conditions.join(" AND ")}
      `,
      values
    );

    return result.rows[0].count;
  },

  async findBySession(
    sessionId: string,
    page?: { skip: number; limit: number }
  ): Promise<IWallet[]> {
    const pool = requirePool();

    const values: unknown[] = [sessionId];
    let pagination = "";

    if (page) {
      values.push(page.limit, page.skip);
      pagination = "LIMIT $2 OFFSET $3";
    }

    const result = await pool.query(
      `
        SELECT *
        FROM wallets
        WHERE session_id = $1
        ORDER BY wallet_index ASC
        ${pagination}
      `,
      values
    );

    return result.rows.map(mapWallet);
  },

  async summary(
    sessionId: string
  ): Promise<{ totalWallets: number; totalTokens: number }> {
    const pool = requirePool();

    const result = await pool.query(
      `
        SELECT COUNT(*)::int AS total_wallets,
               COALESCE(SUM(amount), 0) AS total_tokens
        FROM wallets
        WHERE session_id = $1
      `,
      [sessionId]
    );

    return {
      totalWallets: result.rows[0].total_wallets,
      totalTokens: Number(result.rows[0].total_tokens),
    };
  },

  async insertMany(wallets: NewWallet[]): Promise<void> {
    const pool = requirePool();

    for (let i = 0; i < wallets.length; i += CHUNK_SIZE) {
      const chunk = wallets.slice(i, i + CHUNK_SIZE);
      const values = chunk.flatMap((w) => [
        randomUUID(),
        w.sessionId,
        w.index,
        w.address,
        w.derivationPath,
        w.amount,
        w.amountWei,
        w.packedHex,
        w.sent,
        w.failed ?? false,
      ]);

      await pool.query(
        `
          INSERT INTO wallets (
            id,
            session_id,
            wallet_index,
            address,
            derivation_path,
            amount,
            amount_wei,
            packed_hex,
            sent,
            failed
          )
          VALUES ${valuesList(chunk.length, 10)}
          ON CONFLICT (session_id, wallet_index) DO NOTHING
        `,
        values
      );
    }
  },

  /** Writes amounts from distribution-plan.json, inserting wallets that don't exist yet. */
  async upsertPlan(
    sessionId: string,
    entries: Array<{
      index: number;
      address: string;
      amount: number;
      amountWei: string;
      packedHex: string;
      sent: boolean;
    }>
  ): Promise<void> {
    const pool = requirePool();

    for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
      const chunk = entries.slice(i, i + CHUNK_SIZE);
      const values = chunk.flatMap((e) => [
        randomUUID(),
        sessionId,
        e.index,
        e.address,
        e.amount,
        e.amountWei,
        e.packedHex,
        e.sent,
      ]);

      await pool.query(
        `
          INSERT INTO wallets (
            id,
            session_id,
            wallet_index,
            address,
            amount,
            amount_wei,
            packed_hex,
            sent,
            derivation_path,
            failed
          )
          SELECT v.id, v.session_id, v.wallet_index::int, v.address,
                 v.amount::numeric, v.amount_wei, v.packed_hex, v.sent::boolean,
                 '', false
          FROM (VALUES ${valuesList(chunk.length, 8)})
            AS v(id, session_id, wallet_index, address, amount, amount_wei, packed_hex, sent)
          ON CONFLICT (session_id, wallet_index) DO UPDATE SET
            address = EXCLUDED.address,
            amount = EXCLUDED.amount,
            amount_wei = EXCLUDED.amount_wei,
            packed_hex = EXCLUDED.packed_hex,
            sent = EXCLUDED.sent,
            failed = false,
            failure_reason = NULL
        `,
        values
      );
    }
  },

  /** Marks the given wallet indexes as sent, keeping the stored tx hash when none is given. */
  async markSent(
    sessionId: string,
    entries: Array<{ index: number; txHash: string | null; timestamp: Date }>
  ): Promise<void> {
    const pool = requirePool();

    for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
      const chunk = entries.slice(i, i + CHUNK_SIZE);
      const values: unknown[] = [
        sessionId,
        ...chunk.flatMap((e) => [e.index, e.txHash, e.timestamp]),
      ];

      await pool.query(
        `
          UPDATE wallets AS w
          SET sent = true,
              failed = false,
              failure_reason = NULL,
              tx_hash = COALESCE(v.tx_hash, w.tx_hash),
              timestamp = v.ts::timestamptz
          FROM (VALUES ${valuesList(chunk.length, 3, 1)})
            AS v(wallet_index, tx_hash, ts)
          WHERE w.session_id = $1
            AND w.wallet_index = v.wallet_index::int
        `,
        values
      );
    }
  },

  async markUnsentFailed(sessionId: string, reason: string): Promise<void> {
    const pool = requirePool();

    await pool.query(
      `
        UPDATE wallets
        SET failed = true,
            failure_reason = $2
        WHERE session_id = $1
          AND sent = false
      `,
      [sessionId, reason]
    );
  },

  async deleteBySession(sessionId: string): Promise<void> {
    const pool = requirePool();

    await pool.query(
      `
        DELETE FROM wallets
        WHERE session_id = $1
      `,
      [sessionId]
    );
  },
};
