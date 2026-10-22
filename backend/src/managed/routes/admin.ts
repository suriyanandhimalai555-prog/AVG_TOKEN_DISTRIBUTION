/**
 * /api/admin/managed — admin routes (API.md). Guard order on every route:
 * requireAdmin → jsonOnlyGuard (non-GET: JSON content type, not cross-site;
 * SR-01) → (feature flag: router not mounted at all when off) →
 * keyVaultGuard (except GET /health) → requireRecentReauth on sensitive routes.
 */
import { NextFunction, Request, RequestHandler, Response, Router } from "express";
import { postgresPool } from "../../lib/postgres";
import { verifyPassword } from "../../lib/password";
import { requireAdmin } from "../../middleware/requireAdmin";
import { User } from "../../models/User";
import { isKeyVaultAvailable } from "../keyVault";
import { maxWalletsPerPool } from "../models/pools";
import { isIndexerEnabled } from "../middleware/featureFlag";
import { jsonOnlyGuard } from "../middleware/jsonOnly";
import { keyVaultGuard } from "../middleware/keyVaultGuard";
import { isNotMigratedError, managedErrorHandler } from "../middleware/notMigrated";
import {
  clearReauthFailures,
  reauthLocked,
  recordReauthFailure,
  requireRecentReauth,
  stampReauth,
} from "../middleware/requireRecentReauth";
import { managedLog } from "../redact";
import { optionalInt, optionalString, requireUuid } from "../service/common";
import { validation } from "../service/errors";
import { indexerStatus, lastBlockByNetwork, runIndexerNow } from "../service/indexerService";
import { createPool, getPool, listPools, revealMnemonic, updatePool } from "../service/poolService";
import { listTokens, setTokenHidden, trackToken } from "../service/tokenService";
import {
  createTransfer,
  getTransfer,
  listTransfers,
  planTransfer,
  retryTransfer,
  sweep,
} from "../service/transferService";
import { globalTreasury, listDeposits, poolTreasury } from "../service/treasuryService";
import {
  exportPoolCsv,
  generateWallets,
  getWallet,
  listWallets,
  rotateViewToken,
  updateWallet,
} from "../service/walletService";
import type { HealthResponse } from "../types";

type AsyncHandler = (req: Request, res: Response) => Promise<unknown>;

