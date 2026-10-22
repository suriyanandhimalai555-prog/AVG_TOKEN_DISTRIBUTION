/**
 * Importing a distribution session's wallets into a pool (IMPORTED wallets):
 * keys rebuilt server-side from the session seed (standard and pre-d58b556
 * paths) or output/wallets.csv, verified against each address, stored
 * encrypted, never logged or audited.
 *
 * Runs only against the throwaway database (FILE_OWNERSHIP.md). wallets.csv
 * lives in a temp SCRIPTS_DIR, never in backend/output.
 */
import { randomBytes, randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { HDNodeWallet, Mnemonic, Wallet as EthersWallet } from "ethers";
import express from "express";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TEST_DB_URL = "postgres://postgres:test@localhost:55432/managed_test?sslmode=disable";

const scriptsDir = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://postgres:test@localhost:55432/managed_test?sslmode=disable";
  process.env.PGSSL = "false";
  delete process.env.MANAGED_WALLETS_ENABLED;
  delete process.env.BSC_TESTNET_RPC_URL;
  delete process.env.ALCHEMY_RPC_URL;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const dir = require("fs").mkdtempSync(require("path").join(require("os").tmpdir(), "session-import-"));
  process.env.SCRIPTS_DIR = dir;
  return dir as string;
});

import { KNOWN_TOKENS } from "../../src/managed/chain/knownTokens";
import { mountManagedWallets } from "../../src/managed";
import { vaultPort } from "../../src/managed/adapters";
import { createPool } from "../../src/managed/service/poolService";
import {
  importSessionWallets,
  listImportableSessions,
  previewSessionImport,
} from "../../src/managed/service/sessionImportService";
import { Session } from "../../src/models/Session";
import { Wallet } from "../../src/models/Wallet";

