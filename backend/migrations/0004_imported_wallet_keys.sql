-- Managed Wallets: wallets imported into a pool with their own private key
-- (e.g. a distribution session's already-funded wallets), next to the wallets
-- derived from the pool secret. Idempotent: safe to run more than once.
--
-- DERIVED  (default, every wallet before this migration): the key is derived
--          from the pool secret at derivation_index; key_* columns are NULL.
-- IMPORTED: key_* hold the wallet's own private key, AES-256-GCM encrypted
--          with WALLET_ENCRYPTION_KEY (AAD "managed-wallet:<id>"). The
--          derivation_index slot is reserved from the pool counter so ordering,
--          limits and the "#" column keep working; its derived key is unused.

ALTER TABLE managed_wallets
  ADD COLUMN IF NOT EXISTS key_source     TEXT NOT NULL DEFAULT 'DERIVED',
  ADD COLUMN IF NOT EXISTS key_ciphertext TEXT,
  ADD COLUMN IF NOT EXISTS key_iv         TEXT,
  ADD COLUMN IF NOT EXISTS key_tag        TEXT,
  ADD COLUMN IF NOT EXISTS key_version    INT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'managed_wallets_key_source_check'
  ) THEN
    ALTER TABLE managed_wallets
      ADD CONSTRAINT managed_wallets_key_source_check CHECK (
        (key_source = 'DERIVED'
          AND key_ciphertext IS NULL AND key_iv IS NULL AND key_tag IS NULL AND key_version IS NULL)
        OR
        (key_source = 'IMPORTED'
          AND key_ciphertext IS NOT NULL AND key_iv IS NOT NULL AND key_tag IS NOT NULL AND key_version IS NOT NULL)
      );
  END IF;
END $$;

COMMENT ON COLUMN managed_wallets.key_source IS
  'DERIVED: key derives from the pool secret at derivation_index. IMPORTED: key_* hold the wallet''s own encrypted private key (AAD managed-wallet:<id>); the pool secret is NOT a backup for it.';
