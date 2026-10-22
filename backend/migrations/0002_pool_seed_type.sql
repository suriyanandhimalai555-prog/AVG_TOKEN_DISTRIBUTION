-- Managed Wallets: a pool's secret is either a BIP-39 mnemonic (default, all
-- pools created before this migration) or an imported private key.
-- Idempotent: safe to run more than once.

ALTER TABLE managed_pools
  ADD COLUMN IF NOT EXISTS seed_type TEXT NOT NULL DEFAULT 'MNEMONIC';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'managed_pools_seed_type_check'
  ) THEN
    ALTER TABLE managed_pools
      ADD CONSTRAINT managed_pools_seed_type_check CHECK (seed_type IN ('MNEMONIC', 'PRIVATE_KEY'));
  END IF;
END $$;

COMMENT ON COLUMN managed_pools.seed_type IS
  'MNEMONIC: mnemonic_* columns hold an encrypted BIP-39 phrase. PRIVATE_KEY: they hold an encrypted 0x private key; the master is that key and children derive from HMAC-SHA512("HolderForge managed wallets v1", key) as a BIP-32 seed.';
