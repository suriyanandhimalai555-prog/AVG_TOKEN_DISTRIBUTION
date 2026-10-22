/**
 * Distribution session → pool wiring: "Pool wallets" generation allocates the
 * session's recipient wallets from the pool whose master is the signing
 * wallet, so distributed tokens land in pool wallets.
 *
 * Runs only against the throwaway database (FILE_OWNERSHIP.md). wallets.csv
 * is written to a temp SCRIPTS_DIR, never to backend/output.
 */
import { randomBytes, randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { Wallet as EthersWallet } from "ethers";
import express from "express";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TEST_DB_URL = "postgres://postgres:test@localhost:55432/managed_test?sslmode=disable";

const scriptsDir = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://postgres:test@localhost:55432/managed_test?sslmode=disable";
  process.env.PGSSL = "false";
  delete process.env.MANAGED_WALLETS_ENABLED;
  // No RPC: the session token below is already in the catalog, so tracking it needs none.
  delete process.env.BSC_TESTNET_RPC_URL;
  delete process.env.ALCHEMY_RPC_URL;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const dir = require("fs").mkdtempSync(require("path").join(require("os").tmpdir(), "session-pool-"));
  process.env.SCRIPTS_DIR = dir;
  return dir as string;
});

import { KNOWN_TOKENS } from "../../src/managed/chain/knownTokens";
import { mountManagedWallets } from "../../src/managed";
import { createPool } from "../../src/managed/service/poolService";
import { Session } from "../../src/models/Session";

