import { randomUUID } from "crypto";
import { ManagedAudit, ManagedAuditAction } from "../types";
import { clampLimit, clampSkip, isoFromRow, requirePool } from "./common";

export interface NewManagedAudit {
  userId: string;
  poolId?: string | null;
  walletId?: string | null;
  action: ManagedAuditAction;
  details?: Record<string, unknown>;
}

function mapAudit(row: any): ManagedAudit {
  return {
    id: row.id,
    userId: row.user_id,
    poolId: row.pool_id ?? null,
    walletId: row.wallet_id ?? null,
    action: row.action,
    details: row.details ?? {},
    createdAt: isoFromRow(row.created_at),
  };
}

export const audits = {
  async create(data: NewManagedAudit): Promise<ManagedAudit> {
    const pool = requirePool();

    const result = await pool.query(
      `
        INSERT INTO managed_audits (
          id,
          user_id,
          pool_id,
          wallet_id,
          action,
          details,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        RETURNING *
      `,
      [
        randomUUID(),
        data.userId,
        data.poolId ?? null,
        data.walletId ?? null,
        data.action,
        JSON.stringify(data.details ?? {}),
      ]
    );

    return mapAudit(result.rows[0]);
  },

  async listByPool(
    poolId: string,
    options: { skip?: number; limit?: number } = {}
  ): Promise<ManagedAudit[]> {
    const pool = requirePool();

    const result = await pool.query(
      `
        SELECT *
        FROM managed_audits
        WHERE pool_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
      `,
      [poolId, clampLimit(options.limit, 100), clampSkip(options.skip)]
    );

    return result.rows.map(mapAudit);
  },

  async listByWallet(walletId: string, limit = 100): Promise<ManagedAudit[]> {
    const pool = requirePool();

    const result = await pool.query(
      `
        SELECT *
        FROM managed_audits
        WHERE wallet_id = $1
        ORDER BY created_at DESC
        LIMIT $2
      `,
      [walletId, clampLimit(limit, 100)]
    );

    return result.rows.map(mapAudit);
  },
};
