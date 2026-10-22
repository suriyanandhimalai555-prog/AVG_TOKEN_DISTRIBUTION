import { Network } from "../types";
import { intFromRow, isoFromRow, nullableIsoFromRow, requirePool } from "./common";

export interface IndexerStateRecord {
  network: Network;
  lastScannedBlock: number;
  lastRunAt: string | null;
  lastError: string | null;
  updatedAt: string;
}

export interface IndexerStatePatch {
  lastScannedBlock?: number;
  /** `undefined` leaves the column unchanged; `null` clears it. */
  lastRunAt?: Date | null;
  lastError?: string | null;
}

function mapState(row: any): IndexerStateRecord {
  return {
    network: row.network,
    lastScannedBlock: intFromRow(row.last_scanned_block) ?? 0,
    lastRunAt: nullableIsoFromRow(row.last_run_at),
    lastError: row.last_error ?? null,
    updatedAt: isoFromRow(row.updated_at),
  };
}

export const indexerState = {
  async get(network: Network): Promise<IndexerStateRecord | null> {
    const pool = requirePool();

    const result = await pool.query(
      `
        SELECT *
        FROM managed_indexer_state
        WHERE network = $1
        LIMIT 1
      `,
      [network]
    );

    return result.rows[0] ? mapState(result.rows[0]) : null;
  },

  async listAll(): Promise<IndexerStateRecord[]> {
    const pool = requirePool();

    const result = await pool.query(
      `
        SELECT *
        FROM managed_indexer_state
        ORDER BY network ASC
      `
    );

    return result.rows.map(mapState);
  },

  /**
   * Creates or updates the row for a network. Fields left `undefined` keep
   * their current value (or the column default on first insert).
   */
  async upsert(network: Network, patch: IndexerStatePatch): Promise<IndexerStateRecord> {
    const pool = requirePool();

    const result = await pool.query(
      `
        INSERT INTO managed_indexer_state (network, last_scanned_block, last_run_at, last_error, updated_at)
        VALUES ($1, COALESCE($2::bigint, 0), $3, $4, NOW())
        ON CONFLICT (network) DO UPDATE SET
          last_scanned_block = CASE WHEN $5::boolean THEN EXCLUDED.last_scanned_block
                                    ELSE managed_indexer_state.last_scanned_block END,
          last_run_at = CASE WHEN $6::boolean THEN EXCLUDED.last_run_at
                             ELSE managed_indexer_state.last_run_at END,
          last_error = CASE WHEN $7::boolean THEN EXCLUDED.last_error
                            ELSE managed_indexer_state.last_error END,
          updated_at = NOW()
        RETURNING *
      `,
      [
        network,
        patch.lastScannedBlock ?? null,
        patch.lastRunAt ?? null,
        patch.lastError ?? null,
        patch.lastScannedBlock !== undefined,
        patch.lastRunAt !== undefined,
        patch.lastError !== undefined,
      ]
    );

    return mapState(result.rows[0]);
  },
};