async function probeDb(): Promise<boolean> {
  const client = new Client({ connectionString: TEST_DB_URL, connectionTimeoutMillis: 3_000 });
  try {
    await client.connect();
    await client.query("SELECT 1 FROM managed_pools LIMIT 1");
    await client.query("SELECT 1 FROM distribution_sessions LIMIT 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const dbAvailable = await probeDb();

describe.skipIf(!dbAvailable)("session → pool wiring", () => {
  const db = new Client({ connectionString: TEST_DB_URL });
  const adminId = randomUUID();
  const otherId = randomUUID();
  const signingKey = EthersWallet.createRandom().privateKey;
  const signingAddress = new EthersWallet(signingKey).address;
  const testnetToken = KNOWN_TOKENS.bscTestnet[0].address;
  const sessionIds: string[] = [];
  let poolId = "";

  function appFor(id: string): express.Express {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const r = req as express.Request & { user?: Express.User; isAuthenticated: () => boolean };
      r.user = { _id: id, email: `${id}@example.test`, name: "Admin", role: "ADMIN" } as Express.User;
      r.isAuthenticated = () => true;
      next();
    });
    mountManagedWallets(app);
    return app;
  }

  async function newSession(network: "bscMainnet" | "bscTestnet", totalWallets: number, owner = adminId): Promise<string> {
    const s = await Session.create({
      userId: owner,
      totalWallets,
      network,
      tokenAddress: testnetToken,
      tokenName: "USDT Token",
      multisenderAddress: EthersWallet.createRandom().address,
    });
    sessionIds.push(s._id);
    return s._id;
  }

  beforeAll(async () => {
    process.env.MANAGED_WALLETS_ENABLED = "true";
    process.env.WALLET_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    await db.connect();
    for (const id of [adminId, otherId]) {
      await db.query(`INSERT INTO users (id, email, name, role) VALUES ($1, $2, 'Session Pool Test', 'ADMIN')`, [
        id,
        `session-pool-${id}@example.test`,
      ]);
    }
    const created = await createPool(adminId, { name: "Session pool test", network: "bscTestnet", privateKey: signingKey });
    poolId = created.pool.id;
  });

  afterAll(async () => {
    if (sessionIds.length) {
      await db.query("DELETE FROM wallets WHERE session_id = ANY($1::text[])", [sessionIds]);
      await db.query("DELETE FROM session_audits WHERE session_id = ANY($1::text[])", [sessionIds]);
      await db.query("DELETE FROM distribution_sessions WHERE id = ANY($1::text[])", [sessionIds]);
    }
    if (poolId) {
      await db.query("DELETE FROM managed_audits WHERE pool_id = $1", [poolId]);
      await db.query("DELETE FROM managed_pools WHERE id = $1", [poolId]);
    }
    await db.query("DELETE FROM managed_audits WHERE user_id = ANY($1::text[])", [[adminId, otherId]]);
    await db.query("DELETE FROM users WHERE id = ANY($1::text[])", [[adminId, otherId]]);
    await db.end();
    fs.rmSync(scriptsDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("finds the pool whose master is the signing wallet", async () => {
    const sessionId = await newSession("bscTestnet", 4);
    const res = await request(appFor(adminId)).post(`/api/admin/managed/sessions/${sessionId}/pool`).send({ privateKey: signingKey });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ sessionId, network: "bscTestnet", signingAddress, reason: null, needed: 4 });
    expect(res.body.pool).toMatchObject({ id: poolId, masterAddress: signingAddress });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("generates the session's wallets inside the pool and feeds prepare", async () => {
    const sessionId = await newSession("bscTestnet", 3);
    const app = appFor(adminId);

    const res = await request(app).post(`/api/admin/managed/sessions/${sessionId}/generate`).send({ privateKey: signingKey });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "done", sessionId, created: 3 });
    expect(res.body.pool.id).toBe(poolId);

    const sessionWallets = await db.query(
      "SELECT wallet_index, address, derivation_path FROM wallets WHERE session_id = $1 ORDER BY wallet_index",
      [sessionId]
    );
    const poolWallets = await db.query(
      "SELECT address, derivation_index, label FROM managed_wallets WHERE pool_id = $1 AND derivation_index BETWEEN $2 AND $3 ORDER BY derivation_index",
      [poolId, res.body.fromIndex, res.body.toIndex]
    );
    expect(sessionWallets.rows.map((r) => r.wallet_index)).toEqual([0, 1, 2]);
    expect(sessionWallets.rows.map((r) => r.address)).toEqual(poolWallets.rows.map((r) => r.address));
    expect(sessionWallets.rows[0].derivation_path).toBe(`pool:${poolId}/${res.body.fromIndex}`);
    expect(poolWallets.rows[0].label).toBe(`Session ${sessionId.slice(-12)} #${res.body.fromIndex}`);

    // prepare-distribution reads index + address from this file; no key is written.
    const csv = fs.readFileSync(path.join(scriptsDir, "output", "wallets.csv"), "utf8").trim().split("\n");
    expect(csv[0]).toBe("index,address,privateKey,derivationPath");
    expect(csv).toHaveLength(4);
    const [idx, address, key] = csv[1].split(",");
    expect(idx).toBe("0");
    expect(address).toBe(sessionWallets.rows[0].address);
    expect(key).toBe("");

    const session = await db.query("SELECT status, master_mnemonic, sent_count FROM distribution_sessions WHERE id = $1", [sessionId]);
    expect(session.rows[0]).toMatchObject({ status: "idle", master_mnemonic: null, sent_count: 3 });

    // Generating again replaces the session's wallets with new pool wallets.
    const again = await request(app).post(`/api/admin/managed/sessions/${sessionId}/generate`).send({ privateKey: signingKey });
    expect(again.status).toBe(201);
    expect(again.body.fromIndex).toBe(res.body.toIndex + 1);
    const count = await db.query("SELECT count(*)::int AS n FROM wallets WHERE session_id = $1", [sessionId]);
    expect(count.rows[0].n).toBe(3);
  });

  it("a signing wallet without a pool gets NO_POOL and a 409 on generate", async () => {
    const sessionId = await newSession("bscTestnet", 2);
    const otherKey = EthersWallet.createRandom().privateKey;
    const app = appFor(adminId);

    const match = await request(app).post(`/api/admin/managed/sessions/${sessionId}/pool`).send({ privateKey: otherKey });
    expect(match.status).toBe(200);
    expect(match.body).toMatchObject({ pool: null, reason: "NO_POOL" });

    const gen = await request(app).post(`/api/admin/managed/sessions/${sessionId}/generate`).send({ privateKey: otherKey });
    expect(gen.status).toBe(409);
    expect(gen.body.code).toBe("NO_POOL_FOR_WALLET");
  });

  it("a pool on another network is reported and refused", async () => {
    const sessionId = await newSession("bscMainnet", 2);
    const app = appFor(adminId);

    const match = await request(app).post(`/api/admin/managed/sessions/${sessionId}/pool`).send({ privateKey: signingKey });
    expect(match.body).toMatchObject({ reason: "NETWORK_MISMATCH" });
    expect(match.body.pool.network).toBe("bscTestnet");

    const gen = await request(app).post(`/api/admin/managed/sessions/${sessionId}/generate`).send({ privateKey: signingKey });
    expect(gen.status).toBe(409);
    expect(gen.body.code).toBe("POOL_NETWORK_MISMATCH");
    const count = await db.query("SELECT count(*)::int AS n FROM wallets WHERE session_id = $1", [sessionId]);
    expect(count.rows[0].n).toBe(0);
  });

  it("another user's session is a 404 and a bad key is a 400", async () => {
    const sessionId = await newSession("bscTestnet", 2, otherId);
    const app = appFor(adminId);

    const foreign = await request(app).post(`/api/admin/managed/sessions/${sessionId}/generate`).send({ privateKey: signingKey });
    expect(foreign.status).toBe(404);
    expect(foreign.body.code).toBe("SESSION_NOT_FOUND");

    const own = await newSession("bscTestnet", 2);
    const bad = await request(app).post(`/api/admin/managed/sessions/${own}/pool`).send({ privateKey: "0x1234" });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("INVALID_PRIVATE_KEY");
  });
});
