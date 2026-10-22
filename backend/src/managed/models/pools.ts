import { Network, Pool, PoolSeedType, PoolStatus } from "../types";
import { intFromRow, isoFromRow, nullableIsoFromRow, requirePool } from "./common";

/**
 * A pool as stored, without the encrypted mnemonic. Use `pools.getSecret`
 * to read the ciphertext so it never travels with ordinary pool records.
 */
export interface PoolRecord extends Pool {
  ownerUserId: string;
}

/** Encrypted mnemonic material, shaped for keyVault.decryptSecret. */
export interface PoolSecret {
  ciphertext: string;
  iv: string;
  tag: string;
  keyVersion: number;
}

export interface CreatePoolInput {
  /** Pre-generated UUID: it is the AAD of the encrypted mnemonic. */
  id: string;
  ownerUserId: string;
  name: string;
  network: Network;
  masterAddress: string;
  mnemonicCiphertext: string;
  mnemonicIv: string;
  mnemonicTag: string;
  keyVersion?: number;
  accountPath?: string;
  /** What the encrypted secret is; defaults to MNEMONIC. */
  seedType?: PoolSeedType;
}

export interface PoolPatch {
  name?: string;
  status?: PoolStatus;
  mnemonicRevealedAt?: Date;
}

export type PoolReserveCode = "POOL_NOT_FOUND" | "POOL_ARCHIVED" | "POOL_LIMIT_REACHED";

export class PoolReserveError extends Error {
  readonly code: PoolReserveCode;

  constructor(code: PoolReserveCode, message: string) {
    super(message);
    this.name = "PoolReserveError";
    this.code = code;
  }
}

const DEFAULT_MAX_WALLETS_PER_POOL = 10_000;

export function maxWalletsPerPool(): number {
  const raw = process.env.MANAGED_MAX_WALLETS_PER_POOL;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_WALLETS_PER_POOL;
}

const COLUMNS: Record<keyof PoolPatch, string> = {
  name: "name",
  status: "status",
  mnemonicRevealedAt: "mnemonic_revealed_at",
};

/** Columns returned for every pool record; the mnemonic columns are never selected here. */
const POOL_SELECT = `
  p.id,
  p.owner_user_id,
  p.name,
  p.network,
  p.account_path,
  p.master_address,
  p.seed_type,
  p.key_version,
  p.next_index,
  p.status,
  p.mnemonic_revealed_at,
  p.created_at,
  p.updated_at,
  (SELECT COUNT(*)::int FROM managed_wallets w WHERE w.pool_id = p.id) AS wallet_count
`;

function mapPool(row: any): PoolRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    network: row.network,
    accountPath: row.account_path,
    masterAddress: row.master_address,
    seedType: row.seed_type === "PRIVATE_KEY" ? "PRIVATE_KEY" : "MNEMONIC",
    keyVersion: row.key_version,
    nextIndex: row.next_index,
    walletCount: intFromRow(row.wallet_count) ?? 0,
    status: row.status,
    mnemonicRevealedAt: nullableIsoFromRow(row.mnemonic_revealed_at),
    createdAt: isoFromRow(row.created_at),
    updatedAt: isoFromRow(row.updated_at),
  };
}

