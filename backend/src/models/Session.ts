import { randomUUID } from "crypto";
import { postgresPool } from "../lib/postgres";

export type SessionStatus =
  | "idle"
  | "generating"
  | "preparing"
  | "distributing"
  | "done"
  | "stopped"
  | "error";

export interface ISession {
  _id: string;
  userId?: string;
  totalWallets: number;
  network: "bscMainnet" | "bscTestnet";
  tokenAddress: string;
  tokenName: string;
  multisenderAddress: string;
  status: SessionStatus;
  sentCount: number;
  failedCount: number;
  bnbSpent: number;
  startedAt?: Date;
  completedAt?: Date;
  masterMnemonic?: string;
  createdAt: Date;
  updatedAt: Date;
}

type SessionPatch = Partial<
  Omit<ISession, "_id" | "userId" | "createdAt" | "updatedAt">
>;

// camelCase field -> distribution_sessions column
const COLUMNS: Record<keyof SessionPatch, string> = {
  totalWallets: "total_wallets",
  network: "network",
  tokenAddress: "token_address",
  tokenName: "token_name",
  multisenderAddress: "multisender_address",
  status: "status",
  sentCount: "sent_count",
  failedCount: "failed_count",
  bnbSpent: "bnb_spent",
  startedAt: "started_at",
  completedAt: "completed_at",
  masterMnemonic: "master_mnemonic",
};

function mapSession(row: any): ISession {
  return {
    _id: row.id,
    userId: row.user_id ?? undefined,
    totalWallets: row.total_wallets,
    network: row.network,
    tokenAddress: row.token_address,
    tokenName: row.token_name,
    multisenderAddress: row.multisender_address,
    status: row.status,
    sentCount: row.sent_count,
    failedCount: row.failed_count,
    bnbSpent: Number(row.bnb_spent),
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    masterMnemonic: row.master_mnemonic ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function requirePool() {
  if (!postgresPool) {
    throw new Error("[PostgreSQL] DATABASE_URL is not configured");
  }

  return postgresPool;
}

export const Session = {
  async create(data: {
    userId: string;
    totalWallets: number;
    network: "bscMainnet" | "bscTestnet";
    tokenAddress: string;
    tokenName: string;
    multisenderAddress: string;
    status?: SessionStatus;
    sentCount?: number;
    failedCount?: number;
    bnbSpent?: number;
  }): Promise<ISession> {
    const pool = requirePool();
    const now = new Date();

    const result = await pool.query(
      `
        INSERT INTO distribution_sessions (
          id,
          user_id,
          total_wallets,
          network,
          token_address,
          token_name,
          multisender_address,
          status,
          sent_count,
          failed_count,
          bnb_spent,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
        RETURNING *
      `,
      [
        randomUUID(),
        data.userId,
        data.totalWallets,
        data.network,
        data.tokenAddress,
        data.tokenName,
        data.multisenderAddress,
        data.status ?? "idle",
        data.sentCount ?? 0,
        data.failedCount ?? 0,
        data.bnbSpent ?? 0,
        now,
      ]
    );

    return mapSession(result.rows[0]);
  },

  async findById(id: string): Promise<ISession | null> {
    const pool = requirePool();

    const result = await pool.query(
      `
        SELECT *
        FROM distribution_sessions
        WHERE id = $1
        LIMIT 1
      `,
      [id]
    );

    return result.rows[0] ? mapSession(result.rows[0]) : null;
  },

  async findByUser(userId: string, limit: number): Promise<ISession[]> {
    const pool = requirePool();

    const result = await pool.query(
      `
        SELECT *
        FROM distribution_sessions
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2
      `,
      [userId, limit]
    );

    return result.rows.map(mapSession);
  },

  /**
   * Partial update. Keys present with an `undefined` value are cleared (set to NULL).
   * Unknown keys are ignored.
   */
  async update(id: string, patch: SessionPatch): Promise<ISession | null> {
    const pool = requirePool();

    const sets: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(patch)) {
      const column = COLUMNS[key as keyof SessionPatch];
      if (!column) continue;

      values.push(value ?? null);
      sets.push(`${column} = $${values.length}`);
    }

    values.push(new Date());
    sets.push(`updated_at = $${values.length}`);

    values.push(id);

    const result = await pool.query(
      `
        UPDATE distribution_sessions
        SET ${sets.join(", ")}
        WHERE id = $${values.length}
        RETURNING *
      `,
      values
    );

    return result.rows[0] ? mapSession(result.rows[0]) : null;
  },

  async deleteById(id: string): Promise<void> {
    const pool = requirePool();

    await pool.query(
      `
        DELETE FROM distribution_sessions
        WHERE id = $1
      `,
      [id]
    );
  },
};