function wrap(handler: AsyncHandler): RequestHandler {
  return (req, res, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}

function userId(req: Request): string {
  const id = req.user?._id;
  if (!id) throw validation("Not authenticated");
  return String(id);
}

function noStore(res: Response): void {
  res.setHeader("Cache-Control", "no-store");
}

async function migrated(): Promise<boolean> {
  if (!postgresPool) return false;
  try {
    // Probe the newest migrated column so a missing later migration reads as "not migrated".
    await postgresPool.query("SELECT seed_type FROM managed_pools LIMIT 1");
    return true;
  } catch (err) {
    if (!isNotMigratedError(err)) {
      managedLog("warn", "health: managed_pools probe failed", { error: err });
    }
    return false;
  }
}

export function createAdminRouter(): Router {
  const router = Router();
  router.use(requireAdmin);
  // SR-01: every state-changing request must be JSON and not cross-site.
  router.use(jsonOnlyGuard);

  // ─── Health (answers even without the key vault) ────────────────────────────

  router.get(
    "/health",
    wrap(async (_req, res) => {
      const isMigrated = await migrated();
      let lastBlocks: HealthResponse["indexer"]["lastBlockByNetwork"] = {};
      if (isMigrated) {
        try {
          lastBlocks = await lastBlockByNetwork();
        } catch (err) {
          managedLog("warn", "health: indexer state unavailable", { error: err });
        }
      }
      const body: HealthResponse & { maxWalletsPerPool: number } = {
        enabled: true,
        keyVault: isKeyVaultAvailable() ? "ok" : "missing",
        migrated: isMigrated,
        indexer: { enabled: isIndexerEnabled(), lastBlockByNetwork: lastBlocks },
        maxWalletsPerPool: maxWalletsPerPool(),
      };
      res.json(body);
    })
  );

  router.use(keyVaultGuard);

  // ─── Re-auth ────────────────────────────────────────────────────────────────

  router.post(
    "/reauth",
    wrap(async (req, res) => {
      noStore(res);
      const id = userId(req);
      const password = (req.body as { password?: unknown } | undefined)?.password;
      if (typeof password !== "string" || password.length === 0) {
        throw validation("password is required");
      }

      if (reauthLocked(id)) {
        return res.status(429).json({
          error: "Too many failed attempts; try again later",
          code: "TOO_MANY_ATTEMPTS",
        });
      }

      const user = await User.findById(id);
      if (!user || !verifyPassword(user, password)) {
        recordReauthFailure(id);
        return res.status(401).json({ error: "Invalid password", code: "INVALID_PASSWORD" });
      }

      clearReauthFailures(id);
      const validUntil = stampReauth(req.session);
      return res.json({ ok: true, validUntil });
    })
  );

  // ─── Pools ──────────────────────────────────────────────────────────────────

  router.get("/pools", wrap(async (_req, res) => res.json(await listPools())));

  router.post(
    "/pools",
    requireRecentReauth,
    wrap(async (req, res) => {
      noStore(res);
      res.status(201).json(await createPool(userId(req), req.body));
    })
  );

  router.get(
    "/pools/:id",
    wrap(async (req, res) => res.json(await getPool(requireUuid(req.params.id, "id"))))
  );

  router.patch(
    "/pools/:id",
    wrap(async (req, res) =>
      res.json(await updatePool(userId(req), requireUuid(req.params.id, "id"), req.body))
    )
  );

  router.post(
    "/pools/:id/reveal-mnemonic",
    requireRecentReauth,
    wrap(async (req, res) => {
      noStore(res);
      res.json(await revealMnemonic(userId(req), requireUuid(req.params.id, "id")));
    })
  );

  router.get(
    "/export/pools/:id.csv",
    wrap(async (req, res) => {
      const { filename, csv } = await exportPoolCsv(userId(req), requireUuid(req.params.id, "id"));
      noStore(res);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(csv);
    })
  );

  // ─── Wallets ────────────────────────────────────────────────────────────────

  router.post(
    "/pools/:id/wallets/generate",
    wrap(async (req, res) =>
      res.status(201).json(await generateWallets(userId(req), requireUuid(req.params.id, "id"), req.body))
    )
  );

  router.get(
    "/pools/:id/wallets",
    wrap(async (req, res) =>
      res.json(
        await listWallets(requireUuid(req.params.id, "id"), {
          skip: optionalInt(req.query.skip, "skip"),
          limit: optionalInt(req.query.limit, "limit"),
          search: optionalString(req.query.search, "search", 200) ?? undefined,
        })
      )
    )
  );

  router.get(
    "/wallets/:id",
    wrap(async (req, res) => {
      noStore(res);
      res.json(await getWallet(requireUuid(req.params.id, "id")));
    })
  );

  router.patch(
    "/wallets/:id",
    wrap(async (req, res) =>
      res.json(await updateWallet(userId(req), requireUuid(req.params.id, "id"), req.body))
    )
  );

  router.post(
    "/wallets/:id/rotate-view-token",
    requireRecentReauth,
    wrap(async (req, res) => {
      noStore(res);
      res.json(await rotateViewToken(userId(req), requireUuid(req.params.id, "id")));
    })
  );

  // ─── Deposits and treasury ──────────────────────────────────────────────────

  router.get(
    "/pools/:id/deposits",
    wrap(async (req, res) =>
      res.json(
        await listDeposits(requireUuid(req.params.id, "id"), {
          skip: optionalInt(req.query.skip, "skip"),
          limit: optionalInt(req.query.limit, "limit"),
          asset: optionalString(req.query.asset, "asset", 64) ?? undefined,
        })
      )
    )
  );

  router.get(
    "/pools/:id/treasury",
    wrap(async (req, res) => res.json(await poolTreasury(requireUuid(req.params.id, "id"))))
  );

  router.get("/treasury", wrap(async (_req, res) => res.json(await globalTreasury())));

  // ─── Transfers ──────────────────────────────────────────────────────────────

  router.post("/transfers/plan", wrap(async (req, res) => res.json(await planTransfer(req.body))));

  router.post(
    "/transfers",
    requireRecentReauth,
    wrap(async (req, res) => {
      const { job, created } = await createTransfer(userId(req), req.body);
      res.status(created ? 201 : 200).json({ job });
    })
  );

  router.post(
    "/transfers/sweep",
    requireRecentReauth,
    wrap(async (req, res) => res.status(201).json(await sweep(userId(req), req.body)))
  );

  router.get(
    "/transfers",
    wrap(async (req, res) =>
      res.json(
        await listTransfers({
          poolId: optionalString(req.query.poolId, "poolId", 64) ?? undefined,
          batchId: optionalString(req.query.batchId, "batchId", 64) ?? undefined,
          status: (optionalString(req.query.status, "status", 32) ?? undefined) as
            | Parameters<typeof listTransfers>[0]["status"]
            | undefined,
          skip: optionalInt(req.query.skip, "skip"),
          limit: optionalInt(req.query.limit, "limit"),
        })
      )
    )
  );

  router.get("/transfers/:id", wrap(async (req, res) => res.json(await getTransfer(req.params.id))));

  router.post(
    "/transfers/:id/retry",
    requireRecentReauth,
    wrap(async (req, res) => res.json(await retryTransfer(userId(req), req.params.id)))
  );

  // ─── Tokens ─────────────────────────────────────────────────────────────────

  router.get(
    "/tokens",
    wrap(async (req, res) =>
      res.json(
        await listTokens({
          network: (optionalString(req.query.network, "network", 32) ?? undefined) as
            | Parameters<typeof listTokens>[0]["network"]
            | undefined,
          includeHidden: req.query.includeHidden === "true",
        })
      )
    )
  );

  router.post(
    "/tokens",
    wrap(async (req, res) => {
      const { response, created } = await trackToken(userId(req), req.body);
      res.status(created ? 201 : 200).json(response);
    })
  );

  router.patch(
    "/tokens/:id",
    wrap(async (req, res) =>
      res.json(await setTokenHidden(userId(req), requireUuid(req.params.id, "id"), req.body))
    )
  );

  // ─── Indexer ────────────────────────────────────────────────────────────────

  router.get("/indexer/status", wrap(async (_req, res) => res.json(await indexerStatus())));

  router.post(
    "/indexer/run",
    wrap(async (req, res) => res.status(202).json(await runIndexerNow(userId(req))))
  );

  router.use(managedErrorHandler);
  return router;
}
