import { randomUUID } from "crypto";
import { postgresPool } from "../lib/postgres";

export interface ISubscription {
  _id: string;
  userId: string;
  productLine: "TOKEN_HOLDER" | "DEX_AUTOMATION";
  planKey: string;
  status: "ACTIVE" | "EXPIRED" | "CANCELLED" | "PENDING";
  walletLimit: number;
  startedAt: Date;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

function mapSubscription(row: any): ISubscription {
  return {
    _id: row.id,
    userId: row.user_id,
    productLine: row.product_line,
    planKey: row.plan_key,
    status: row.status,
    walletLimit: row.wallet_limit,
    startedAt: row.started_at,
    expiresAt: row.expires_at,
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

export const Subscription = {
  async findOne(query: {
    userId?: string;
    status?: "ACTIVE" | "EXPIRED" | "CANCELLED" | "PENDING";
  }) {
    const pool = requirePool();

    const conditions: string[] = [];
    const values: unknown[] = [];

    if (query.userId) {
      values.push(query.userId);
      conditions.push(`user_id = $${values.length}`);
    }

    if (query.status) {
      values.push(query.status);
      conditions.push(`status = $${values.length}`);
    }

    if (conditions.length === 0) {
      throw new Error("[PostgreSQL] Subscription.findOne requires a filter");
    }

    const result = await pool.query(
      `
        SELECT *
        FROM subscriptions
        WHERE ${conditions.join(" AND ")}
        LIMIT 1
      `,
      values
    );

    return result.rows[0]
      ? mapSubscription(result.rows[0])
      : null;
  },

  async findOneAndUpdate(
    query: { userId?: string },
    update: {
      userId?: string;
      productLine?: "TOKEN_HOLDER" | "DEX_AUTOMATION";
      planKey?: string;
      status?: "ACTIVE" | "EXPIRED" | "CANCELLED" | "PENDING";
      walletLimit?: number;
      startedAt?: Date;
      expiresAt?: Date;
    }
  ) {
    const pool = requirePool();

    if (!query.userId) {
      throw new Error(
        "[PostgreSQL] Subscription.findOneAndUpdate requires userId"
      );
    }

    const existing = await pool.query(
      `
        SELECT *
        FROM subscriptions
        WHERE user_id = $1
        LIMIT 1
      `,
      [query.userId]
    );

    if (existing.rows[0]) {
      const current = mapSubscription(existing.rows[0]);

      const productLine =
        update.productLine ?? current.productLine;
      const planKey =
        update.planKey ?? current.planKey;
      const status =
        update.status ?? current.status;
      const walletLimit =
        update.walletLimit ?? current.walletLimit;
      const startedAt =
        update.startedAt ?? current.startedAt;
      const expiresAt =
        update.expiresAt ?? current.expiresAt;

      const result = await pool.query(
        `
          UPDATE subscriptions
          SET
            product_line = $1,
            plan_key = $2,
            status = $3,
            wallet_limit = $4,
            started_at = $5,
            expires_at = $6,
            updated_at = NOW()
          WHERE user_id = $7
          RETURNING *
        `,
        [
          productLine,
          planKey,
          status,
          walletLimit,
          startedAt,
          expiresAt,
          query.userId,
        ]
      );

      return mapSubscription(result.rows[0]);
    }

    if (
      !update.userId ||
      !update.productLine ||
      !update.planKey ||
      update.walletLimit === undefined ||
      !update.expiresAt
    ) {
      throw new Error(
        "[PostgreSQL] Cannot create subscription: required fields are missing"
      );
    }

    const id = randomUUID();
    const now = new Date();
    const startedAt = update.startedAt ?? now;
    const status = update.status ?? "PENDING";

    const result = await pool.query(
      `
        INSERT INTO subscriptions (
          id,
          user_id,
          product_line,
          plan_key,
          status,
          wallet_limit,
          started_at,
          expires_at,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
        RETURNING *
      `,
      [
        id,
        update.userId,
        update.productLine,
        update.planKey,
        status,
        update.walletLimit,
        startedAt,
        update.expiresAt,
        now,
      ]
    );

    return mapSubscription(result.rows[0]);
  },

  async find(query: {
    userId?: string | { $in: string[] };
  } = {}) {
    const pool = requirePool();

    if (query.userId && typeof query.userId === "object") {
      const ids = query.userId.$in;

      if (ids.length === 0) {
        return [];
      }

      const placeholders = ids.map(
        (_, index) => `$${index + 1}`
      );

      const result = await pool.query(
        `
          SELECT *
          FROM subscriptions
          WHERE user_id IN (${placeholders.join(", ")})
          ORDER BY created_at DESC
        `,
        ids
      );

      return result.rows.map(mapSubscription);
    }

    if (query.userId) {
      const result = await pool.query(
        `
          SELECT *
          FROM subscriptions
          WHERE user_id = $1
          ORDER BY created_at DESC
        `,
        [query.userId]
      );

      return result.rows.map(mapSubscription);
    }

    const result = await pool.query(
      `
        SELECT *
        FROM subscriptions
        ORDER BY created_at DESC
      `
    );

    return result.rows.map(mapSubscription);
  },

  async countDocuments(query: {
    status?: "ACTIVE" | "EXPIRED" | "CANCELLED" | "PENDING";
    productLine?: "TOKEN_HOLDER" | "DEX_AUTOMATION";
  } = {}) {
    const pool = requirePool();

    const conditions: string[] = [];
    const values: unknown[] = [];

    if (query.status) {
      values.push(query.status);
      conditions.push(`status = $${values.length}`);
    }

    if (query.productLine) {
      values.push(query.productLine);
      conditions.push(`product_line = $${values.length}`);
    }

    const where =
      conditions.length > 0
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

    const result = await pool.query(
      `
        SELECT COUNT(*)::int AS count
        FROM subscriptions
        ${where}
      `,
      values
    );

    return result.rows[0].count;
  },
};
