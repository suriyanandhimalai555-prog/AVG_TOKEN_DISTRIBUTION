/**
 * Managed Wallets API wiring (N5): guards, feature flag, key vault, re-auth,
 * pool/wallet creation against the throwaway database, public view and its
 * rate limiter.
 *
 * DB-backed cases run only when postgres://postgres:test@localhost:55432/
 * managed_test is reachable (FILE_OWNERSHIP.md "Throwaway test database").
 * The DATABASE_URL from backend/.env is never used: this file sets its own
 * before lib/postgres is imported.
 */
import { randomBytes, randomUUID } from "crypto";
import express from "express";
import session from "express-session";
import { Client } from "pg";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const TEST_DB_URL = "postgres://postgres:test@localhost:55432/managed_test?sslmode=disable";

vi.hoisted(() => {
  // lib/postgres reads DATABASE_URL at import time; sslmode=disable in the URL
  // overrides the ssl option it forces, so the frozen module needs no change.
  process.env.DATABASE_URL = "postgres://postgres:test@localhost:55432/managed_test?sslmode=disable";
  process.env.PGSSL = "false";
  delete process.env.MANAGED_WALLETS_ENABLED;
  delete process.env.WALLET_ENCRYPTION_KEY;
  delete process.env.MANAGED_VIEW_RATE_LIMIT_PER_MIN;
  process.env.FRONTEND_URL = "https://app.example.test";
});

import { hashPassword } from "../../src/lib/password";
import { mountManagedWallets } from "../../src/managed";

const HARDHAT_MNEMONIC = "test test test test test test test test test test test junk";
const HARDHAT_ACCOUNT_0 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const HARDHAT_ACCOUNT_1 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const HARDHAT_ACCOUNT_2 = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const HARDHAT_ACCOUNT_3 = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";

type FakeUser = Express.User | null;

const adminUser = (id: string): Express.User => ({
  _id: id,
  email: `${id}@example.test`,
  name: "Admin",
  role: "ADMIN",
});

