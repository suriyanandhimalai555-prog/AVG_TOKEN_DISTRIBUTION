/**
 * Kill-switch invariants: the feature is on by default (ADMIN-gated), and
 * MANAGED_WALLETS_ENABLED set to false / 0 / off / no (any casing) turns it
 * off: nothing is mounted, no worker starts, nothing is logged.
 *
 * The HTTP surface of the full server (health, /api/auth/me, generic 404
 * handler) is covered by the flag-off boot in TEST_PLAN.md; this file proves
 * the managed entry points themselves are inert.
 */
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://postgres:test@localhost:55432/managed_test?sslmode=disable";
  process.env.PGSSL = "false";
  delete process.env.MANAGED_WALLETS_ENABLED;
});

import { isManagedEnabled, mountManagedWallets, startManagedWorkers, stopManagedWorkers } from "../../src/managed";

const OFF_VALUES: string[] = ["false", "FALSE", "False", " false ", "0", "off", "OFF", "no", "No"];
const ON_VALUES: Array<string | undefined> = [undefined, "", "true", "TRUE", "1", "yes", "on", " true"];

function appWithFallthrough(): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    // Anonymous caller, the shape passport gives a request without a session user.
    (req as express.Request & { isAuthenticated: () => boolean }).isAuthenticated = () => false;
    next();
  });
  mountManagedWallets(app);
  app.use((_req, res) => {
    res.status(404).json({ error: "Route not found", path: _req.originalUrl });
  });
  return app;
}

describe("feature kill switch", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MANAGED_WALLETS_ENABLED;
  });

  it.each(OFF_VALUES)("isManagedEnabled() is false for %j", (value) => {
    process.env.MANAGED_WALLETS_ENABLED = value;
    expect(isManagedEnabled()).toBe(false);
  });

  it.each(ON_VALUES)("isManagedEnabled() is true (on by default) for %j", (value) => {
    if (value === undefined) delete process.env.MANAGED_WALLETS_ENABLED;
    else process.env.MANAGED_WALLETS_ENABLED = value;
    expect(isManagedEnabled()).toBe(true);
  });

  it.each(OFF_VALUES)("mounts nothing and logs nothing for %j", async (value) => {
    process.env.MANAGED_WALLETS_ENABLED = value;

    const app = appWithFallthrough();

    const health = await request(app).get("/api/admin/managed/health");
    expect(health.status).toBe(404);
    expect(health.body).toEqual({ error: "Route not found", path: "/api/admin/managed/health" });

    const reauth = await request(app).post("/api/admin/managed/reauth").send({ password: "x" });
    expect(reauth.status).toBe(404);

    const view = await request(app).get(`/api/view/${"a".repeat(64)}`);
    expect(view.status).toBe(404);
    expect(view.body).toEqual({ error: "Route not found", path: `/api/view/${"a".repeat(64)}` });

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("startManagedWorkers / stopManagedWorkers are silent no-ops", async () => {
    process.env.MANAGED_WALLETS_ENABLED = "false";
    await expect(startManagedWorkers()).resolves.toBeUndefined();
    await expect(stopManagedWorkers()).resolves.toBeUndefined();
    await expect(stopManagedWorkers()).resolves.toBeUndefined();
    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("flag on without a key: routes mount, workers refuse to start with one warning line", async () => {
    process.env.MANAGED_WALLETS_ENABLED = "true";
    delete process.env.WALLET_ENCRYPTION_KEY;

    const app = appWithFallthrough();
    const health = await request(app).get("/api/admin/managed/health");
    expect(health.status).toBe(403); // requireAdmin runs before anything else; anonymous → 403
    expect(health.body).toEqual({ error: "Forbidden" });
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(String(logSpy.mock.calls[0][0])).toMatch(/^\[managed\] routes mounted /);

    await startManagedWorkers();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toMatch(/^\[managed\] WALLET_ENCRYPTION_KEY missing or invalid/);
    await stopManagedWorkers();
  });
});
