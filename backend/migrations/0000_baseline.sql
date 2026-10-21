-- =============================================================================
-- 0000_baseline.sql — DOCUMENTATION ONLY. NOT applied by the migration runner
-- (backend/src/migrate.ts skips this file by name).
--
-- Documents the pre-existing HolderForge schema as of 2026-10-21. Source: a
-- read-only information_schema dump of the local mirror database
-- (container `holderforge-local-pg`, database `holderforge`), cross-checked
-- against backend/src/models/*.ts. The production database could not be
-- reached from the development machine; verify there with:
--   SELECT table_name, column_name, data_type FROM information_schema.columns
--   WHERE table_schema='public' ORDER BY table_name, ordinal_position;
--
-- Key fact for the managed-wallets migration: users.id is TEXT (randomUUID()
-- strings written by the application), so user references are TEXT.
-- =============================================================================

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  google_id      TEXT UNIQUE,
  email          TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  avatar         TEXT,
  password_hash  TEXT,
  password_salt  TEXT,
  role           TEXT NOT NULL DEFAULT 'USER',   -- 'USER' | 'ADMIN'
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,                  -- one row per user (findOneAndUpdate by user_id)
  product_line  TEXT NOT NULL,                  -- 'TOKEN_HOLDER' | 'DEX_AUTOMATION'
  plan_key      TEXT NOT NULL,
  status        TEXT NOT NULL,                  -- 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'PENDING'
  wallet_limit  INTEGER NOT NULL,
  started_at    TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id                         TEXT PRIMARY KEY,
  user_id                    TEXT NOT NULL,
  subscription_id            TEXT,
  coinbase_charge_id         TEXT NOT NULL UNIQUE,
  coinbase_charge_code       TEXT,
  coinbase_hosted_url        TEXT,
  coinbase_internal_order_id TEXT,
  coinbase_tx_hash           TEXT,
  coinbase_crypto_type       TEXT,
  amount                     NUMERIC NOT NULL,
  status                     TEXT NOT NULL,     -- NEW | PENDING | CONFIRMED | FAILED | EXPIRED | CANCELLED
  product_line               TEXT NOT NULL,
  plan_key                   TEXT NOT NULL,
  paid_at                    TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS distribution_sessions (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT,
  total_wallets       INTEGER NOT NULL,
  network             TEXT NOT NULL,            -- 'bscMainnet' | 'bscTestnet'
  token_address       TEXT NOT NULL,
  token_name          TEXT,
  multisender_address TEXT,
  status              TEXT NOT NULL,            -- idle|generating|preparing|distributing|done|stopped|error
  sent_count          INTEGER NOT NULL DEFAULT 0,
  failed_count        INTEGER NOT NULL DEFAULT 0,
  bnb_spent           NUMERIC NOT NULL DEFAULT 0,
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  master_mnemonic     TEXT,                     -- plaintext today (see HANDOFF §7)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallets (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL,
  wallet_index    INTEGER NOT NULL,
  address         TEXT NOT NULL,
  derivation_path TEXT,
  amount          NUMERIC NOT NULL DEFAULT 0,
  amount_wei      TEXT NOT NULL DEFAULT '0',
  packed_hex      TEXT NOT NULL DEFAULT '0x',
  sent            BOOLEAN NOT NULL DEFAULT FALSE,
  failed          BOOLEAN NOT NULL DEFAULT FALSE,
  failure_reason  TEXT,
  tx_hash         TEXT,
  "timestamp"     TIMESTAMPTZ,
  batch_id        TEXT,
  UNIQUE (session_id, wallet_index)              -- required by ON CONFLICT in models/Wallet.ts
);

CREATE TABLE IF NOT EXISTS batches (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL,
  batch_index   INTEGER NOT NULL,
  wallet_count  INTEGER NOT NULL,
  tx_hash       TEXT,
  gas_used      TEXT,
  status        TEXT NOT NULL,                  -- pending | confirmed | failed
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at  TIMESTAMPTZ,
  UNIQUE (session_id, batch_index)               -- required by ON CONFLICT in models/Batch.ts
);

CREATE TABLE IF NOT EXISTS session_audits (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  action      TEXT NOT NULL,
  message     TEXT,
  details     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- connect-pg-simple session store (createTableIfMissing: false in src/index.ts)
CREATE TABLE IF NOT EXISTS express_sessions (
  sid     VARCHAR NOT NULL COLLATE "default" PRIMARY KEY,
  sess    JSON NOT NULL,
  expire  TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS "IDX_express_sessions_expire" ON express_sessions (expire);
