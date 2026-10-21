/**
 * N8 QA — transfer job rules that need no RPC:
 *
 *  - retry: FAILED only, attempts < MANAGED_MAX_ATTEMPTS, gas_topup_tx_hash
 *    always kept, transfer_tx_hash cleared only after REVERTED, audit row;
 *  - idempotency: the model returns the existing job for a repeated key, and
 *    POST /transfers answers 200 with the same job (no second row);
 *  - the retry route and the re-auth guard over HTTP.
 *
 * Uses the native asset only on bscTestnet (no token rows), so it never
 * changes the token set api.test.ts (N5) asserts on.
 */
import { randomUUID } from "crypto";
import express from "express";
import session from "express-session";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const SAVED_ENV: Record<string, string | undefined> = {};
const ENV_KEYS = ["MANAGED_WALLETS_ENABLED", "WALLET_ENCRYPTION_KEY", "MANAGED_MAX_ATTEMPTS", "FRONTEND_URL"];

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://postgres:test@localhost:55432/managed_test?sslmode=disable";
  process.env.PGSSL = "false";
  process.env.FRONTEND_URL = "https://qa.example.test";
  process.env.MANAGED_WALLETS_ENABLED = "true";
  process.env.WALLET_ENCRYPTION_KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => 31 - i)).toString("base64");
  process.env.MANAGED_MAX_ATTEMPTS = "3";
});

import { mountManagedWallets } from "../../src/managed";
import { transfers } from "../../src/managed/models/transfers";
import type { TransferRecord } from "../../src/managed/models/transfers";
import type { PoolRecord } from "../../src/managed/models/pools";
import type { ManagedWalletRecord } from "../../src/managed/models/wallets";
import { retryTransfer, transferIdempotencyKey } from "../../src/managed/service/transferService";
import {
  addWallets,
  cleanupPools,
  cleanupUsers,
  createAdminUser,
  createPool,
  probeDb,
  randomAddress,
  rawClient,
  txHash,
} from "./helpers/fixtures";

type FakeUser = Express.User | null;

function buildApp(currentUser: () => FakeUser): express.Express {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use(
    session({
      secret: "n8-test-secret",
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false, httpOnly: true },
    })
  );
  app.use((req, _res, next) => {
    const user = currentUser();
    const r = req as express.Request & { user?: Express.User; isAuthenticated: () => boolean };
    r.user = user ?? undefined;
    r.isAuthenticated = () => user !== null;
    next();
  });
  mountManagedWallets(app);
  app.use((_req, res) => {
    res.status(404).json({ error: "Route not found" });
  });
  return app;
}

const dbAvailable = await probeDb();
if (!dbAvailable) {
  console.warn("[transfers.test] throwaway database not reachable at localhost:55432 — DB-backed cases are skipped");
}

