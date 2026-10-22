/**
 * Background-job switches for a backend that shares the production database
 * (e.g. a developer laptop): MANAGED_WORKER_ENABLED=false keeps the transfer
 * worker off and MANAGED_INDEXER_ENABLED=false keeps the indexer off, while
 * the routes still mount and /health says which jobs run in this process.
 */
import { randomBytes } from "crypto";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://postgres:test@localhost:55432/managed_test?sslmode=disable";
  process.env.PGSSL = "false";
  delete process.env.MANAGED_WALLETS_ENABLED;
  delete process.env.MANAGED_WORKER_ENABLED;
  delete process.env.MANAGED_INDEXER_ENABLED;
});

import { mountManagedWallets, startManagedWorkers, stopManagedWorkers } from "../../src/managed";
import { isIndexerEnabled, isWorkerEnabled } from "../../src/managed/middleware/featureFlag";

function logLines(spy: ReturnType<typeof vi.spyOn>): string[] {
  return spy.mock.calls.map((c) => String(c[0]));
}

describe("background-job switches", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await stopManagedWorkers();
    vi.restoreAllMocks();
    delete process.env.MANAGED_WORKER_ENABLED;
    delete process.env.MANAGED_INDEXER_ENABLED;
    delete process.env.WALLET_ENCRYPTION_KEY;
  });

  it("worker and indexer are on by default", () => {
    expect(isWorkerEnabled()).toBe(true);
    expect(isIndexerEnabled()).toBe(true);
  });

  it("only the exact value \"false\" turns each one off", () => {
    process.env.MANAGED_WORKER_ENABLED = "false";
    process.env.MANAGED_INDEXER_ENABLED = "false";
    expect(isWorkerEnabled()).toBe(false);
    expect(isIndexerEnabled()).toBe(false);

    process.env.MANAGED_WORKER_ENABLED = "true";
    expect(isWorkerEnabled()).toBe(true);
  });

  it("with both off, start runs no background job but the API still mounts", async () => {
    process.env.WALLET_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    process.env.MANAGED_WORKER_ENABLED = "false";
    process.env.MANAGED_INDEXER_ENABLED = "false";

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const r = req as express.Request & { user?: Express.User; isAuthenticated: () => boolean };
      r.user = { _id: "worker-switch-admin", email: "worker-switch@example.test", name: "Admin", role: "ADMIN" } as Express.User;
      r.isAuthenticated = () => true;
      next();
    });
    mountManagedWallets(app);
    expect(logLines(logSpy).some((l) => l.startsWith("[managed] routes mounted") && l.includes('"worker":false'))).toBe(true);

    await startManagedWorkers();
    const lines = logLines(logSpy);
    expect(lines.some((l) => l.includes("transfer worker disabled by MANAGED_WORKER_ENABLED=false"))).toBe(true);
    expect(lines.some((l) => l.includes("indexer disabled by MANAGED_INDEXER_ENABLED=false"))).toBe(true);
    expect(lines.some((l) => l.includes("transfer worker started"))).toBe(false);
    expect(lines.some((l) => l.includes("indexer started"))).toBe(false);

    const res = await request(app).get("/api/admin/managed/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ keyVault: "ok", indexer: { enabled: false }, worker: { enabled: false } });
  });

  it("with the worker switch unset, the worker starts as before", async () => {
    process.env.WALLET_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    process.env.MANAGED_INDEXER_ENABLED = "false";

    await startManagedWorkers();
    expect(logLines(logSpy).some((l) => l.includes("transfer worker started"))).toBe(true);
  });
});
