/**
 * Read-only queries over the distribution tables (distribution_sessions,
 * wallets) for importing a session's wallets into a pool. derivation_path is
 * classified in SQL and never returned: older Independent-seed sessions may
 * hold a seed phrase there.
 */
import type { Network } from "../types";
import { requirePool } from "./common";

export type SessionWalletMode = "HD" | "INDEPENDENT" | "POOL";

export interface ImportableSessionRow {
  id: string;
  status: string;
  network: Network;
  tokenName: string;
  tokenAddress: string;
  totalWallets: number;
  walletCount: number;
  /** Session wallets already in this pool / in another pool. */
  inThisPool: number;
  inOtherPools: number;
  mode: SessionWalletMode;
  hasSeed: boolean;
  createdAt: string;
}

export interface SessionWalletRow {
  index: number;
  address: string;
  /** "standard" / "pool" / "other": the derivation_path itself is not loaded. */
  pathKind: "STANDARD_HD" | "POOL" | "OTHER";
}

export const sessionImports = {
  async listForUser(userId: string, network: Network, poolId: string, limit = 50): Promise<ImportableSessionRow[]> {
    const pool = requirePool();
    const result = await pool.query(
      `
        SELECT s.id, s.status, s.network, s.token_name, s.token_address, s.total_wallets, s.created_at,
               (s.master_mnemonic IS NOT NULL AND length(trim(s.master_mnemonic)) > 0) AS has_seed,
               COUNT(w.id)::int AS wallet_count,
               COUNT(mw.id) FILTER (WHERE mw.pool_id = $3::uuid)::int AS in_this_pool,
               COUNT(mw.id) FILTER (WHERE mw.pool_id <> $3::uuid)::int AS in_other_pools,
               CASE
                 WHEN bool_or(w.derivation_path LIKE 'pool:%') THEN 'POOL'
                 WHEN bool_or(w.derivation_path LIKE 'm/%') THEN 'HD'
                 ELSE 'INDEPENDENT'
               END AS mode
        FROM distribution_sessions s
        LEFT JOIN wallets w ON w.session_id = s.id
        LEFT JOIN managed_wallets mw ON lower(mw.address) = lower(w.address)
        WHERE s.user_id = $1 AND s.network = $2
        GROUP BY s.id
        HAVING COUNT(w.id) > 0
        ORDER BY s.created_at DESC
        LIMIT $4
      `,
      [userId, network, poolId, limit]
    );
    return result.rows.map((r) => ({
      id: r.id,
      status: r.status,
      network: r.network,
      tokenName: r.token_name,
      tokenAddress: r.token_address,
      totalWallets: r.total_wallets,
      walletCount: r.wallet_count,
      inThisPool: r.in_this_pool,
      inOtherPools: r.in_other_pools,
      mode: r.mode,
      hasSeed: r.has_seed,
      createdAt: new Date(r.created_at).toISOString(),
    }));
  },

  async walletsOf(sessionId: string): Promise<SessionWalletRow[]> {
    const pool = requirePool();
    const result = await pool.query(
      `
        SELECT wallet_index, address,
               CASE
                 WHEN derivation_path LIKE 'pool:%' THEN 'POOL'
                 WHEN derivation_path ~ '^m/44''/60''/0''/0/[0-9]+$' THEN 'STANDARD_HD'
                 ELSE 'OTHER'
               END AS path_kind
        FROM wallets
        WHERE session_id = $1
        ORDER BY wallet_index ASC
      `,
      [sessionId]
    );
    return result.rows.map((r) => ({ index: r.wallet_index, address: r.address, pathKind: r.path_kind }));
  },
};
