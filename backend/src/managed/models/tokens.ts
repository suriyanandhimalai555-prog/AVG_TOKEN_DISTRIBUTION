import { randomUUID } from "crypto";
import { ManagedToken, Network } from "../types";
import { intFromRow, isoFromRow, requirePool } from "./common";

export interface DiscoveredTokenInput {
  network: Network;
  /** Any case; stored lowercase. */
  tokenAddress: string;
  symbol?: string;
  name?: string;
  decimals?: number;
  firstSeenBlock?: number | null;
}

export interface TrackedTokenInput {
  network: Network;
  tokenAddress: string;
  symbol: string;
  name: string;
  decimals: number;
}

function mapToken(row: any): ManagedToken {
  return {
    id: row.id,
    network: row.network,
    tokenAddress: row.token_address,
    symbol: row.symbol,
    name: row.name,
    decimals: row.decimals,
    source: row.source,
    hidden: row.hidden,
    firstSeenBlock: intFromRow(row.first_seen_block),
    createdAt: isoFromRow(row.created_at),
  };
}

export const tokens = {
  /**
   * Inserts default tracked tokens (the known-token catalog). Existing rows are
   * left untouched, so an admin's hidden flag or an earlier discovery wins.
   * Returns how many rows were created.
   */
  async seedTracked(list: TrackedTokenInput[]): Promise<number> {
    if (list.length === 0) return 0;
    const pool = requirePool();
    const values: unknown[] = [];
    const rows = list.map((t, i) => {
      values.push(randomUUID(), t.network, t.tokenAddress.toLowerCase(), t.symbol, t.name, t.decimals);
      const b = i * 6;
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, 'TRACKED', FALSE, NOW())`;
    });
    const result = await pool.query(
      `
        INSERT INTO managed_tokens (id, network, token_address, symbol, name, decimals, source, hidden, created_at)
        VALUES ${rows.join(", ")}
        ON CONFLICT (network, token_address) DO NOTHING
      `,
      values
    );
    return result.rowCount ?? 0;
  },

  /**
   * Records a token seen by the indexer. New discoveries start HIDDEN: anyone
   * can send any token to a managed wallet (spam airdrops are common), so a
   * token only shows once an admin tracks it (catalog, Import by address) or
   * un-hides it in Settings. An existing row keeps its metadata, source and
   * hidden flag; only first_seen_block moves (to the lowest block).
   */
  async upsertDiscovered(data: DiscoveredTokenInput): Promise<ManagedToken> {
    const pool = requirePool();

    const result = await pool.query(
      `
        INSERT INTO managed_tokens (
          id,
          network,
          token_address,
          symbol,
          name,
          decimals,
          source,
          hidden,
          first_seen_block,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'DISCOVERED', TRUE, $7, NOW())
        ON CONFLICT (network, token_address) DO UPDATE SET
          first_seen_block = LEAST(
            COALESCE(managed_tokens.first_seen_block, EXCLUDED.first_seen_block),
            COALESCE(EXCLUDED.first_seen_block, managed_tokens.first_seen_block)
          )
        RETURNING *
      `,
      [
        randomUUID(),
        data.network,
        data.tokenAddress.toLowerCase(),
        data.symbol ?? "UNKNOWN",
        data.name ?? "Unknown token",
        data.decimals ?? 18,
        data.firstSeenBlock ?? null,
      ]
    );

    return mapToken(result.rows[0]);
  },

  /**
   * Adds an admin-tracked token. An existing DISCOVERED row is promoted to
   * TRACKED with the fresh metadata and shown again (tracking a token is a
   * request to see it); `created` tells the two cases apart.
   */
  async insertTracked(
    data: TrackedTokenInput
  ): Promise<{ token: ManagedToken; created: boolean }> {
    const pool = requirePool();

    const result = await pool.query(
      `
        INSERT INTO managed_tokens (
          id,
          network,
          token_address,
          symbol,
          name,
          decimals,
          source,
          hidden,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'TRACKED', FALSE, NOW())
        ON CONFLICT (network, token_address) DO UPDATE SET
          source = 'TRACKED',
          hidden = FALSE,
          symbol = EXCLUDED.symbol,
          name = EXCLUDED.name,
          decimals = EXCLUDED.decimals
        RETURNING *, (xmax = 0) AS inserted
      `,
      [
        randomUUID(),
        data.network,
        data.tokenAddress.toLowerCase(),
        data.symbol,
        data.name,
        data.decimals,
      ]
    );

    const row = result.rows[0];
    return { token: mapToken(row), created: row.inserted === true };
  },

  async findById(id: string): Promise<ManagedToken | null> {
    const pool = requirePool();

    const result = await pool.query(
      `
        SELECT *
        FROM managed_tokens
        WHERE id = $1
        LIMIT 1
      `,
      [id]
    );

    return result.rows[0] ? mapToken(result.rows[0]) : null;
  },

  async findByAddress(network: Network, tokenAddress: string): Promise<ManagedToken | null> {
    const pool = requirePool();

    const result = await pool.query(
      `
        SELECT *
        FROM managed_tokens
        WHERE network = $1
          AND token_address = $2
        LIMIT 1
      `,
      [network, tokenAddress.toLowerCase()]
    );

    return result.rows[0] ? mapToken(result.rows[0]) : null;
  },

  async listByNetwork(network: Network, includeHidden = false): Promise<ManagedToken[]> {
    const pool = requirePool();

    const result = await pool.query(
      `
        SELECT *
        FROM managed_tokens
        WHERE network = $1
          AND ($2::boolean OR hidden = FALSE)
        ORDER BY source ASC, symbol ASC, created_at ASC
      `,
      [network, includeHidden]
    );

    return result.rows.map(mapToken);
  },

  async listAll(includeHidden = false): Promise<ManagedToken[]> {
    const pool = requirePool();

    const result = await pool.query(
      `
        SELECT *
        FROM managed_tokens
        WHERE ($1::boolean OR hidden = FALSE)
        ORDER BY network ASC, source ASC, symbol ASC, created_at ASC
      `,
      [includeHidden]
    );

    return result.rows.map(mapToken);
  },

  async setHidden(id: string, hidden: boolean): Promise<ManagedToken | null> {
    const pool = requirePool();

    const result = await pool.query(
      `
        UPDATE managed_tokens
        SET hidden = $2
        WHERE id = $1
        RETURNING *
      `,
      [id, hidden]
    );

    return result.rows[0] ? mapToken(result.rows[0]) : null;
  },
};
