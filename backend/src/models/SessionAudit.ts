import { randomUUID } from "crypto";
import { postgresPool } from "../lib/postgres";

export interface ISessionAudit {
  _id: string;
  userId: string;
  sessionId: string;
  action: string;
  message?: string;
  details?: Record<string, unknown>;
  createdAt: Date;
}

function mapSessionAudit(row: any): ISessionAudit {
  return {
    _id: row.id,
    userId: row.user_id,
    sessionId: row.session_id,
    action: row.action,
    message: row.message ?? undefined,
    details: row.details ?? undefined,
    createdAt: row.created_at,
  };
}

function requirePool() {
  if (!postgresPool) {
    throw new Error("[PostgreSQL] DATABASE_URL is not configured");
  }

  return postgresPool;
}

export const SessionAudit = {
  async create(data: {
    userId: string;
    sessionId: string;
    action: string;
    message?: string;
    details?: Record<string, unknown>;
  }) {
    const pool = requirePool();

    const id = randomUUID();
    const now = new Date();

    const result = await pool.query(
      `
        INSERT INTO session_audits (
          id,
          user_id,
          session_id,
          action,
          message,
          details,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `,
      [
        id,
        data.userId,
        data.sessionId,
        data.action,
        data.message ?? null,
        data.details ?? {},
        now,
      ]
    );

    return mapSessionAudit(result.rows[0]);
  },

  async find(query: {
    userId?: string;
    sessionId?: string;
  } = {}) {
    const pool = requirePool();

    const conditions: string[] = [];
    const values: unknown[] = [];

    if (query.userId) {
      values.push(query.userId);
      conditions.push(`user_id = $${values.length}`);
    }

    if (query.sessionId) {
      values.push(query.sessionId);
      conditions.push(`session_id = $${values.length}`);
    }

    const where =
      conditions.length > 0
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

    const result = await pool.query(
      `
        SELECT *
        FROM session_audits
        ${where}
        ORDER BY created_at DESC
      `,
      values
    );

    return result.rows.map(mapSessionAudit);
  },
};
