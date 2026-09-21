import { randomUUID } from "crypto";
import { postgresPool } from "../lib/postgres";

export interface IUser {
  _id: string;
  googleId?: string;
  email: string;
  name: string;
  avatar?: string;
  passwordHash?: string;
  passwordSalt?: string;
  role: "USER" | "ADMIN";
  createdAt: Date;
  updatedAt: Date;
}

function mapUser(row: any): IUser {
  return {
    _id: row.id,
    googleId: row.google_id ?? undefined,
    email: row.email,
    name: row.name,
    avatar: row.avatar ?? undefined,
    passwordHash: row.password_hash ?? undefined,
    passwordSalt: row.password_salt ?? undefined,
    role: row.role,
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

export const User = {
  async findOne(query: {
    email?: string;
    googleId?: string;
  }): Promise<IUser | null> {
    const pool = requirePool();

    const conditions: string[] = [];
    const values: unknown[] = [];

    if (query.email !== undefined) {
      values.push(query.email);
      conditions.push(`email = $${values.length}`);
    }

    if (query.googleId !== undefined) {
      values.push(query.googleId);
      conditions.push(`google_id = $${values.length}`);
    }

    if (conditions.length === 0) {
      throw new Error("[PostgreSQL] User.findOne requires a filter");
    }

    const result = await pool.query(
      `
        SELECT *
        FROM users
        WHERE ${conditions.join(" AND ")}
        LIMIT 1
      `,
      values
    );

    return result.rows[0] ? mapUser(result.rows[0]) : null;
  },

  async findById(id: string): Promise<IUser | null> {
    const pool = requirePool();

    const result = await pool.query(
      `
        SELECT *
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [id]
    );

    return result.rows[0] ? mapUser(result.rows[0]) : null;
  },

  async find(options: {
    email?: { $regex: string; $options?: string };
  } = {}): Promise<IUser[]> {
    const pool = requirePool();

    const values: unknown[] = [];
    let where = "";

    if (options.email?.$regex) {
      values.push(`%${options.email.$regex}%`);
      where = `WHERE email ILIKE $${values.length}`;
    }

    const result = await pool.query(
      `
        SELECT *
        FROM users
        ${where}
        ORDER BY created_at DESC
      `,
      values
    );

    return result.rows.map(mapUser);
  },

  async countDocuments(options: {
    email?: { $regex: string; $options?: string };
  } = {}): Promise<number> {
    const pool = requirePool();

    const values: unknown[] = [];
    let where = "";

    if (options.email?.$regex) {
      values.push(`%${options.email.$regex}%`);
      where = `WHERE email ILIKE $${values.length}`;
    }

    const result = await pool.query(
      `
        SELECT COUNT(*)::int AS count
        FROM users
        ${where}
      `,
      values
    );

    return result.rows[0].count;
  },

  async create(data: {
    googleId?: string;
    email: string;
    name: string;
    avatar?: string;
    passwordHash?: string;
    passwordSalt?: string;
    role?: "USER" | "ADMIN";
  }): Promise<IUser> {
    const pool = requirePool();

    const id = randomUUID();
    const now = new Date();
    const role = data.role ?? "USER";

    const result = await pool.query(
      `
        INSERT INTO users (
          id,
          google_id,
          email,
          name,
          avatar,
          password_hash,
          password_salt,
          role,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
        RETURNING *
      `,
      [
        id,
        data.googleId ?? null,
        data.email,
        data.name,
        data.avatar ?? null,
        data.passwordHash ?? null,
        data.passwordSalt ?? null,
        role,
        now,
      ]
    );

    return mapUser(result.rows[0]);
  },

  async findByIdAndUpdate(
    id: string,
    update: {
      role?: "USER" | "ADMIN";
    }
  ): Promise<IUser | null> {
    const pool = requirePool();

    const fields: string[] = [];
    const values: unknown[] = [];

    if (update.role !== undefined) {
      values.push(update.role);
      fields.push(`role = $${values.length}`);
    }

    if (fields.length === 0) {
      return this.findById(id);
    }

    values.push(new Date());
    fields.push(`updated_at = $${values.length}`);

    values.push(id);

    const result = await pool.query(
      `
        UPDATE users
        SET ${fields.join(", ")}
        WHERE id = $${values.length}
        RETURNING *
      `,
      values
    );

    return result.rows[0] ? mapUser(result.rows[0]) : null;
  },
};
