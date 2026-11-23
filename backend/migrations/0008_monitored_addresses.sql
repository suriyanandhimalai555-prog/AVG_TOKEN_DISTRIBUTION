-- Managed Wallets: monitored addresses (internal tool).
-- Admin manually enters a name label, a wallet address, and its private key
-- for balance/monitoring purposes. Stored plaintext per owner choice
-- (internal tool convenience). Idempotent: safe to run more than once.
--
-- Private keys are entered by the admin; wallet connect (MetaMask/Trust/Phantom)
-- only ever reveals an address, never a private key, so this field cannot be
-- auto-filled from a connected wallet.
CREATE TABLE IF NOT EXISTS managed_monitored_addresses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id   TEXT NOT NULL,
  name            TEXT NOT NULL CHECK (length(trim(name)) > 0 AND length(name) <= 200),
  address         TEXT NOT NULL CHECK (address ~ '^0x[0-9a-fA-F]{40}$'),
  private_key     TEXT NOT NULL CHECK (private_key ~ '^(0x)?[0-9a-fA-F]{64}$'),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (address)
);
CREATE INDEX IF NOT EXISTS managed_monitored_addresses_owner_idx
  ON managed_monitored_addresses (owner_user_id, created_at DESC);

COMMENT ON TABLE managed_monitored_addresses IS
  'Admin-monitored addresses (internal tool). Private keys stored plaintext per owner choice.';
COMMENT ON COLUMN managed_monitored_addresses.private_key IS
  'Wallet private key (64 hex, with or without 0x), entered manually by admin. Plaintext per owner choice.';
