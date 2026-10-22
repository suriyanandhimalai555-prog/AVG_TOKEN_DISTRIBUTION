-- Distribution wallets: wallets.derivation_path must only ever hold a path.
-- routes/generate.ts used to take the 4th CSV column as the path. In
-- INDEPENDENT_SEEDS mode (index,address,privateKey,mnemonic,derivationPath)
-- that column is the wallet's own seed phrase, in double quotes, so those
-- rows stored a secret. They become 'independent', which is what the script
-- writes for these wallets. A bare private key is scrubbed the same way.
-- BIP-44 paths (m/...) and Managed Wallets references (pool:...) are left alone.
-- Idempotent: a scrubbed value never matches again.

DO $$
BEGIN
  IF to_regclass('wallets') IS NOT NULL THEN
    UPDATE wallets
       SET derivation_path = 'independent'
     WHERE (derivation_path ~ '^"?[a-z]+( +[a-z]+){11,23}"?$'
            OR derivation_path ~ '^"?(0x)?[0-9a-fA-F]{64}"?$')
       AND derivation_path NOT LIKE 'm/%'
       AND derivation_path NOT LIKE 'pool:%';
  END IF;
END $$;
