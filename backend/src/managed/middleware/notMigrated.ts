import { ErrorRequestHandler } from "express";
import { KeyVaultError } from "../keyVault";
import { PoolReserveError } from "../models/pools";
import { managedLog } from "../redact";
import { ManagedApiError } from "../service/errors";

/** Postgres SQLSTATE for "relation does not exist". */
const UNDEFINED_TABLE = "42P01";
/** Postgres SQLSTATE for "column does not exist": a later migration (e.g. 0002) is missing. */
const UNDEFINED_COLUMN = "42703";

const RESERVE_STATUS: Record<PoolReserveError["code"], number> = {
  POOL_NOT_FOUND: 404,
  POOL_ARCHIVED: 409,
  POOL_LIMIT_REACHED: 400,
};

function pgCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export function isNotMigratedError(err: unknown): boolean {
  const code = pgCode(err);
  return code === UNDEFINED_TABLE || code === UNDEFINED_COLUMN;
}

/**
 * Error translator placed at the end of both managed routers
 * (ARCHITECTURE.md §4). Known typed errors keep their codes; unknown errors
 * become a generic 500 whose message is never the raw `err.message`.
 */
export const managedErrorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  if (isNotMigratedError(err)) {
    return res.status(503).json({
      error: "Managed wallets tables are not migrated",
      code: "NOT_MIGRATED",
    });
  }

  if (err instanceof KeyVaultError) {
    return res.status(503).json({
      error: "Key vault unavailable",
      code: "KEY_VAULT_UNAVAILABLE",
    });
  }

  if (err instanceof PoolReserveError) {
    return res.status(RESERVE_STATUS[err.code]).json({ error: err.message, code: err.code });
  }

  if (err instanceof ManagedApiError) {
    return res.status(err.status).json({ ...(err.details ?? {}), error: err.message, code: err.code });
  }

  // Malformed JSON bodies from express.json() carry a status and `type`.
  const status = (err as { status?: unknown }).status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    return res.status(status).json({ error: "Invalid request", code: "VALIDATION" });
  }

  managedLog("error", "unhandled route error", {
    method: req.method,
    path: req.originalUrl,
    error: err,
  });

  return res.status(500).json({ error: "Internal server error", code: "INTERNAL" });
};
