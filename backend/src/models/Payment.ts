import { randomUUID } from "crypto";
import { postgresPool } from "../lib/postgres";

export interface IPayment {
  _id: string;
  userId: string;
  subscriptionId?: string;
  coinbaseChargeId: string;
  coinbaseChargeCode: string;
  coinbaseHostedUrl: string;
  coinbaseInternalOrderId: string;
  coinbaseTxHash?: string;
  coinbaseCryptoType?: string;
  amount: number;
  status: "NEW" | "PENDING" | "CONFIRMED" | "FAILED" | "EXPIRED" | "CANCELLED";
  productLine: string;
  planKey: string;
  paidAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

function mapPayment(row: any): IPayment {
  return {
    _id: row.id,
    userId: row.user_id,
    subscriptionId: row.subscription_id ?? undefined,
    coinbaseChargeId: row.coinbase_charge_id,
    coinbaseChargeCode: row.coinbase_charge_code,
    coinbaseHostedUrl: row.coinbase_hosted_url,
    coinbaseInternalOrderId: row.coinbase_internal_order_id,
    coinbaseTxHash: row.coinbase_tx_hash ?? undefined,
    coinbaseCryptoType: row.coinbase_crypto_type ?? undefined,
    amount: Number(row.amount),
    status: row.status,
    productLine: row.product_line,
    planKey: row.plan_key,
    paidAt: row.paid_at ?? undefined,
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

export const Payment = {
  async findOne(query: {
    coinbaseChargeId?: string;
    coinbaseInternalOrderId?: string;
    userId?: string;
    id?: string;
  }): Promise<IPayment | null> {
    const pool = requirePool();

    const conditions: string[] = [];
    const values: unknown[] = [];

    if (query.coinbaseChargeId !== undefined) {
      values.push(query.coinbaseChargeId);
      conditions.push(`coinbase_charge_id = $${values.length}`);
    }

    if (query.coinbaseInternalOrderId !== undefined) {
      values.push(query.coinbaseInternalOrderId);
      conditions.push(`coinbase_internal_order_id = $${values.length}`);
    }

    if (query.userId !== undefined) {
      values.push(query.userId);
      conditions.push(`user_id = $${values.length}`);
    }

    if (query.id !== undefined) {
      values.push(query.id);
      conditions.push(`id = $${values.length}`);
    }

    if (conditions.length === 0) {
      throw new Error("[PostgreSQL] Payment.findOne requires a filter");
    }

    const result = await pool.query(
      `SELECT * FROM payments
       WHERE ${conditions.join(" AND ")}
       LIMIT 1`,
      values
    );

    return result.rows[0] ? mapPayment(result.rows[0]) : null;
  },

  async create(data: {
    userId: string;
    subscriptionId?: string;
    coinbaseChargeId: string;
    coinbaseChargeCode: string;
    coinbaseHostedUrl: string;
    coinbaseInternalOrderId: string;
    coinbaseTxHash?: string;
    coinbaseCryptoType?: string;
    amount: number;
    status?: "NEW" | "PENDING" | "CONFIRMED" | "FAILED" | "EXPIRED" | "CANCELLED";
    productLine: string;
    planKey: string;
    paidAt?: Date;
  }): Promise<IPayment> {
    const pool = requirePool();

    const id = randomUUID();
    const now = new Date();

    const result = await pool.query(
      `INSERT INTO payments (
        id,
        user_id,
        subscription_id,
        coinbase_charge_id,
        coinbase_charge_code,
        coinbase_hosted_url,
        coinbase_internal_order_id,
        coinbase_tx_hash,
        coinbase_crypto_type,
        amount,
        status,
        product_line,
        plan_key,
        paid_at,
        created_at,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, $15, $15
      )
      RETURNING *`,
      [
        id,
        data.userId,
        data.subscriptionId ?? null,
        data.coinbaseChargeId,
        data.coinbaseChargeCode,
        data.coinbaseHostedUrl,
        data.coinbaseInternalOrderId,
        data.coinbaseTxHash ?? null,
        data.coinbaseCryptoType ?? null,
        data.amount,
        data.status ?? "NEW",
        data.productLine,
        data.planKey,
        data.paidAt ?? null,
        now,
      ]
    );

    return mapPayment(result.rows[0]);
  },

  async find(
    query: {
      userId?: string;
      status?: string;
      coinbaseInternalOrderId?: string;
    } = {},
    options: {
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<IPayment[]> {
    const pool = requirePool();
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (query.userId !== undefined) {
      values.push(query.userId);
      conditions.push(`user_id = $${values.length}`);
    }

    if (query.status !== undefined) {
      values.push(query.status);
      conditions.push(`status = $${values.length}`);
    }

    if (query.coinbaseInternalOrderId !== undefined) {
      values.push(query.coinbaseInternalOrderId);
      conditions.push(`coinbase_internal_order_id = $${values.length}`);
    }

    const where = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;

    values.push(limit);
    const limitParam = `$${values.length}`;

    values.push(offset);
    const offsetParam = `$${values.length}`;

    const result = await pool.query(
      `SELECT * FROM payments
       ${where}
       ORDER BY created_at DESC
       LIMIT ${limitParam}
       OFFSET ${offsetParam}`,
      values
    );

    return result.rows.map(mapPayment);
  },

  /** Admin listing: like find(), with userId replaced by the user's { _id, email, name }. */
  async findWithUsers(
    query: { status?: string } = {},
    options: { limit?: number; offset?: number } = {}
  ): Promise<
    Array<
      Omit<IPayment, "userId"> & {
        userId: { _id: string; email: string; name: string } | null;
      }
    >
  > {
    const pool = requirePool();
    const values: unknown[] = [];
    let where = "";

    if (query.status !== undefined) {
      values.push(query.status);
      where = `WHERE p.status = $${values.length}`;
    }

    values.push(options.limit ?? 100);
    const limitParam = `$${values.length}`;

    values.push(options.offset ?? 0);
    const offsetParam = `$${values.length}`;

    const result = await pool.query(
      `SELECT p.*, u.email AS user_email, u.name AS user_name
       FROM payments p
       LEFT JOIN users u ON u.id = p.user_id
       ${where}
       ORDER BY p.created_at DESC
       LIMIT ${limitParam}
       OFFSET ${offsetParam}`,
      values
    );

    return result.rows.map((row) => ({
      ...mapPayment(row),
      userId:
        row.user_email != null
          ? { _id: row.user_id, email: row.user_email, name: row.user_name }
          : null,
    }));
  },

  async sumConfirmedRevenue(): Promise<number> {
    const pool = requirePool();

    const result = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS revenue
       FROM payments
       WHERE status = 'CONFIRMED'`
    );

    return Number(result.rows[0].revenue);
  },

  async countDocuments(
    query: {
      userId?: string;
      status?: string;
      createdAtGte?: Date;
    } = {}
  ): Promise<number> {
    const pool = requirePool();
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (query.userId !== undefined) {
      values.push(query.userId);
      conditions.push(`user_id = $${values.length}`);
    }

    if (query.status !== undefined) {
      values.push(query.status);
      conditions.push(`status = $${values.length}`);
    }

    if (query.createdAtGte !== undefined) {
      values.push(query.createdAtGte);
      conditions.push(`created_at >= $${values.length}`);
    }

    const where = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const result = await pool.query(
      `SELECT COUNT(*)::int AS count FROM payments ${where}`,
      values
    );

    return result.rows[0].count;
  },
  async update(
    id: string,
    data: Partial<{
      subscriptionId: string;
      coinbaseTxHash: string;
      coinbaseCryptoType: string;
      status: "NEW" | "PENDING" | "CONFIRMED" | "FAILED" | "EXPIRED" | "CANCELLED";
      paidAt: Date;
    }>
  ): Promise<IPayment | null> {
    const pool = requirePool();

    const fields: string[] = [];
    const values: unknown[] = [];

    if (data.subscriptionId !== undefined) {
      values.push(data.subscriptionId);
      fields.push(`subscription_id = $${values.length}`);
    }

    if (data.coinbaseTxHash !== undefined) {
      values.push(data.coinbaseTxHash);
      fields.push(`coinbase_tx_hash = $${values.length}`);
    }

    if (data.coinbaseCryptoType !== undefined) {
      values.push(data.coinbaseCryptoType);
      fields.push(`coinbase_crypto_type = $${values.length}`);
    }

    if (data.status !== undefined) {
      values.push(data.status);
      fields.push(`status = $${values.length}`);
    }

    if (data.paidAt !== undefined) {
      values.push(data.paidAt);
      fields.push(`paid_at = $${values.length}`);
    }

    values.push(new Date());
    fields.push(`updated_at = $${values.length}`);

    values.push(id);

    const result = await pool.query(
      `UPDATE payments
       SET ${fields.join(", ")}
       WHERE id = $${values.length}
       RETURNING *`,
      values
    );

    return result.rows[0] ? mapPayment(result.rows[0]) : null;
  },
};