export const pools = {
  async create(data: CreatePoolInput): Promise<PoolRecord> {
    const pool = requirePool();
    const now = new Date();

    const inserted = await pool.query(
      `
        INSERT INTO managed_pools (
          id,
          owner_user_id,
          name,
          network,
          account_path,
          master_address,
          mnemonic_ciphertext,
          mnemonic_iv,
          mnemonic_tag,
          key_version,
          seed_type,
          next_index,
          status,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $12, 1, 'ACTIVE', $11, $11)
        RETURNING id
      `,
      [
        data.id,
        data.ownerUserId,
        data.name,
        data.network,
        data.accountPath ?? "m/44'/60'/0'/0",
        data.masterAddress,
        data.mnemonicCiphertext,
        data.mnemonicIv,
        data.mnemonicTag,
        data.keyVersion ?? 1,
        now,
        data.seedType ?? "MNEMONIC",
      ]
    );

    const record = await pools.findById(inserted.rows[0].id);
    if (!record) {
      throw new Error("managed pool vanished after insert");
    }
    return record;
  },

  async findById(id: string): Promise<PoolRecord | null> {
    const pool = requirePool();

    const result = await pool.query(
      `
        SELECT ${POOL_SELECT}
        FROM managed_pools p
        WHERE p.id = $1
        LIMIT 1
      `,
      [id]
    );

    return result.rows[0] ? mapPool(result.rows[0]) : null;
  },

  async listByOwner(ownerUserId: string): Promise<PoolRecord[]> {
    const pool = requirePool();

    const result = await pool.query(
      `
        SELECT ${POOL_SELECT}
        FROM managed_pools p
        WHERE p.owner_user_id = $1
        ORDER BY p.created_at DESC
      `,
      [ownerUserId]
    );

    return result.rows.map(mapPool);
  },

  /** Pools are admin-global in v1 (ARCHITECTURE.md §5.6). */
  /** Any pool (any status) whose master is this address, case-insensitive. */
  async findByMasterAddress(masterAddress: string): Promise<PoolRecord | null> {
    const pool = requirePool();
    const result = await pool.query(
      `SELECT ${POOL_SELECT} FROM managed_pools p WHERE lower(p.master_address) = lower($1) ORDER BY p.created_at LIMIT 1`,
      [masterAddress]
    );
    return result.rows[0] ? mapPool(result.rows[0]) : null;
  },

  async listAll(filter: { status?: PoolStatus; network?: Network } = {}): Promise<PoolRecord[]> {
    const pool = requirePool();

    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filter.status) {
      values.push(filter.status);
      conditions.push(`p.status = $${values.length}`);
    }
    if (filter.network) {
      values.push(filter.network);
      conditions.push(`p.network = $${values.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await pool.query(
      `
        SELECT ${POOL_SELECT}
        FROM managed_pools p
        ${where}
        ORDER BY p.created_at DESC
      `,
      values
    );

    return result.rows.map(mapPool);
  },

  /** Encrypted mnemonic material for keyVault.decryptSecret (AAD = pool id). */
  async getSecret(id: string): Promise<PoolSecret | null> {
    const pool = requirePool();

    const result = await pool.query(
      `
        SELECT mnemonic_ciphertext, mnemonic_iv, mnemonic_tag, key_version
        FROM managed_pools
        WHERE id = $1
        LIMIT 1
      `,
      [id]
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      ciphertext: row.mnemonic_ciphertext,
      iv: row.mnemonic_iv,
      tag: row.mnemonic_tag,
      keyVersion: row.key_version,
    };
  },

  /**
   * Partial update. Keys present with an `undefined` value are cleared (set to NULL).
   * Unknown keys are ignored.
   */
  async update(id: string, patch: PoolPatch): Promise<PoolRecord | null> {
    const pool = requirePool();

    const sets: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(patch)) {
      const column = COLUMNS[key as keyof PoolPatch];
      if (!column) continue;

      values.push(value ?? null);
      sets.push(`${column} = $${values.length}`);
    }

    values.push(new Date());
    sets.push(`updated_at = $${values.length}`);

    values.push(id);

    await pool.query(
      `
        UPDATE managed_pools
        SET ${sets.join(", ")}
        WHERE id = $${values.length}
      `,
      values
    );

    return pools.findById(id);
  },

  async archive(id: string): Promise<PoolRecord | null> {
    return pools.update(id, { status: "ARCHIVED" });
  },

  async markRevealed(id: string): Promise<PoolRecord | null> {
    return pools.update(id, { mnemonicRevealedAt: new Date() });
  },

  /**
   * Atomically reserves `count` derivation indexes on an ACTIVE pool.
   * Returns the half-open range [from, to): derive indexes i with from <= i < to.
   * `to` equals the pool's new next_index.
   *
   * Rejects with PoolReserveError when the pool is missing, archived, or the
   * reservation would exceed MANAGED_MAX_WALLETS_PER_POOL (default 10000).
   */
  async reserveIndexes(poolId: string, count: number): Promise<{ from: number; to: number }> {
    if (!Number.isInteger(count) || count < 1) {
      throw new Error(`reserveIndexes: count must be a positive integer, got ${count}`);
    }

    const pool = requirePool();
    const max = maxWalletsPerPool();

    const result = await pool.query(
      `
        UPDATE managed_pools
        SET next_index = next_index + $2,
            updated_at = NOW()
        WHERE id = $1
          AND status = 'ACTIVE'
          AND next_index + $2 - 1 <= $3
        RETURNING next_index
      `,
      [poolId, count, max]
    );

    const row = result.rows[0];
    if (row) {
      const to: number = row.next_index;
      return { from: to - count, to };
    }

    const existing = await pools.findById(poolId);
    if (!existing) {
      throw new PoolReserveError("POOL_NOT_FOUND", "Pool not found");
    }
    if (existing.status !== "ACTIVE") {
      throw new PoolReserveError("POOL_ARCHIVED", "Pool is archived");
    }
    throw new PoolReserveError(
      "POOL_LIMIT_REACHED",
      `Pool can hold at most ${max} wallets (${existing.nextIndex - 1} used)`
    );
  },
};