async function probeDb(): Promise<boolean> {
  const client = new Client({ connectionString: TEST_DB_URL, connectionTimeoutMillis: 3_000 });
  try {
    await client.connect();
    await client.query("SELECT key_source FROM managed_wallets LIMIT 1");
    await client.query("SELECT 1 FROM distribution_sessions LIMIT 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const dbAvailable = await probeDb();

describe.skipIf(!dbAvailable)("importing session wallets into a pool", () => {
  const db = new Client({ connectionString: TEST_DB_URL });
  const adminId = randomUUID();
  const testnetToken = KNOWN_TOKENS.bscTestnet[0].address;
  const phrase = Mnemonic.entropyToPhrase(randomBytes(16));
  const standard = HDNodeWallet.fromPhrase(phrase, undefined, "m/44'/60'/0'/0");
  const legacy = HDNodeWallet.fromPhrase(phrase, undefined, "m/44'/60'/0'/0/0/44'/60'/0'/0");
  const stranger = EthersWallet.createRandom();
  const sessionIds: string[] = [];
  const poolIds: string[] = [];
  let poolId = "";
  const logLines: string[] = [];

  async function newSession(network: "bscMainnet" | "bscTestnet", wallets: Array<{ address: string; path: string }>, seed?: string) {
    const s = await Session.create({
      userId: adminId,
      totalWallets: wallets.length,
      network,
      tokenAddress: testnetToken,
      tokenName: "USDT Token",
      multisenderAddress: EthersWallet.createRandom().address,
    });
    sessionIds.push(s._id);
    if (seed) await Session.update(s._id, { masterMnemonic: seed });
    await Wallet.insertMany(
      wallets.map((w, i) => ({
        sessionId: s._id,
        index: i,
        address: w.address,
        derivationPath: w.path,
        amount: 10,
        amountWei: "10000000000000000000",
        packedHex: "0x",
        sent: true,
        failed: false,
      }))
    );
    return s._id;
  }

  beforeAll(async () => {
    process.env.MANAGED_WALLETS_ENABLED = "true";
    process.env.WALLET_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    const capture = (...args: unknown[]) => void logLines.push(args.map(String).join(" "));
    vi.spyOn(console, "log").mockImplementation(capture);
    vi.spyOn(console, "error").mockImplementation(capture);
    vi.spyOn(console, "warn").mockImplementation(capture);
    await db.connect();
    await db.query(`INSERT INTO users (id, email, name, role) VALUES ($1, $2, 'Session Import Test', 'ADMIN')`, [
      adminId,
      `session-import-${adminId}@example.test`,
    ]);
    const created = await createPool(adminId, { name: "Import test pool", network: "bscTestnet", privateKey: EthersWallet.createRandom().privateKey });
    poolId = created.pool.id;
    poolIds.push(poolId);
  });

  afterAll(async () => {
    if (sessionIds.length) {
      await db.query("DELETE FROM wallets WHERE session_id = ANY($1::text[])", [sessionIds]);
      await db.query("DELETE FROM session_audits WHERE session_id = ANY($1::text[])", [sessionIds]);
      await db.query("DELETE FROM distribution_sessions WHERE id = ANY($1::text[])", [sessionIds]);
    }
    for (const id of poolIds) {
      await db.query("DELETE FROM managed_audits WHERE pool_id = $1", [id]);
      await db.query("DELETE FROM managed_pools WHERE id = $1", [id]);
    }
    await db.query("DELETE FROM managed_audits WHERE user_id = $1", [adminId]);
    await db.query("DELETE FROM users WHERE id = $1", [adminId]);
    await db.end();
    fs.rmSync(scriptsDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("HD session: rebuilds keys from the session seed (standard and legacy paths), skips the unknown one", async () => {
    const sessionId = await newSession(
      "bscTestnet",
      [
        { address: standard.deriveChild(0).address, path: "m/44'/60'/0'/0/0" },
        { address: standard.deriveChild(1).address, path: "m/44'/60'/0'/0/1" },
        { address: legacy.deriveChild(2).address, path: "m/44'/60'/0'/0/2" },
        { address: stranger.address, path: "m/44'/60'/0'/0/3" },
      ],
      phrase
    );

    const listed = await listImportableSessions(adminId, poolId);
    expect(listed.sessions.find((s) => s.id === sessionId)).toMatchObject({ walletCount: 4, mode: "HD", hasSeed: true, inThisPool: 0 });

    const preview = await previewSessionImport(adminId, poolId, { sessionId });
    expect(preview).toMatchObject({ total: 4, importable: 3, keysUnavailable: 1, alreadyInPool: 0, keySource: "SESSION_SEED" });

    const result = await importSessionWallets(adminId, poolId, { sessionId });
    expect(result).toMatchObject({ imported: 3, alreadyInPool: 0, keysUnavailable: 1 });

    const rows = await db.query(
      `SELECT id, address, label, key_source, key_ciphertext FROM managed_wallets
        WHERE pool_id = $1 AND derivation_index BETWEEN $2 AND $3 ORDER BY derivation_index`,
      [poolId, result.fromIndex, result.toIndex]
    );
    expect(rows.rows).toHaveLength(3);
    expect(rows.rows.map((r) => r.key_source)).toEqual(["IMPORTED", "IMPORTED", "IMPORTED"]);
    expect(rows.rows[2].label).toBe(`Session ${sessionId.slice(-12)} #2 (imported)`);

    // Each stored key decrypts (AAD = wallet id) to the key of exactly that address.
    for (const r of rows.rows) {
      const key = await vaultPort.decryptWalletKey!(r.id);
      expect(new EthersWallet(key).address).toBe(r.address);
      expect(r.key_ciphertext).not.toContain(key.slice(2));
    }

    // The audit records counts only, never key material.
    const audit = await db.query(
      "SELECT details FROM managed_audits WHERE pool_id = $1 AND action = 'WALLETS_IMPORTED' ORDER BY created_at DESC LIMIT 1",
      [poolId]
    );
    expect(audit.rows[0].details).toMatchObject({ sessionId, count: 3, keySource: "SESSION_SEED", skippedNoKey: 1 });
    expect(JSON.stringify(audit.rows[0].details)).not.toMatch(/[0-9a-f]{64}/i);
    expect(logLines.join("\n")).not.toContain(standard.deriveChild(0).privateKey.slice(2));

    // Importing again adds nothing.
    const again = await importSessionWallets(adminId, poolId, { sessionId });
    expect(again).toMatchObject({ imported: 0, alreadyInPool: 3, keysUnavailable: 1 });
  });

  it("Independent session: takes keys from output/wallets.csv only when they match the address", async () => {
    const a = EthersWallet.createRandom();
    const b = EthersWallet.createRandom();
    const c = EthersWallet.createRandom();
    const sessionId = await newSession("bscTestnet", [
      { address: a.address, path: "independent" },
      { address: b.address, path: "independent" },
      { address: c.address, path: "independent" },
    ]);
    fs.mkdirSync(path.join(scriptsDir, "output"), { recursive: true });
    fs.writeFileSync(
      path.join(scriptsDir, "output", "wallets.csv"),
      [
        "index,address,privateKey,mnemonic,derivationPath",
        `0,${a.address},${a.privateKey},"${a.mnemonic!.phrase}",independent`,
        `1,${b.address},${b.privateKey},"${b.mnemonic!.phrase}",independent`,
        // A key that belongs to someone else must be rejected.
        `2,${c.address},${a.privateKey},"x",independent`,
      ].join("\n")
    );

    const result = await importSessionWallets(adminId, poolId, { sessionId });
    expect(result).toMatchObject({ imported: 2, keysUnavailable: 1, keySource: "WALLETS_CSV" });
  });

  it("a pool on another network is refused; the route needs a fresh re-auth", async () => {
    const mainnetPool = await createPool(adminId, { name: "Mainnet import pool", network: "bscMainnet", privateKey: EthersWallet.createRandom().privateKey });
    poolIds.push(mainnetPool.pool.id);
    const sessionId = await newSession("bscTestnet", [{ address: EthersWallet.createRandom().address, path: "independent" }]);
    await expect(previewSessionImport(adminId, mainnetPool.pool.id, { sessionId })).rejects.toMatchObject({ code: "POOL_NETWORK_MISMATCH" });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const r = req as express.Request & { user?: Express.User; isAuthenticated: () => boolean; session?: unknown };
      r.user = { _id: adminId, email: "x@example.test", name: "Admin", role: "ADMIN" } as Express.User;
      r.isAuthenticated = () => true;
      r.session = {};
      next();
    });
    mountManagedWallets(app);
    const res = await request(app).post(`/api/admin/managed/pools/${poolId}/import/session`).send({ sessionId });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("REAUTH_REQUIRED");
  });
});
