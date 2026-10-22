-- Managed Wallets: several pools per private key, and the pool each
-- distribution session uses. Idempotent: safe to run more than once.
--
-- A private key can now back more than one pool. Each pool for the same key
-- uses its own BIP-44 account (account_path m/44'/60'/<n>'/0; the first pool
-- keeps n = 0), so its wallets never collide with the other pools' wallets.
-- The unique index makes two pools on the same master and account impossible.

CREATE UNIQUE INDEX IF NOT EXISTS managed_pools_master_account_uidx
  ON managed_pools (lower(master_address), account_path);

-- Which pool a distribution session generates its wallets into ("Pool wallets"
-- on the Generate page). Set when a pool is created for the session from
-- Setup, or when the session generates into a pool. session_id is TEXT like
-- distribution_sessions.id; no foreign key, so sessions keep their own lifecycle.
CREATE TABLE IF NOT EXISTS managed_session_pools (
  session_id  TEXT PRIMARY KEY,
  pool_id     UUID NOT NULL REFERENCES managed_pools(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS managed_session_pools_pool_idx ON managed_session_pools (pool_id);
