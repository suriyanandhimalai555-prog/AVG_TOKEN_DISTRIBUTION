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
import { KNOWN_TOKENS } from "../../src/managed/chain/knownTokens";
import { HDNodeWallet, Mnemonic, Wallet, computeHmac, toUtf8Bytes } from "ethers";
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
  // No RPC in this suite: a transfer that reaches the planner answers 503
  // RPC_UNAVAILABLE, which the idempotency cases rely on being deterministic.
  delete process.env.BSC_TESTNET_RPC_URL;
  delete process.env.ALCHEMY_RPC_URL;
  delete process.env.FALLBACK_RPC_1;
  delete process.env.FALLBACK_RPC_2;
  process.env.FRONTEND_URL = "https://app.example.test";
});

import { hashPassword } from "../../src/lib/password";
import { mountManagedWallets } from "../../src/managed";

// A fresh mnemonic per run: managed_wallets.address is globally unique, so a
// fixed phrase (e.g. Hardhat's) collides with pools left behind by other
// suites sharing the throwaway database. Expected addresses are derived here
// with ethers directly (m/44'/60'/0'/0/i), independently of src/managed/derive.
const TEST_MNEMONIC = Mnemonic.entropyToPhrase(randomBytes(16));
const expectedAddress = (index: number): string =>
  HDNodeWallet.fromPhrase(TEST_MNEMONIC, undefined, `m/44'/60'/0'/0/${index}`).address;