describe.skipIf(!dbAvailable)("transfer jobs against the throwaway database", () => {
  const client = rawClient();
  let admin: { id: string; email: string; password: string };
  let pool: PoolRecord;
  let wallet: ManagedWalletRecord;

  const TOPUP = txHash();
  const TRANSFER = txHash();

  async function seedJob(patch: Parameters<typeof transfers.update>[1] = {}): Promise<TransferRecord> {
    const { job } = await transfers.create({
      poolId: pool.id,
      walletId: wallet.id,
      toAddress: pool.masterAddress,
      asset: "native",
      amountWei: 1_000n,
      idempotencyKey: `n8-job-${randomUUID()}`,
      requestedBy: admin.id,
    });
    if (Object.keys(patch).length === 0) return job;
    const updated = await transfers.update(job.id, patch);
    if (!updated) throw new Error("seedJob: update returned null");
    return updated;
  }

  beforeAll(async () => {
    for (const key of ENV_KEYS) SAVED_ENV[key] = process.env[key];
    await client.connect();
    admin = await createAdminUser(client);
    pool = await createPool({ network: "bscTestnet", name: "N8 QA transfers pool", ownerUserId: admin.id });
    [wallet] = await addWallets(pool.id, [{ label: "t-1" }]);
  });

  afterAll(async () => {
    await cleanupPools(client, [pool?.id].filter(Boolean) as string[]);
    await cleanupUsers(client, [admin?.id].filter(Boolean) as string[]);
    await client.end();
    for (const key of ENV_KEYS) {
      if (SAVED_ENV[key] === undefined) delete process.env[key];
      else process.env[key] = SAVED_ENV[key];
    }
  });

  describe("model idempotency", () => {
    it("transfers.create returns the existing job for a repeated key", async () => {
      const key = `n8-model-${randomUUID()}`;
      const input = {
        poolId: pool.id,
        walletId: wallet.id,
        toAddress: pool.masterAddress,
        asset: "native",
        amountWei: 5n,
        idempotencyKey: key,
        requestedBy: admin.id,
      };
      const first = await transfers.create(input);
      const second = await transfers.create({ ...input, amountWei: 999n });
      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.job.id).toBe(first.job.id);
      expect(second.job.amountWei).toBe("5");
      const rows = await client.query("SELECT COUNT(*)::int AS n FROM managed_transfers WHERE idempotency_key = $1", [key]);
      expect(rows.rows[0].n).toBe(1);
    });
  });

  describe("retry rules", () => {
    it("refuses anything that is not FAILED with 409 NOT_RETRYABLE", async () => {
      const pending = await seedJob();
      await expect(retryTransfer(admin.id, pending.id)).rejects.toMatchObject({ status: 409, code: "NOT_RETRYABLE" });

      const confirmed = await seedJob({ status: "CONFIRMED", transferTxHash: TRANSFER, attempts: 1, confirmedAt: new Date() });
      await expect(retryTransfer(admin.id, confirmed.id)).rejects.toMatchObject({ status: 409, code: "NOT_RETRYABLE" });

      const sending = await seedJob({ status: "SENDING", attempts: 1 });
      await expect(retryTransfer(admin.id, sending.id)).rejects.toMatchObject({ status: 409, code: "NOT_RETRYABLE" });
    });

    it("refuses when attempts >= MANAGED_MAX_ATTEMPTS with 409 MAX_ATTEMPTS", async () => {
      const exhausted = await seedJob({ status: "FAILED", error: "TIMEOUT: no receipt", attempts: 3 });
      await expect(retryTransfer(admin.id, exhausted.id)).rejects.toMatchObject({ status: 409, code: "MAX_ATTEMPTS" });

      const over = await seedJob({ status: "FAILED", error: "BROADCAST_FAILED: nonce", attempts: 7 });
      await expect(retryTransfer(admin.id, over.id)).rejects.toMatchObject({ status: 409, code: "MAX_ATTEMPTS" });

      const row = await client.query("SELECT status, attempts FROM managed_transfers WHERE id = $1", [exhausted.id]);
      expect(row.rows[0]).toEqual({ status: "FAILED", attempts: 3 });
    });

    it("TIMEOUT: back to PENDING, both hashes kept so the worker re-checks the receipt first", async () => {
      const job = await seedJob({
        status: "FAILED",
        error: "TIMEOUT: no receipt after 180000ms",
        gasTopupTxHash: TOPUP,
        transferTxHash: TRANSFER,
        attempts: 1,
        gasPriceWei: 100_000_000n,
        gasLimit: 65_000,
      });
      const { job: retried } = await retryTransfer(admin.id, job.id);
      expect(retried).toMatchObject({
        id: job.id,
        status: "PENDING",
        error: null,
        errorCode: null,
        gasTopupTxHash: TOPUP,
        transferTxHash: TRANSFER,
        attempts: 1,
        gasPriceWei: "100000000",
        gasLimit: 65_000,
      });
      const row = await client.query(
        "SELECT status, error, gas_topup_tx_hash, transfer_tx_hash FROM managed_transfers WHERE id = $1",
        [job.id]
      );
      expect(row.rows[0]).toEqual({ status: "PENDING", error: null, gas_topup_tx_hash: TOPUP, transfer_tx_hash: TRANSFER });
    });

    it("REVERTED: transfer hash cleared, gas top-up hash kept", async () => {
      const job = await seedJob({
        status: "FAILED",
        error: "REVERTED: execution reverted",
        gasTopupTxHash: TOPUP,
        transferTxHash: TRANSFER,
        attempts: 2,
      });
      const { job: retried } = await retryTransfer(admin.id, job.id);
      expect(retried).toMatchObject({ status: "PENDING", error: null, gasTopupTxHash: TOPUP, transferTxHash: null, attempts: 2 });
    });

    it("BROADCAST_FAILED without hashes and an untyped error both reset cleanly", async () => {
      const broadcast = await seedJob({ status: "FAILED", error: "BROADCAST_FAILED: replacement fee too low", attempts: 1 });
      const r1 = await retryTransfer(admin.id, broadcast.id);
      expect(r1.job).toMatchObject({ status: "PENDING", error: null, gasTopupTxHash: null, transferTxHash: null });

      const untyped = await seedJob({ status: "FAILED", error: "something odd", gasTopupTxHash: TOPUP, transferTxHash: TRANSFER, attempts: 1 });
      const r2 = await retryTransfer(admin.id, untyped.id);
      // Unknown error text is not REVERTED, so the hash is kept for the receipt check.
      expect(r2.job).toMatchObject({ status: "PENDING", gasTopupTxHash: TOPUP, transferTxHash: TRANSFER });
    });

    it("records TRANSFER_RETRIED audits with the acting user id and previous code", async () => {
      const rows = await client.query(
        `SELECT user_id, wallet_id, details FROM managed_audits WHERE pool_id = $1 AND action = 'TRANSFER_RETRIED'`,
        [pool.id]
      );
      expect(rows.rows.length).toBeGreaterThanOrEqual(4);
      expect(rows.rows.every((r) => r.user_id === admin.id && r.wallet_id === wallet.id)).toBe(true);
      const codes = rows.rows.map((r) => r.details.previousErrorCode).sort();
      expect(codes).toEqual(expect.arrayContaining(["TIMEOUT", "REVERTED", "BROADCAST_FAILED", "UNKNOWN"]));
    });

    it("404 TRANSFER_NOT_FOUND for an unknown id and 400 for a malformed id", async () => {
      await expect(retryTransfer(admin.id, randomUUID())).rejects.toMatchObject({ status: 404, code: "TRANSFER_NOT_FOUND" });
      await expect(retryTransfer(admin.id, "nope")).rejects.toMatchObject({ status: 400, code: "VALIDATION" });
    });
  });

  describe("HTTP: POST /transfers idempotency, retry route, re-auth guard", () => {
    let agent: ReturnType<typeof request.agent>;
    const adminUser = (): Express.User => ({ _id: admin.id, email: admin.email, name: "N8 QA Admin", role: "ADMIN" });

    beforeAll(async () => {
      agent = request.agent(buildApp(() => adminUser()));
      const ok = await agent.post("/api/admin/managed/reauth").send({ password: admin.password });
      expect(ok.status).toBe(200);
    });

    it("POST /transfers without re-auth → 401 REAUTH_REQUIRED (no job created)", async () => {
      const fresh = request.agent(buildApp(() => adminUser()));
      const key = `n8-http-noauth-${randomUUID()}`;
      const res = await fresh
        .post("/api/admin/managed/transfers")
        .send({ walletId: wallet.id, toAddress: pool.masterAddress, asset: "native", amount: "0.001", idempotencyKey: key });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("REAUTH_REQUIRED");
      const rows = await client.query("SELECT COUNT(*)::int AS n FROM managed_transfers WHERE idempotency_key = $1", [key]);
      expect(rows.rows[0].n).toBe(0);
    });

    it("POST /transfers with a known idempotency key → 200 and the same job, no second row", async () => {
      const key = `n8-http-idem-${randomUUID()}`;
      // Stored keys are scoped per user (SR: `${userId}:${clientKey}`), so seed the scoped key.
      const storedKey = transferIdempotencyKey(admin.id, key);
      const { job: seeded } = await transfers.create({
        poolId: pool.id,
        walletId: wallet.id,
        toAddress: pool.masterAddress,
        asset: "native",
        amountWei: 1_000_000_000_000_000n,
        idempotencyKey: storedKey,
        requestedBy: admin.id,
      });

      const body = { walletId: wallet.id, toAddress: pool.masterAddress, asset: "native", amount: "0.001", idempotencyKey: key };
      const first = await agent.post("/api/admin/managed/transfers").send(body);
      expect(first.status).toBe(200);
      expect(first.body.job.id).toBe(seeded.id);
      expect(first.body.job).toMatchObject({ status: "PENDING", symbol: "tBNB", amount: "0.001", walletAddress: wallet.address });

      const second = await agent.post("/api/admin/managed/transfers").send(body);
      expect(second.status).toBe(200);
      expect(second.body.job.id).toBe(seeded.id);

      const rows = await client.query("SELECT COUNT(*)::int AS n FROM managed_transfers WHERE idempotency_key = $1", [storedKey]);
      expect(rows.rows[0].n).toBe(1);

      // The same client key reused for a different request must never return that job.
      const mismatch = await agent.post("/api/admin/managed/transfers").send({ ...body, amount: "0.002" });
      expect(mismatch.status).toBe(409);
      expect(mismatch.body.code).toBe("IDEMPOTENCY_MISMATCH");
    });

    it("SR-01: a non-JSON or bodiless POST is refused with 415 before any handler runs", async () => {
      const key = `n8-http-415-${randomUUID()}`;
      const urlencoded = await agent
        .post("/api/admin/managed/transfers")
        .type("form")
        .send(`walletId=${wallet.id}&toAddress=${pool.masterAddress}&asset=native&amount=1&idempotencyKey=${key}`);
      expect(urlencoded.status).toBe(415);
      expect(urlencoded.body.code).toBe("UNSUPPORTED_MEDIA_TYPE");
      const bodiless = await agent.post("/api/admin/managed/indexer/run");
      expect(bodiless.status).toBe(415);
      const rows = await client.query("SELECT COUNT(*)::int AS n FROM managed_transfers WHERE idempotency_key LIKE $1", [`%${key}%`]);
      expect(rows.rows[0].n).toBe(0);
    });

    it("POST /transfers validates before touching the chain", async () => {
      const res = await agent
        .post("/api/admin/managed/transfers")
        .send({ walletId: wallet.id, toAddress: pool.masterAddress, asset: "native", amount: "abc", idempotencyKey: "k" });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION");
      const missingKey = await agent
        .post("/api/admin/managed/transfers")
        .send({ walletId: wallet.id, toAddress: pool.masterAddress, asset: "native", amount: "1" });
      expect(missingKey.status).toBe(400);
    });

    it("POST /transfers/:id/retry → 200 for a FAILED job and 409 for the rest", async () => {
      const failed = await seedJob({ status: "FAILED", error: "TIMEOUT: x", transferTxHash: TRANSFER, attempts: 1 });
      // SR-01: state-changing requests must carry a JSON body.
      const ok = await agent.post(`/api/admin/managed/transfers/${failed.id}/retry`).send({});
      expect(ok.status).toBe(200);
      expect(ok.body.job).toMatchObject({ id: failed.id, status: "PENDING", transferTxHash: TRANSFER, errorCode: null });

      const again = await agent.post(`/api/admin/managed/transfers/${failed.id}/retry`).send({});
      expect(again.status).toBe(409);
      expect(again.body.code).toBe("NOT_RETRYABLE");

      const noAuth = await request(buildApp(() => adminUser())).post(`/api/admin/managed/transfers/${failed.id}/retry`).send({});
      expect(noAuth.status).toBe(401);
    });

    it("GET /transfers?poolId= lists this pool's jobs with byStatus counts", async () => {
      const res = await agent.get(`/api/admin/managed/transfers?poolId=${pool.id}&limit=50`);
      expect(res.status).toBe(200);
      expect(res.body.total).toBeGreaterThanOrEqual(10);
      expect(res.body.jobs.every((j: { poolId: string }) => j.poolId === pool.id)).toBe(true);
      const sum = Object.values(res.body.byStatus as Record<string, number>).reduce((x, y) => x + y, 0);
      expect(sum).toBe(res.body.total);
      expect(res.body.byStatus.FAILED).toBeGreaterThanOrEqual(2);
      // Job hashes may be printed in API responses (they are public on-chain data), but never keys.
      expect(res.text).not.toMatch(/mnemonic|privateKey|ciphertext/i);
    });

    it("GET /transfers/:id returns the job; unknown → 404", async () => {
      const job = await seedJob();
      const res = await agent.get(`/api/admin/managed/transfers/${job.id}`);
      expect(res.status).toBe(200);
      expect(res.body.job.id).toBe(job.id);
      const missing = await agent.get(`/api/admin/managed/transfers/${randomUUID()}`);
      expect(missing.status).toBe(404);
      expect(missing.body.code).toBe("TRANSFER_NOT_FOUND");
    });

    it("POST /transfers → 409 WALLET_DISABLED / POOL_ARCHIVED before any plan", async () => {
      const [disabled] = await addWallets(pool.id, [{ label: "t-2", status: "DISABLED" }], 2);
      expect(disabled.status).toBe("DISABLED");
      const res = await agent
        .post("/api/admin/managed/transfers")
        .send({ walletId: disabled.id, toAddress: randomAddress(), asset: "native", amount: "1", idempotencyKey: `n8-${randomUUID()}` });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("WALLET_DISABLED");
    });
  });
});