function buildApp(currentUser: () => FakeUser): express.Express {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use(
    session({
      secret: "test-secret",
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

async function probeDb(): Promise<boolean> {
  const client = new Client({ connectionString: TEST_DB_URL, connectionTimeoutMillis: 3_000 });
  try {
    await client.connect();
    await client.query("SELECT 1 FROM managed_pools LIMIT 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const dbAvailable = await probeDb();
if (!dbAvailable) {
  console.warn(
    "[api.test] throwaway database not reachable at localhost:55432 — DB-backed cases are skipped"
  );
}

const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = ["MANAGED_WALLETS_ENABLED", "WALLET_ENCRYPTION_KEY", "MANAGED_VIEW_RATE_LIMIT_PER_MIN"];

beforeAll(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("feature flag and guards", () => {
  afterEach(() => {
    delete process.env.MANAGED_WALLETS_ENABLED;
    delete process.env.WALLET_ENCRYPTION_KEY;
  });

  it("mounts nothing when MANAGED_WALLETS_ENABLED is not 'true'", async () => {
    delete process.env.MANAGED_WALLETS_ENABLED;
    const app = buildApp(() => adminUser(randomUUID()));

    const health = await request(app).get("/api/admin/managed/health");
    expect(health.status).toBe(404);

    const view = await request(app).get(`/api/view/${"a".repeat(64)}`);
    expect(view.status).toBe(404);
  });

  it("returns 403 for non-admins and anonymous callers when enabled", async () => {
    process.env.MANAGED_WALLETS_ENABLED = "true";

    const asUser = buildApp(() => ({ ...adminUser(randomUUID()), role: "USER" }));
    const userRes = await request(asUser).get("/api/admin/managed/health");
    expect(userRes.status).toBe(403);
    expect(userRes.body).toEqual({ error: "Forbidden" });

    const anonymous = buildApp(() => null);
    const anonRes = await request(anonymous).post("/api/admin/managed/pools").send({});
    expect(anonRes.status).toBe(403);
  });

  it("reports keyVault 'missing' on /health and answers 503 KEY_VAULT_UNAVAILABLE elsewhere", async () => {
    process.env.MANAGED_WALLETS_ENABLED = "true";
    delete process.env.WALLET_ENCRYPTION_KEY;
    const app = buildApp(() => adminUser(randomUUID()));

    const health = await request(app).get("/api/admin/managed/health");
    expect(health.status).toBe(200);
    expect(health.body.enabled).toBe(true);
    expect(health.body.keyVault).toBe("missing");
    expect(typeof health.body.migrated).toBe("boolean");
    expect(health.body.indexer).toMatchObject({ enabled: expect.any(Boolean) });
    expect(health.body.maxWalletsPerPool).toBe(10_000);

    const pools = await request(app)
      .post("/api/admin/managed/pools")
      .send({ name: "x", network: "bscTestnet" });
    expect(pools.status).toBe(503);
    expect(pools.body.code).toBe("KEY_VAULT_UNAVAILABLE");
  });
});

describe.skipIf(!dbAvailable)("against the throwaway database", () => {
  const PASSWORD = "correct horse battery staple";
  const adminId = randomUUID();
  const db = new Client({ connectionString: TEST_DB_URL });
  let agent: ReturnType<typeof request.agent>;
  let poolId = "";
  let walletId = "";
  let viewToken = "";

  beforeAll(async () => {
    process.env.MANAGED_WALLETS_ENABLED = "true";
    process.env.WALLET_ENCRYPTION_KEY = randomBytes(32).toString("base64");

    await db.connect();
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id             TEXT PRIMARY KEY,
        google_id      TEXT UNIQUE,
        email          TEXT NOT NULL UNIQUE,
        name           TEXT NOT NULL,
        avatar         TEXT,
        password_hash  TEXT,
        password_salt  TEXT,
        role           TEXT NOT NULL DEFAULT 'USER',
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const salt = randomBytes(16).toString("hex");
    await db.query(
      `INSERT INTO users (id, email, name, password_hash, password_salt, role)
       VALUES ($1, $2, 'API Test Admin', $3, $4, 'ADMIN')`,
      [adminId, `api-test-${adminId}@example.test`, hashPassword(PASSWORD, salt), salt]
    );

    agent = request.agent(buildApp(() => adminUser(adminId)));
  });

  afterAll(async () => {
    if (poolId) {
      await db.query("DELETE FROM managed_audits WHERE pool_id = $1", [poolId]);
      await db.query("DELETE FROM managed_pools WHERE id = $1", [poolId]);
    }
    await db.query("DELETE FROM managed_audits WHERE user_id = $1", [adminId]);
    await db.query("DELETE FROM users WHERE id = $1", [adminId]);
    await db.end();
    delete process.env.MANAGED_WALLETS_ENABLED;
    delete process.env.WALLET_ENCRYPTION_KEY;
  });

  it("GET /health reports migrated: true", async () => {
    const res = await agent.get("/api/admin/managed/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ enabled: true, keyVault: "ok", migrated: true });
  });

  it("POST /pools without re-auth → 401 REAUTH_REQUIRED", async () => {
    const res = await agent
      .post("/api/admin/managed/pools")
      .send({ name: "No reauth", network: "bscTestnet" });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("REAUTH_REQUIRED");
  });

  it("POST /reauth rejects a wrong password and accepts the right one", async () => {
    const wrong = await agent.post("/api/admin/managed/reauth").send({ password: "nope" });
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe("INVALID_PASSWORD");

    const ok = await agent.post("/api/admin/managed/reauth").send({ password: PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);
    expect(Date.parse(ok.body.validUntil)).toBeGreaterThan(Date.now());
    expect(ok.headers["cache-control"]).toBe("no-store");
  });

  it("locks re-auth after 5 failures for a user", async () => {
    const otherId = randomUUID();
    const other = request.agent(buildApp(() => adminUser(otherId)));
    for (let i = 0; i < 5; i++) {
      const res = await other.post("/api/admin/managed/reauth").send({ password: "bad" });
      expect(res.status).toBe(401);
    }
    const locked = await other.post("/api/admin/managed/reauth").send({ password: "bad" });
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe("TOO_MANY_ATTEMPTS");
  });

  it("POST /pools imports the Hardhat mnemonic and derives account 0 as master", async () => {
    const res = await agent
      .post("/api/admin/managed/pools")
      .send({ name: "API test pool", network: "bscTestnet", mnemonic: HARDHAT_MNEMONIC });
    // Capture the id first so afterAll cleans up even if an assertion below fails.
    poolId = res.body?.pool?.id ?? "";
    expect(res.status).toBe(201);
    expect(res.body.masterAddress).toBe(HARDHAT_ACCOUNT_0);
    expect(res.body.pool).toMatchObject({
      name: "API test pool",
      network: "bscTestnet",
      masterAddress: HARDHAT_ACCOUNT_0,
      status: "ACTIVE",
      nextIndex: 1,
      walletCount: 0,
    });
    expect(JSON.stringify(res.body)).not.toContain("junk");
    expect(res.body.mnemonic).toBeUndefined();
    expect(res.body.pool.mnemonic).toBeUndefined();
    expect(res.body.pool.mnemonicCiphertext).toBeUndefined();
    expect(res.body.pool.ownerUserId).toBeUndefined();
  });

  it("POST /pools with a bad mnemonic → 400 INVALID_MNEMONIC", async () => {
    const res = await agent
      .post("/api/admin/managed/pools")
      .send({ name: "bad", network: "bscTestnet", mnemonic: "not a valid phrase at all" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_MNEMONIC");
  });

  it("POST /pools/:id/wallets/generate derives indexes 1..3", async () => {
    const res = await agent
      .post(`/api/admin/managed/pools/${poolId}/wallets/generate`)
      .send({ count: 3, labelPrefix: "member-" });
    expect(res.status).toBe(201);
    expect(res.body.nextIndex).toBe(4);
    expect(res.body.created.map((w: { derivationIndex: number }) => w.derivationIndex)).toEqual([1, 2, 3]);
    expect(res.body.created.map((w: { address: string }) => w.address)).toEqual([
      HARDHAT_ACCOUNT_1,
      HARDHAT_ACCOUNT_2,
      HARDHAT_ACCOUNT_3,
    ]);
    walletId = res.body.created[0].id;
  });

  it("GET /pools/:id/wallets lists balances and viewUrl but never viewToken", async () => {
    const res = await agent.get(`/api/admin/managed/pools/${poolId}/wallets?limit=10`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    const first = res.body.wallets[0];
    expect(first).toMatchObject({ derivationIndex: 1, address: HARDHAT_ACCOUNT_1, label: "member-1" });
    expect(first.viewToken).toBeUndefined();
    expect(first.viewUrl).toMatch(/^https:\/\/app\.example\.test\/w\/[0-9a-f]{64}$/);
    expect(first.balances[0]).toMatchObject({ asset: "native", symbol: "tBNB", balance: "0" });

    const search = await agent.get(`/api/admin/managed/pools/${poolId}/wallets?search=member-3`);
    expect(search.body.total).toBe(1);
  });

  it("GET /wallets/:id returns the view token and url", async () => {
    const res = await agent.get(`/api/admin/managed/wallets/${walletId}`);
    expect(res.status).toBe(200);
    expect(res.body.wallet.viewToken).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.wallet.viewUrl).toBe(`https://app.example.test/w/${res.body.wallet.viewToken}`);
    expect(res.body.wallet.deposits).toEqual([]);
    expect(res.body.wallet.transfers).toEqual([]);
    viewToken = res.body.wallet.viewToken;
  });

  it("GET /export/pools/:id.csv is an attachment without tokens", async () => {
    const res = await agent.get(`/api/admin/managed/export/pools/${poolId}.csv`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/csv/);
    expect(res.headers["content-disposition"]).toBe(`attachment; filename="pool-${poolId}.csv"`);
    const lines = res.text.trim().split(/\r?\n/);
    expect(lines[0]).toBe("index,address,label,holder_name,holder_email,status,tBNB");
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe(`1,${HARDHAT_ACCOUNT_1},member-1,,,ACTIVE,0`);
    expect(res.text).not.toContain(viewToken);
  });

  it("GET /api/view/:token returns the public shape only", async () => {
    const res = await request(buildApp(() => null)).get(`/api/view/${viewToken}`);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(Object.keys(res.body).sort()).toEqual(
      ["address", "deposits", "label", "native", "network", "tokens", "updatedAt"].sort()
    );
    expect(res.body).toMatchObject({
      label: "member-1",
      address: HARDHAT_ACCOUNT_1,
      network: "bscTestnet",
      native: { symbol: "tBNB", balanceWei: "0", balance: "0" },
      tokens: [],
      deposits: [],
    });
    expect(JSON.stringify(res.body)).not.toContain(poolId);
  });

  it("GET /api/view/:token → 404 for unknown and malformed tokens", async () => {
    const app = buildApp(() => null);
    const unknown = await request(app).get(`/api/view/${randomBytes(32).toString("hex")}`);
    expect(unknown.status).toBe(404);
    const malformed = await request(app).get("/api/view/not-a-token");
    expect(malformed.status).toBe(404);
  });

  it("GET /api/view/:token → 404 once the wallet is DISABLED", async () => {
    const disable = await agent.patch(`/api/admin/managed/wallets/${walletId}`).send({ status: "DISABLED" });
    expect(disable.status).toBe(200);
    expect(disable.body.wallet.status).toBe("DISABLED");

    const res = await request(buildApp(() => null)).get(`/api/view/${viewToken}`);
    expect(res.status).toBe(404);

    const enable = await agent.patch(`/api/admin/managed/wallets/${walletId}`).send({ status: "ACTIVE" });
    expect(enable.status).toBe(200);
  });

  it("rate limits the public view per MANAGED_VIEW_RATE_LIMIT_PER_MIN", async () => {
    process.env.MANAGED_VIEW_RATE_LIMIT_PER_MIN = "3";
    try {
      const app = buildApp(() => null);
      for (let i = 0; i < 3; i++) {
        const res = await request(app).get(`/api/view/${viewToken}`);
        expect(res.status).toBe(200);
      }
      const limited = await request(app).get(`/api/view/${viewToken}`);
      expect(limited.status).toBe(429);
      expect(limited.body.code).toBe("RATE_LIMITED");
      // draft-7 standard headers: a single combined `RateLimit` header.
      expect(String(limited.headers["ratelimit"])).toContain("limit=3");
    } finally {
      delete process.env.MANAGED_VIEW_RATE_LIMIT_PER_MIN;
    }
  });

  it("POST /transfers/plan validates input before touching the chain", async () => {
    const res = await agent
      .post("/api/admin/managed/transfers/plan")
      .send({ walletId, toAddress: "0xnot-an-address", asset: "native", amount: "1" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
  });

  it("GET /transfers lists nothing for the pool", async () => {
    const res = await agent.get(`/api/admin/managed/transfers?poolId=${poolId}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ jobs: [], total: 0, byStatus: {} });
  });
});
