/**
 * Monitored addresses (internal tool).
 * Admin manually enters a name label, wallet address, and private key for
 * balance/monitoring. Stored plaintext per owner choice — wallet connect
 * (MetaMask/Trust/Phantom) only ever reveals an address, never a private key,
 * so this field cannot be auto-filled.
 */
import { postgresPool } from "../../lib/postgres";
import { isoFromRow } from "./common";

export interface MonitoredAddress {
  id: string;
  ownerUserId: string;
  name: string;
  address: string;
  privateKey: string; // plaintext per owner choice
  createdAt: string;
  updatedAt: string;
}

export interface CreateMonitoredAddressInput {
  ownerUserId: string;
  name: string;
  address: string;
  privateKey: string;
}

export interface UpdateMonitoredAddressInput {
  name?: string;
  address?: string;
  privateKey?: string;
}

const MONITORED_SELECT = `
  id,
  owner_user_id,
  name,
  address,
  private_key,
  created_at,
  updated_at
`;

function mapRow(row: any): MonitoredAddress {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    address: row.address,
    privateKey: row.private_key,
    createdAt: isoFromRow(row.created_at),
    updatedAt: isoFromRow(row.updated_at),
  };
}

export const monitoredAddresses = {
  async create(data: CreateMonitoredAddressInput): Promise<MonitoredAddress> {
    const pool = postgresPool;
    if (!pool) throw new Error("[PostgreSQL] DATABASE_URL is not configured");

    const result = await pool.query(
      `
        INSERT INTO managed_monitored_addresses (owner_user_id, name, address, private_key)
        VALUES ($1, $2, $3, $4)
        RETURNING ${MONITORED_SELECT}
      `,
      [data.ownerUserId, data.name, data.address, data.privateKey]
    );
    return mapRow(result.rows[0]);
  },

  async listByOwner(ownerUserId: string): Promise<MonitoredAddress[]> {
    const pool = postgresPool;
    if (!pool) throw new Error("[PostgreSQL] DATABASE_URL is not configured");

    const result = await pool.query(
      `
        SELECT ${MONITORED_SELECT}
        FROM managed_monitored_addresses
        WHERE owner_user_id = $1
        ORDER BY created_at DESC
      `,
      [ownerUserId]
    );
    return result.rows.map(mapRow);
  },

  async findById(id: string): Promise<MonitoredAddress | null> {
    const pool = postgresPool;
    if (!pool) throw new Error("[PostgreSQL] DATABASE_URL is not configured");

    const result = await pool.query(
      `
        SELECT ${MONITORED_SELECT}
        FROM managed_monitored_addresses
        WHERE id = $1
        LIMIT 1
      `,
      [id]
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  },

  async findByAddress(address: string): Promise<MonitoredAddress | null> {
    const pool = postgresPool;
    if (!pool) throw new Error("[PostgreSQL] DATABASE_URL is not configured");

    const result = await pool.query(
      `
        SELECT ${MONITORED_SELECT}
        FROM managed_monitored_addresses
        WHERE lower(address) = lower($1)
        LIMIT 1
      `,
      [address]
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  },

  async update(id: string, patch: UpdateMonitoredAddressInput): Promise<MonitoredAddress | null> {
    const pool = postgresPool;
    if (!pool) throw new Error("[PostgreSQL] DATABASE_URL is not configured");

    const sets: string[] = [];
    const values: unknown[] = [];

    if (patch.name !== undefined) {
      values.push(patch.name);
      sets.push(`name = $${values.length}`);
    }
    if (patch.address !== undefined) {
      values.push(patch.address);
      sets.push(`address = $${values.length}`);
    }
    if (patch.privateKey !== undefined) {
      values.push(patch.privateKey);
      sets.push(`private_key = $${values.length}`);
    }

    if (sets.length === 0) return monitoredAddresses.findById(id);

    values.push(new Date());
    sets.push(`updated_at = $${values.length}`);
    values.push(id);

    await pool.query(
      `
        UPDATE managed_monitored_addresses
        SET ${sets.join(", ")}
        WHERE id = $${values.length}
      `,
      values
    );
    return monitoredAddresses.findById(id);
  },

  async delete(id: string): Promise<boolean> {
    const pool = postgresPool;
    if (!pool) throw new Error("[PostgreSQL] DATABASE_URL is not configured");

    const result = await pool.query(
      `DELETE FROM managed_monitored_addresses WHERE id = $1`,
      [id]
    );
    return (result.rowCount ?? 0) > 0;
  },
};
