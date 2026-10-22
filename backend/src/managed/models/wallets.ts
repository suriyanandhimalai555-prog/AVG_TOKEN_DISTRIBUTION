import { randomUUID, randomBytes } from "crypto";
import type { EncryptedSecret } from "../keyVault";
import { ManagedWallet, ManagedWalletStatus, Network, PoolStatus } from "../types";
import {
  CHUNK_SIZE,
  clampLimit,
  clampSkip,
  escapeLike,
  isoFromRow,
  requirePool,
  valuesList,
} from "./common";

/** Admin-only record: includes the view token. */
export interface ManagedWalletRecord extends ManagedWallet {
  viewToken: string;
}

/** Result of a view-token lookup: the wallet plus what the public view needs from its pool. */
export interface ManagedWalletByToken extends ManagedWalletRecord {
  network: Network;
  poolStatus: PoolStatus;
}

export interface NewManagedWallet {
  poolId: string;
  derivationIndex: number;
  address: string;
  label?: string | null;
  /** 64 hex chars. Generated when omitted. */
  viewToken?: string;
}

/** An IMPORTED wallet: its id is fixed up front because it is the AAD of its encrypted key. */
export interface NewImportedWallet {
  id: string;
  poolId: string;
  derivationIndex: number;
  address: string;
  label: string | null;
  key: EncryptedSecret;
}

/** AAD binding an imported key's ciphertext to its wallet row. */
export function importedKeyAad(walletId: string): string {
  return `managed-wallet:${walletId}`;
}

export interface ManagedWalletPatch {
  label?: string | null;
  holderName?: string | null;
  holderEmail?: string | null;
  holderUserId?: string | null;
  status?: ManagedWalletStatus;
}

export interface ListWalletsOptions {
  skip?: number;
  limit?: number;
  search?: string;
  status?: ManagedWalletStatus;
}

const COLUMNS: Record<keyof ManagedWalletPatch, string> = {
  label: "label",
  holderName: "holder_name",
  holderEmail: "holder_email",
  holderUserId: "holder_user_id",
  status: "status",
};

export function newViewToken(): string {
  return randomBytes(32).toString("hex");
}

function mapWallet(row: any): ManagedWallet {
  return {
    id: row.id,
    poolId: row.pool_id,
    derivationIndex: row.derivation_index,
    address: row.address,
    keySource: row.key_source === "IMPORTED" ? "IMPORTED" : "DERIVED",
    label: row.label ?? null,
    holderName: row.holder_name ?? null,
    holderEmail: row.holder_email ?? null,
    holderUserId: row.holder_user_id ?? null,
    status: row.status,
    createdAt: isoFromRow(row.created_at),
    updatedAt: isoFromRow(row.updated_at),
  };
}

function mapWalletRecord(row: any): ManagedWalletRecord {
  return { ...mapWallet(row), viewToken: row.view_token };
}

