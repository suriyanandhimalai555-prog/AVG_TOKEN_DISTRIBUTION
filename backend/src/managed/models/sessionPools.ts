/**
 * managed_session_pools (migration 0006): which pool a distribution session
 * generates its wallets into.
 */
import { requirePool } from "./common";

export const sessionPools = {
  async poolIdFor(sessionId: string): Promise<string | null> {
    const pool = requirePool();
    const result = await pool.query("SELECT pool_id FROM managed_session_pools WHERE session_id = $1", [sessionId]);
    return result.rows[0]?.pool_id ?? null;
  },

  async link(sessionId: string, poolId: string): Promise<void> {
    const pool = requirePool();
    await pool.query(
      `INSERT INTO managed_session_pools (session_id, pool_id) VALUES ($1, $2)
       ON CONFLICT (session_id) DO UPDATE SET pool_id = EXCLUDED.pool_id, updated_at = NOW()`,
      [sessionId, poolId]
    );
  },
};
