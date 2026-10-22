-- =============================================================================
-- 0001_managed_wallets.sql — Managed Wallets feature (docs/MANAGED_WALLETS_SPEC.md §6.2)
-- Idempotent: safe to apply repeatedly. Applied by backend/src/migrate.ts.
--
-- User references (owner_user_id, holder_user_id, requested_by, managed_audits.user_id)
-- are stored as TEXT without a foreign key, matching how the application passes
-- users.id (crypto.randomUUID() strings). If users.id is UUID on the live DB,
-- compare with `users.id::text` in joins.
-- =============================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  name        TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS managed_pools (
  id                   UUID PRIMARY KEY,
  owner_user_id        TEXT NOT NULL,
  name                 TEXT NOT NULL,
  network              TEXT NOT NULL CHECK (network IN ('bscMainnet','bscTestnet')),
  account_path         TEXT NOT NULL DEFAULT 'm/44''/60''/0''/0',
  master_address       TEXT NOT NULL,
  mnemonic_ciphertext  TEXT NOT NULL,
  mnemonic_iv          TEXT NOT NULL,
  mnemonic_tag         TEXT NOT NULL,
  key_version          INT  NOT NULL DEFAULT 1,
  next_index           INT  NOT NULL DEFAULT 1,
  status               TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  mnemonic_revealed_at TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS managed_pools_owner_idx ON managed_pools (owner_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS managed_wallets (
  id                UUID PRIMARY KEY,
  pool_id           UUID NOT NULL REFERENCES managed_pools(id) ON DELETE CASCADE,
  derivation_index  INT  NOT NULL CHECK (derivation_index >= 1),
  address           TEXT NOT NULL,
  label             TEXT,
  holder_name       TEXT,
  holder_email      TEXT,
  holder_user_id    TEXT,
  view_token        TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (pool_id, derivation_index),
  UNIQUE (address),
  UNIQUE (view_token)
);
CREATE INDEX IF NOT EXISTS managed_wallets_pool_idx ON managed_wallets (pool_id, derivation_index);
CREATE INDEX IF NOT EXISTS managed_wallets_holder_user_idx ON managed_wallets (holder_user_id);

CREATE TABLE IF NOT EXISTS managed_tokens (
  id               UUID PRIMARY KEY,
  network          TEXT NOT NULL CHECK (network IN ('bscMainnet','bscTestnet')),
  token_address    TEXT NOT NULL,
  symbol           TEXT NOT NULL DEFAULT 'UNKNOWN',
  name             TEXT NOT NULL DEFAULT 'Unknown token',
  decimals         INT  NOT NULL DEFAULT 18,
  source           TEXT NOT NULL CHECK (source IN ('TRACKED','DISCOVERED')),
  hidden           BOOLEAN NOT NULL DEFAULT FALSE,
  first_seen_block BIGINT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (network, token_address)
);

-- asset = 'native' for BNB, else lowercase token address
CREATE TABLE IF NOT EXISTS managed_balances (
  wallet_id     UUID NOT NULL REFERENCES managed_wallets(id) ON DELETE CASCADE,
  asset         TEXT NOT NULL,
  balance_wei   NUMERIC(78,0) NOT NULL DEFAULT 0,
  block_number  BIGINT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (wallet_id, asset)
);
CREATE INDEX IF NOT EXISTS managed_balances_asset_idx ON managed_balances (asset);

CREATE TABLE IF NOT EXISTS managed_master_balances (
  pool_id       UUID NOT NULL REFERENCES managed_pools(id) ON DELETE CASCADE,
  asset         TEXT NOT NULL,
  balance_wei   NUMERIC(78,0) NOT NULL DEFAULT 0,
  block_number  BIGINT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (pool_id, asset)
);

CREATE TABLE IF NOT EXISTS managed_deposits (
  id            UUID PRIMARY KEY,
  wallet_id     UUID NOT NULL REFERENCES managed_wallets(id) ON DELETE CASCADE,
  asset         TEXT NOT NULL,
  from_address  TEXT NOT NULL,
  amount_wei    NUMERIC(78,0) NOT NULL,
  tx_hash       TEXT NOT NULL,
  log_index     INT  NOT NULL,
  block_number  BIGINT NOT NULL,
  block_time    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS managed_deposits_wallet_idx ON managed_deposits (wallet_id, block_number DESC);

CREATE TABLE IF NOT EXISTS managed_transfers (
  id                 UUID PRIMARY KEY,
  pool_id            UUID NOT NULL REFERENCES managed_pools(id) ON DELETE CASCADE,
  wallet_id          UUID NOT NULL REFERENCES managed_wallets(id) ON DELETE CASCADE,
  batch_id           UUID,
  to_address         TEXT NOT NULL,
  asset              TEXT NOT NULL,
  amount_wei         NUMERIC(78,0) NOT NULL DEFAULT 0,
  sweep_all          BOOLEAN NOT NULL DEFAULT FALSE,
  status             TEXT NOT NULL DEFAULT 'PENDING'
                     CHECK (status IN ('PENDING','FUNDING_GAS','SENDING','CONFIRMED','FAILED','CANCELLED')),
  gas_topup_tx_hash  TEXT,
  transfer_tx_hash   TEXT,
  gas_price_wei      NUMERIC(78,0),
  gas_limit          BIGINT,
  error              TEXT,
  attempts           INT NOT NULL DEFAULT 0,
  idempotency_key    TEXT NOT NULL UNIQUE,
  requested_by       TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS managed_transfers_status_idx ON managed_transfers (status, created_at);
CREATE INDEX IF NOT EXISTS managed_transfers_batch_idx  ON managed_transfers (batch_id);
CREATE INDEX IF NOT EXISTS managed_transfers_wallet_idx ON managed_transfers (wallet_id, created_at DESC);

CREATE TABLE IF NOT EXISTS managed_indexer_state (
  network             TEXT PRIMARY KEY CHECK (network IN ('bscMainnet','bscTestnet')),
  last_scanned_block  BIGINT NOT NULL DEFAULT 0,
  last_run_at         TIMESTAMPTZ,
  last_error          TEXT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS managed_audits (
  id          UUID PRIMARY KEY,
  user_id     TEXT NOT NULL,
  pool_id     UUID,
  wallet_id   UUID,
  action      TEXT NOT NULL,
  details     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS managed_audits_pool_idx ON managed_audits (pool_id, created_at DESC);
