-- Managed Wallets: tokens the indexer discovered by itself are hidden.
--
-- Anyone can send any token to a managed wallet or master, and on BNB Chain
-- that is mostly spam airdrops, which then showed in every token list. From
-- now on new discoveries start hidden (models/tokens.ts); this hides the ones
-- already discovered. Tokens an admin tracks (the built-in catalog, Import by
-- address) are untouched, and any hidden token can be shown again from
-- Settings or by importing it.
--
-- ZEC is also hidden whatever its source, at the owner's request (2026-10-22).
-- Idempotent: safe to run more than once.

UPDATE managed_tokens
   SET hidden = TRUE
 WHERE hidden = FALSE
   AND (source = 'DISCOVERED' OR upper(symbol) = 'ZEC');