export const wallets = {
  /**
   * Inserts in chunks of 500. Returns the created rows in input order.
   * Duplicate (pool_id, derivation_index) or address raise: indexes come from
   * pools.reserveIndexes, so a conflict means a derivation bug, not a retry.
   */
  async insertMany(
    rows: NewManagedWallet[]
  ): Promise<Array<{ id: string; derivationIndex: number; address: string }>> {
    const pool = requirePool();
    const created: Array<{ id: string; derivationIndex: number; address: string }> = [];
    const now = new Date();

    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      const values = chunk.flatMap((w) => [
        randomUUID(),
        w.poolId,
        w.derivationIndex,
        w.address,
        w.label ?? null,
        w.viewToken ?? newViewToken(),
        now,
      ]);

      const result = await pool.query(
        `
          INSERT INTO managed_wallets (
            id,
            pool_id,
            derivation_index,
            address,
            label,
            view_token,
            created_at
          )
          SELECT v.id::uuid, v.pool_id::uuid, v.derivation_index::int, v.address,
                 v.label, v.view_token, v.created_at::timestamptz
          FROM (VALUES ${valuesList(chunk.length, 7)})
            AS v(id, pool_id, derivation_index, address, label, view_token, created_at)
          RETURNING id, derivation_index, address
        `,
        values
      );

      for (const row of result.rows) {
        created.push({
          id: row.id,
          derivationIndex: row.derivation_index,
          address: row.address,
        });
      }
    }

    return created;
  },

  /**
   * Inserts IMPORTED wallets with their encrypted keys in one transaction
   * (all or nothing). Indexes come from pools.reserveIndexes.
   */
  async insertImported(rows: NewImportedWallet[]): Promise<Array<{ id: string; derivationIndex: number; address: string }>> {
    const pool = requirePool();
    const client = await pool.connect();
    const created: Array<{ id: string; derivationIndex: number; address: string }> = [];
    const now = new Date();
    try {
      await client.query("BEGIN");
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE);
        const values = chunk.flatMap((w) => [
          w.id,
          w.poolId,
          w.derivationIndex,
          w.address,
          w.label,
          newViewToken(),
          now,
          w.key.ciphertext,
          w.key.iv,
          w.key.tag,
          w.key.keyVersion,
        ]);
        const result = await client.query(
          `
            INSERT INTO managed_wallets (
              id, pool_id, derivation_index, address, label, view_token, created_at,
              key_source, key_ciphertext, key_iv, key_tag, key_version
            )
            SELECT v.id::uuid, v.pool_id::uuid, v.derivation_index::int, v.address, v.label,
                   v.view_token, v.created_at::timestamptz,
                   'IMPORTED', v.key_ciphertext, v.key_iv, v.key_tag, v.key_version::int
            FROM (VALUES ${valuesList(chunk.length, 11)})
              AS v(id, pool_id, derivation_index, address, label, view_token, created_at,
                   key_ciphertext, key_iv, key_tag, key_version)
            RETURNING id, derivation_index, address
          `,
          values
        );
        for (const row of result.rows) {
          created.push({ id: row.id, derivationIndex: row.derivation_index, address: row.address });
        }
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    return created;
  },

  /** Encrypted key of an IMPORTED wallet; null for DERIVED or missing wallets. */
  async getImportedKey(walletId: string): Promise<EncryptedSecret | null> {
    const pool = requirePool();
    const result = await pool.query(
      `SELECT key_ciphertext, key_iv, key_tag, key_version FROM managed_wallets
        WHERE id = $1 AND key_source = 'IMPORTED'`,
      [walletId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return { ciphertext: row.key_ciphertext, iv: row.key_iv, tag: row.key_tag, keyVersion: row.key_version };
  },

  /** Which of these addresses already belong to any pool (case-insensitive). */
  async findPoolsByAddresses(addresses: string[]): Promise<Map<string, string>> {
    const pool = requirePool();
    const owners = new Map<string, string>();
    for (let i = 0; i < addresses.length; i += CHUNK_SIZE) {
      const chunk = addresses.slice(i, i + CHUNK_SIZE).map((a) => a.toLowerCase());
      const result = await pool.query(
        `SELECT lower(address) AS address, pool_id FROM managed_wallets WHERE lower(address) = ANY($1::text[])`,
        [chunk]
      );
      for (const row of result.rows) owners.set(row.address, row.pool_id);
    }
    return owners;
  },

  async findById(id: string): Promise<ManagedWalletRecord | null> {
    const pool = requirePool();

    const result = await pool.query(
      `
        SELECT *
        FROM managed_wallets
        WHERE id = $1
        LIMIT 1
      `,
      [id]
    );

    return result.rows[0] ? mapWalletRecord(result.rows[0]) : null;
  },

  async findByIds(ids: string[]): Promise<ManagedWalletRecord[]> {
    if (ids.length === 0) return [];
    const pool = requirePool();

    const result = await pool.query(
      `
        SELECT *
        FROM managed_wallets
        WHERE id = ANY($1::uuid[])
        ORDER BY derivation_index ASC
      `,
      [ids]
    );

    return result.rows.map(mapWalletRecord);
  },

  /** Case-insensitive address lookup (addresses are stored checksummed). */
  async findByAddress(address: string): Promise<ManagedWalletRecord | null> {
    const pool = requirePool();

    const result = await pool.query(
      `
        SELECT *
        FROM managed_wallets
        WHERE LOWER(address) = LOWER($1)
        LIMIT 1
      `,
      [address]
    );

    return result.rows[0] ? mapWalletRecord(result.rows[0]) : null;
  },

  /** Lookup for the public view: includes the pool's network and status so the route can 404 archived pools. */
  async findByViewToken(viewToken: string): Promise<ManagedWalletByToken | null> {
    const pool = requirePool();

    const result = await pool.query(
      `
        SELECT w.*, p.network AS pool_network, p.status AS pool_status
        FROM managed_wallets w
        JOIN managed_pools p ON p.id = w.pool_id
        WHERE w.view_token = $1
        LIMIT 1
      `,
      [viewToken]
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      ...mapWalletRecord(row),
      network: row.pool_network,
      poolStatus: row.pool_status,
    };
  },

  /**
   * Paginated listing without view tokens. `search` matches address prefix,
   * label, holder name and holder email, case-insensitively.
   */
  async listByPool(
    poolId: string,
    options: ListWalletsOptions = {}
  ): Promise<{ wallets: ManagedWallet[]; total: number }> {
    const pool = requirePool();

    const conditions = ["pool_id = $1"];
    const values: unknown[] = [poolId];

    if (options.status) {
      values.push(options.status);
      conditions.push(`status = $${values.length}`);
    }

    const search = options.search?.trim();
    if (search) {
      values.push(`${escapeLike(search)}%`);
      const prefix = values.length;
      values.push(`%${escapeLike(search)}%`);
      const contains = values.length;
      conditions.push(
        `(address ILIKE $${prefix} ESCAPE '\\'
          OR label ILIKE $${contains} ESCAPE '\\'
          OR holder_name ILIKE $${contains} ESCAPE '\\'
          OR holder_email ILIKE $${contains} ESCAPE '\\')`
      );
    }

    const where = `WHERE ${conditions.join(" AND ")}`;

    const countResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM managed_wallets
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
        SELECT *
        FROM managed_wallets
        ${where}
        ORDER BY derivation_index ASC
        LIMIT $${limitParam} OFFSET $${skipParam}
      `,
      values
    );

    return { wallets: result.rows.map(mapWallet), total: countResult.rows[0].total };
  },

  async countByPool(poolId: string): Promise<number> {
    const pool = requirePool();

    const result = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM managed_wallets
        WHERE pool_id = $1
      `,
      [poolId]
    );

    return result.rows[0].total;
  },

  /**
   * Partial update. Keys present with an `undefined` value are cleared (set to NULL).
   * Unknown keys are ignored.
   */
  async update(id: string, patch: ManagedWalletPatch): Promise<ManagedWalletRecord | null> {
    const pool = requirePool();

    const sets: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(patch)) {
      const column = COLUMNS[key as keyof ManagedWalletPatch];
      if (!column) continue;

      values.push(value ?? null);
      sets.push(`${column} = $${values.length}`);
    }

    values.push(new Date());
    sets.push(`updated_at = $${values.length}`);

    values.push(id);

    const result = await pool.query(
      `
        UPDATE managed_wallets
        SET ${sets.join(", ")}
        WHERE id = $${values.length}
        RETURNING *
      `,
      values
    );

    return result.rows[0] ? mapWalletRecord(result.rows[0]) : null;
  },

  /** Replaces the view token with a fresh 32-byte hex token and returns it. */
  async rotateViewToken(id: string): Promise<{ viewToken: string } | null> {
    const pool = requirePool();
    const viewToken = newViewToken();

    const result = await pool.query(
      `
        UPDATE managed_wallets
        SET view_token = $2,
            updated_at = NOW()
        WHERE id = $1
        RETURNING view_token
      `,
      [id, viewToken]
    );

    return result.rows[0] ? { viewToken: result.rows[0].view_token } : null;
  },

  /** ACTIVE wallets of ACTIVE pools on a network, for the deposit indexer. */
  async listActiveAddressesByNetwork(
    network: Network
  ): Promise<Array<{ id: string; poolId: string; address: string }>> {
    const pool = requirePool();

    const result = await pool.query(
      `
        SELECT w.id, w.pool_id, w.address
        FROM managed_wallets w
        JOIN managed_pools p ON p.id = w.pool_id
        WHERE p.network = $1
          AND p.status = 'ACTIVE'
          AND w.status = 'ACTIVE'
        ORDER BY w.pool_id, w.derivation_index
      `,
      [network]
    );

    return result.rows.map((row) => ({
      id: row.id,
      poolId: row.pool_id,
      address: row.address,
    }));
  },
};
