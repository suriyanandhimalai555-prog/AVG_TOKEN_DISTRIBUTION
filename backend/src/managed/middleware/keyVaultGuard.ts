import { RequestHandler } from "express";
import { isKeyVaultAvailable } from "../keyVault";

/**
 * 503 KEY_VAULT_UNAVAILABLE for every managed route when
 * WALLET_ENCRYPTION_KEY is missing or malformed (SPEC §6.3). Mounted after
 * GET /health so health can still report `keyVault: "missing"`.
 */
export const keyVaultGuard: RequestHandler = (_req, res, next) => {
  if (!isKeyVaultAvailable()) {
    return res.status(503).json({
      error: "WALLET_ENCRYPTION_KEY is not configured; managed wallets are unavailable",
      code: "KEY_VAULT_UNAVAILABLE",
    });
  }
  next();
};