const ACCOUNT_0 = expectedAddress(0);
const ACCOUNT_1 = expectedAddress(1);
const ACCOUNT_2 = expectedAddress(2);
const ACCOUNT_3 = expectedAddress(3);

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

  it("mounts nothing when the kill switch MANAGED_WALLETS_ENABLED=false is set", async () => {
    process.env.MANAGED_WALLETS_ENABLED = "false";
    const app = buildApp(() => adminUser(randomUUID()));

    const health = await request(app).get("/api/admin/managed/health");
    expect(health.status).toBe(404);

    const view = await request(app).get(`/api/view/${"a".repeat(64)}`);
    expect(view.status).toBe(404);
  });

  it("is on by default for admins when MANAGED_WALLETS_ENABLED is unset", async () => {
    delete process.env.MANAGED_WALLETS_ENABLED;
    const app = buildApp(() => adminUser(randomUUID()));
    const health = await request(app).get("/api/admin/managed/health");
    expect(health.status).toBe(200);
    expect(health.body.enabled).toBe(true);
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

  describe("SR-01: non-GET requests must be JSON and not cross-site", () => {
    it("urlencoded POST /tokens → 415 UNSUPPORTED_MEDIA_TYPE", async () => {
      process.env.MANAGED_WALLETS_ENABLED = "true";
      const app = buildApp(() => adminUser(randomUUID()));
      const res = await request(app)
        .post("/api/admin/managed/tokens")
        .type("form")
        .send("network=bscMainnet&tokenAddress=0x0000000000000000000000000000000000000001");
      expect(res.status).toBe(415);
      expect(res.body).toEqual({ error: "Content-Type must be application/json", code: "UNSUPPORTED_MEDIA_TYPE" });
    });

    it("bodiless POST /indexer/run (no Content-Type) → 415", async () => {
      process.env.MANAGED_WALLETS_ENABLED = "true";
      const app = buildApp(() => adminUser(randomUUID()));
      const res = await request(app).post("/api/admin/managed/indexer/run");
      expect(res.status).toBe(415);
      expect(res.body.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    });

    it("JSON POST with Sec-Fetch-Site: cross-site → 403 CROSS_SITE_REQUEST", async () => {
      process.env.MANAGED_WALLETS_ENABLED = "true";
      const app = buildApp(() => adminUser(randomUUID()));
      const res = await request(app)
        .post("/api/admin/managed/tokens")
        .set("Sec-Fetch-Site", "cross-site")
        .send({ network: "bscMainnet", tokenAddress: "0x0000000000000000000000000000000000000001" });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("CROSS_SITE_REQUEST");
    });

    it("normal JSON POST passes the guard (reaches the key-vault guard: 503)", async () => {
      process.env.MANAGED_WALLETS_ENABLED = "true";
      delete process.env.WALLET_ENCRYPTION_KEY;
      const app = buildApp(() => adminUser(randomUUID()));
      for (const site of [undefined, "same-origin", "same-site", "none"]) {
        let req = request(app).post("/api/admin/managed/tokens");
        if (site !== undefined) req = req.set("Sec-Fetch-Site", site);
        const res = await req.send({ network: "bscMainnet", tokenAddress: "0x0000000000000000000000000000000000000001" });
        expect(res.status).toBe(503);
        expect(res.body.code).toBe("KEY_VAULT_UNAVAILABLE");
      }
    });

    it("GET is untouched by the guard even with a form content type", async () => {
      process.env.MANAGED_WALLETS_ENABLED = "true";
      const app = buildApp(() => adminUser(randomUUID()));
      const res = await request(app)
        .get("/api/admin/managed/health")
        .set("Content-Type", "application/x-www-form-urlencoded")
        .set("Sec-Fetch-Site", "cross-site");
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(true);
    });

    it("the public view router carries the same guard for any future non-GET route", async () => {
      process.env.MANAGED_WALLETS_ENABLED = "true";
      const app = buildApp(() => null);
      const res = await request(app).post(`/api/view/${"a".repeat(64)}`).type("form").send("x=1");
      expect(res.status).toBe(415);
      expect(res.body.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    });
  });
});

describe.skipIf(!dbAvailable)("against the throwaway database", () => {
  const PASSWORD = "correct horse battery staple";
  const adminId = randomUUID();
  const otherAdminId = randomUUID();
  const db = new Client({ connectionString: TEST_DB_URL });
  let agent: ReturnType<typeof request.agent>;
  let poolId = "";
  let walletId = "";
  let viewToken = "";
  /** managed_tokens rows inserted by this suite; removed in afterAll as a safety net. */
  const insertedTokenIds: string[] = [];

  async function insertAdmin(id: string): Promise<void> {
    const salt = randomBytes(16).toString("hex");
    await db.query(
      `INSERT INTO users (id, email, name, password_hash, password_salt, role)
       VALUES ($1, $2, 'API Test Admin', $3, $4, 'ADMIN')`,
      [id, `api-test-${id}@example.test`, hashPassword(PASSWORD, salt), salt]
    );
  }

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
    await insertAdmin(adminId);
    await insertAdmin(otherAdminId);

    agent = request.agent(buildApp(() => adminUser(adminId)));
  });

  afterAll(async () => {
    if (poolId) {
      await db.query("DELETE FROM managed_audits WHERE pool_id = $1", [poolId]);
      await db.query("DELETE FROM managed_pools WHERE id = $1", [poolId]);
    }
    if (insertedTokenIds.length > 0) {
      await db.query("DELETE FROM managed_tokens WHERE id = ANY($1::uuid[])", [insertedTokenIds]);
    }
    await db.query("DELETE FROM managed_audits WHERE user_id = ANY($1::text[])", [[adminId, otherAdminId]]);
    await db.query("DELETE FROM users WHERE id = ANY($1::text[])", [[adminId, otherAdminId]]);
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

  it("POST /pools imports a mnemonic and derives account 0 as master", async () => {
    const res = await agent
      .post("/api/admin/managed/pools")
      .send({ name: "API test pool", network: "bscTestnet", mnemonic: TEST_MNEMONIC });
    // Capture the id first so afterAll cleans up even if an assertion below fails.
    poolId = res.body?.pool?.id ?? "";
    expect(res.status).toBe(201);
    expect(res.body.masterAddress).toBe(ACCOUNT_0);
    expect(res.body.pool).toMatchObject({
      name: "API test pool",
      network: "bscTestnet",
      masterAddress: ACCOUNT_0,
      status: "ACTIVE",
      nextIndex: 1,
      walletCount: 0,
    });
    expect(JSON.stringify(res.body)).not.toContain(TEST_MNEMONIC.split(" ").slice(0, 3).join(" "));
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
      ACCOUNT_1,
      ACCOUNT_2,
      ACCOUNT_3,
    ]);
    walletId = res.body.created[0].id;
  });

  it("GET /pools/:id/wallets lists balances but never viewToken or viewUrl (SR-04)", async () => {
    const res = await agent.get(`/api/admin/managed/pools/${poolId}/wallets?limit=10`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    const first = res.body.wallets[0];
    expect(first).toMatchObject({ derivationIndex: 1, address: ACCOUNT_1, label: "member-1" });
    expect(first.viewToken).toBeUndefined();
    expect(first.viewUrl).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/[0-9a-f]{64}/);
    expect(JSON.stringify(res.body)).not.toContain("/w/");
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
    // Base columns, the native coin, then one column per tracked testnet token (the known-token catalog).
    const header = lines[0].split(",");
    expect(header.slice(0, 7)).toEqual(["index", "address", "label", "holder_name", "holder_email", "status", "tBNB"]);
    const catalogSymbols = new Set(KNOWN_TOKENS.bscTestnet.map((t) => t.symbol));
    expect(header.slice(7).every((h) => catalogSymbols.has(h))).toBe(true);
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe(`1,${ACCOUNT_1},member-1,,,ACTIVE,` + header.slice(6).map(() => "0").join(","));
    expect(res.text).not.toContain(viewToken);
  });

  it("SR-07: token symbol/name are sanitised and colliding CSV headers are disambiguated", async () => {
    // Two visible testnet tokens: one spoofing the native symbol with bidi and
    // control characters, one with an over-long symbol and name.
    const spoofId = randomUUID();
    const longId = randomUUID();
    const spoofAddress = "0x00000000000000000000000000000000000000aa";
    const longAddress = "0x00000000000000000000000000000000000000bb";
    const bidi = "\u202E"; // RIGHT-TO-LEFT OVERRIDE
    // C0 controls (U+0001, U+0007; Postgres rejects only NUL), a zero-width space
    // (U+200B) and a bidi isolate (U+2066) hidden inside "tBNB".
    const spoofSymbol = `${bidi}t\u0001B\u200BN\u0007B\u2066`;
    const spoofName = `Claim\r\nat  evil${bidi}.example\u000B`;
    const longSymbol = "S".repeat(40);
    const longName = "N".repeat(100);
    insertedTokenIds.push(spoofId, longId);
    await db.query(
      `INSERT INTO managed_tokens (id, network, token_address, symbol, name, decimals, source, hidden)
       VALUES ($1, 'bscTestnet', $2, $3, $4, 18, 'DISCOVERED', FALSE),
              ($5, 'bscTestnet', $6, $7, $8, 6, 'DISCOVERED', FALSE)`,
      [spoofId, spoofAddress, spoofSymbol, spoofName, longId, longAddress, longSymbol, longName]
    );
    try {
      const list = await agent.get("/api/admin/managed/tokens?network=bscTestnet");
      expect(list.status).toBe(200);
      const byId = new Map<string, { symbol: string; name: string }>(
        list.body.tokens.map((t: { id: string; symbol: string; name: string }) => [t.id, t])
      );
      expect(byId.get(spoofId)).toMatchObject({ symbol: "tBNB", name: "Claim at evil.example" });
      expect(byId.get(longId)).toMatchObject({ symbol: "S".repeat(24), name: "N".repeat(64) });
      const serialised = JSON.stringify(list.body);
      expect(serialised).not.toMatch(/[\u0000-\u001f\u007f\u200b\u202a-\u202e\u2066-\u2069]/);

      const csv = await agent.get(`/api/admin/managed/export/pools/${poolId}.csv`);
      expect(csv.status).toBe(200);
      const header = csv.text.split(/\r?\n/)[0].split(",");
      expect(header.slice(0, 7)).toEqual(["index", "address", "label", "holder_name", "holder_email", "status", "tBNB"]);
      // Token column order follows the DB collation of the raw symbol; compare as a set.
      // Ignore the known-token catalog columns; only the two inserted tokens matter here.
      const catalogSymbols = new Set(KNOWN_TOKENS.bscTestnet.map((t) => t.symbol));
      expect(header.slice(7).filter((h) => !catalogSymbols.has(h)).sort()).toEqual([`tBNB (${spoofAddress.slice(0, 10)})`, "S".repeat(24)].sort());
      expect(csv.text).not.toContain(bidi);
    } finally {
      await db.query("DELETE FROM managed_tokens WHERE id = ANY($1::uuid[])", [[spoofId, longId]]);
    }
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
      address: ACCOUNT_1,
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

  describe("private-key pools", () => {
    // A fresh random key per run: managed wallet addresses are globally unique.
    const key = Wallet.createRandom().privateKey;
    const keyAddress = new Wallet(key).address;
    let keyPoolId = "";

    afterAll(async () => {
      if (keyPoolId) {
        await db.query("DELETE FROM managed_audits WHERE pool_id = $1", [keyPoolId]);
        await db.query("DELETE FROM managed_pools WHERE id = $1", [keyPoolId]);
      }
    });

    it("rejects a malformed key and a request with both a phrase and a key", async () => {
      const ok = await agent.post("/api/admin/managed/reauth").send({ password: PASSWORD });
      expect(ok.status).toBe(200);
      const bad = await agent.post("/api/admin/managed/pools").send({ name: "Bad key", network: "bscTestnet", privateKey: "0x1234" });
      expect(bad.status).toBe(400);
      expect(bad.body.code).toBe("INVALID_PRIVATE_KEY");
      const both = await agent
        .post("/api/admin/managed/pools")
        .send({ name: "Both", network: "bscTestnet", privateKey: key, mnemonic: "test test test test test test test test test test test junk" });
      expect(both.status).toBe(400);
      expect(both.body.code).toBe("CONFLICTING_SECRETS");
    });

    it("creates a pool whose master is the imported key's wallet, without echoing the key", async () => {
      const res = await agent.post("/api/admin/managed/pools").send({ name: "Key pool", network: "bscTestnet", privateKey: key.slice(2) });
      expect(res.status).toBe(201);
      keyPoolId = res.body.pool.id;
      expect(res.body.masterAddress).toBe(keyAddress);
      expect(res.body.pool.seedType).toBe("PRIVATE_KEY");
      expect(JSON.stringify(res.body).toLowerCase()).not.toContain(key.slice(2).toLowerCase());

      const list = await agent.get("/api/admin/managed/pools");
      const row = list.body.pools.find((p: { id: string }) => p.id === keyPoolId);
      expect(row.seedType).toBe("PRIVATE_KEY");
      const stored = await db.query("SELECT seed_type, mnemonic_ciphertext FROM managed_pools WHERE id = $1", [keyPoolId]);
      expect(stored.rows[0].seed_type).toBe("PRIVATE_KEY");
      expect(String(stored.rows[0].mnemonic_ciphertext).toLowerCase()).not.toContain(key.slice(2).toLowerCase());
    });

    it("generates wallets derived from the key (documented HMAC seed, m/44'/60'/0'/0/i)", async () => {
      const res = await agent.post(`/api/admin/managed/pools/${keyPoolId}/wallets/generate`).send({ count: 2 });
      expect(res.status).toBe(201);
      const account = HDNodeWallet.fromSeed(computeHmac("sha512", toUtf8Bytes("HolderForge managed wallets v1"), key)).derivePath("m/44'/60'/0'/0");
      expect(res.body.created.map((w: { address: string }) => w.address)).toEqual([account.deriveChild(1).address, account.deriveChild(2).address]);
      expect(res.body.created.map((w: { address: string }) => w.address)).not.toContain(keyAddress);
    });

    it("refuses a second pool for the same wallet and points at the existing one", async () => {
      const again = await agent.post("/api/admin/managed/pools").send({ name: "Same key again", network: "bscMainnet", privateKey: key });
      expect(again.status).toBe(409);
      expect(again.body).toMatchObject({ code: "POOL_EXISTS", poolId: keyPoolId, poolName: "Key pool", network: "bscTestnet", masterAddress: keyAddress });
      expect(JSON.stringify(again.body).toLowerCase()).not.toContain(key.slice(2).toLowerCase());
      const count = await db.query("SELECT count(*)::int AS n FROM managed_pools WHERE lower(master_address) = lower($1)", [keyAddress]);
      expect(count.rows[0].n).toBe(1);
    });

    it("reveal returns the private key (not a mnemonic) after re-auth", async () => {
      const res = await agent.post(`/api/admin/managed/pools/${keyPoolId}/reveal-mnemonic`).send({});
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ seedType: "PRIVATE_KEY", privateKey: key.toLowerCase(), masterAddress: keyAddress });
      expect(res.body.mnemonic).toBeUndefined();
    });
  });

  it("importing a hidden tracked token shows it again instead of failing", async () => {
    const tokenAddress = Wallet.createRandom().address.toLowerCase();
    const id = randomUUID();
    await db.query(
      `INSERT INTO managed_tokens (id, network, token_address, symbol, name, decimals, source, hidden)
       VALUES ($1, 'bscTestnet', $2, 'HID', 'Hidden token', 18, 'TRACKED', TRUE)`,
      [id, tokenAddress]
    );
    try {
      const res = await agent.post("/api/admin/managed/tokens").send({ network: "bscTestnet", tokenAddress });
      expect(res.status).toBe(200);
      expect(res.body.token).toMatchObject({ id, hidden: false, symbol: "HID" });
      const again = await agent.post("/api/admin/managed/tokens").send({ network: "bscTestnet", tokenAddress });
      expect(again.status).toBe(409);
      expect(again.body.code).toBe("ALREADY_TRACKED");
    } finally {
      await db.query("DELETE FROM managed_tokens WHERE id = $1", [id]);
    }
  });

  describe("SR-08: idempotency keys are scoped per user and a reused key must match", () => {
    const clientKey = `api-idem-${randomUUID()}`;
    const amountWei = "1000000000000000"; // 0.001 tBNB
    let seededJobId = "";

    beforeAll(async () => {
      // Seed the job the way the service persists it: `${userId}:${clientKey}`.
      seededJobId = randomUUID();
      await db.query(
        `INSERT INTO managed_transfers
           (id, pool_id, wallet_id, to_address, asset, amount_wei, sweep_all, status, idempotency_key, requested_by)
         VALUES ($1, $2, $3, $4, 'native', $5, FALSE, 'PENDING', $6, $7)`,
        [seededJobId, poolId, walletId, ACCOUNT_0, amountWei, `${adminId}:${clientKey}`, adminId]
      );
      const ok = await agent.post("/api/admin/managed/reauth").send({ password: PASSWORD });
      expect(ok.status).toBe(200);
    });

    afterAll(async () => {
      await db.query("DELETE FROM managed_transfers WHERE wallet_id = $1", [walletId]);
    });

    it("same key, same request → 200 with the existing job and no new row", async () => {
      const res = await agent.post("/api/admin/managed/transfers").send({
        walletId,
        toAddress: ACCOUNT_0.toLowerCase(),
        asset: "native",
        amount: "0.001",
        idempotencyKey: clientKey,
      });
      expect(res.status).toBe(200);
      expect(res.body.job.id).toBe(seededJobId);
      const rows = await db.query("SELECT COUNT(*)::int AS n FROM managed_transfers WHERE wallet_id = $1", [walletId]);
      expect(rows.rows[0].n).toBe(1);
    });

    it("same key, different toAddress / amount / sweepAll → 409 IDEMPOTENCY_MISMATCH", async () => {
      const base = { walletId, toAddress: ACCOUNT_0, asset: "native", amount: "0.001", idempotencyKey: clientKey };
      for (const variant of [
        { ...base, toAddress: ACCOUNT_2 },
        { ...base, amount: "0.002" },
        { ...base, amount: undefined, sweepAll: true },
      ]) {
        const res = await agent.post("/api/admin/managed/transfers").send(variant);
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("IDEMPOTENCY_MISMATCH");
      }
      const rows = await db.query("SELECT COUNT(*)::int AS n FROM managed_transfers WHERE wallet_id = $1", [walletId]);
      expect(rows.rows[0].n).toBe(1);
    });

    it("the same client key from another admin is a different key", async () => {
      const other = request.agent(buildApp(() => adminUser(otherAdminId)));
      const ok = await other.post("/api/admin/managed/reauth").send({ password: PASSWORD });
      expect(ok.status).toBe(200);

      // Not a hit on admin A's job: it falls through to the planner, which
      // has no RPC in this suite and answers 503 instead of 200/409.
      const res = await other.post("/api/admin/managed/transfers").send({
        walletId,
        toAddress: ACCOUNT_2,
        asset: "native",
        amount: "5",
        idempotencyKey: clientKey,
      });
      expect(res.status).toBe(503);
      expect(res.body.code).toBe("RPC_UNAVAILABLE");

      const rows = await db.query("SELECT idempotency_key FROM managed_transfers WHERE wallet_id = $1", [walletId]);
      expect(rows.rows.map((r) => r.idempotency_key)).toEqual([`${adminId}:${clientKey}`]);
    });

    it("sweep entries are stored as `${userId}:${key}:${walletId}:${asset}` and a repeat adds nothing", async () => {
      const key = `api-sweep-${randomUUID()}`;
      // Give the wallet a native balance so the sweep has one candidate.
      await db.query(
        `INSERT INTO managed_balances (wallet_id, asset, balance_wei, block_number, updated_at)
         VALUES ($1, 'native', 1, 1, NOW())
         ON CONFLICT (wallet_id, asset) DO UPDATE SET balance_wei = 1, block_number = 1, updated_at = NOW()`,
        [walletId]
      );
      try {
        const first = await agent
          .post("/api/admin/managed/transfers/sweep")
          .send({ poolId, walletIds: [walletId], assets: ["native"], idempotencyKey: key });
        expect(first.status).toBe(201);
        expect(first.body.jobs).toBe(1);

        const again = await agent
          .post("/api/admin/managed/transfers/sweep")
          .send({ poolId, walletIds: [walletId], assets: ["native"], idempotencyKey: key });
        expect(again.status).toBe(201);
        expect(again.body.jobs).toBe(0);

        const rows = await db.query(
          "SELECT idempotency_key FROM managed_transfers WHERE wallet_id = $1 AND sweep_all = TRUE",
          [walletId]
        );
        expect(rows.rows.map((r) => r.idempotency_key)).toEqual([`${adminId}:${key}:${walletId}:native`]);
      } finally {
        await db.query("DELETE FROM managed_balances WHERE wallet_id = $1", [walletId]);
      }
    });
  });
});
