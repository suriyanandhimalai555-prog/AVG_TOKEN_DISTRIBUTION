/**
 * Discovered tokens (anything sent to a managed wallet, mostly spam airdrops)
 * start hidden; tracking a token shows it; migration 0007 hides the tokens
 * discovered before, and ZEC whatever its source.
 *
 * Throwaway database only. The migration runs in a private schema so the
 * shared managed_tokens table other suites use is never altered by it.
 */
import { randomBytes } from "crypto";
import fs from "fs";
import path from "path";
import { Wallet } from "ethers";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TEST_DB_URL = "postgres://postgres:test@localhost:55432/managed_test?sslmode=disable";

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://postgres:test@localhost:55432/managed_test?sslmode=disable";
  process.env.PGSSL = "false";
});

import { tokens } from "../../src/managed/models/tokens";

const MIGRATION = fs.readFileSync(path.join(__dirname, "..", "..", "migrations", "0007_hide_discovered_tokens.sql"), "utf8");

async function probeDb(): Promise<boolean> {
  const client = new Client({ connectionString: TEST_DB_URL, connectionTimeoutMillis: 3_000 });
  try {
    await client.connect();
    await client.query("SELECT hidden FROM managed_tokens LIMIT 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const dbAvailable = await probeDb();

describe.skipIf(!dbAvailable)("hidden discovered tokens", () => {
  const db = new Client({ connectionString: TEST_DB_URL });
  const schema = `tok_test_${randomBytes(4).toString("hex")}`;
  const addresses: string[] = [];

  beforeAll(async () => {
    await db.connect();
  });

  afterAll(async () => {
    if (addresses.length) await db.query("DELETE FROM managed_tokens WHERE token_address = ANY($1::text[])", [addresses]);
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db.end();
  });

  it("a token the indexer discovers starts hidden; tracking it shows it", async () => {
    const address = Wallet.createRandom().address.toLowerCase();
    addresses.push(address);

    const discovered = await tokens.upsertDiscovered({ network: "bscTestnet", tokenAddress: address, symbol: "SPAM", name: "Spam", decimals: 18 });
    expect(discovered).toMatchObject({ source: "DISCOVERED", hidden: true });

    const tracked = await tokens.insertTracked({ network: "bscTestnet", tokenAddress: address, symbol: "REAL", name: "Real", decimals: 18 });
    expect(tracked.created).toBe(false);
    expect(tracked.token).toMatchObject({ source: "TRACKED", hidden: false, symbol: "REAL" });

    // A later sighting does not hide it again.
    const seenAgain = await tokens.upsertDiscovered({ network: "bscTestnet", tokenAddress: address, symbol: "SPAM", name: "Spam", decimals: 18 });
    expect(seenAgain).toMatchObject({ source: "TRACKED", hidden: false });
  });

  it("0007 hides discovered tokens and ZEC, keeps tracked ones, and is idempotent", async () => {
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET search_path TO ${schema}`);
    await db.query(`CREATE TABLE managed_tokens (symbol TEXT NOT NULL, source TEXT NOT NULL, hidden BOOLEAN NOT NULL)`);
    await db.query(`
      INSERT INTO managed_tokens (symbol, source, hidden) VALUES
        ('SPAM', 'DISCOVERED', FALSE),
        ('ZEC',  'DISCOVERED', FALSE),
        ('zec',  'TRACKED',    FALSE),
        ('USDT', 'TRACKED',    FALSE),
        ('AVG',  'TRACKED',    FALSE),
        ('OLD',  'DISCOVERED', TRUE)`);

    await db.query(MIGRATION);
    await db.query(MIGRATION);

    const rows = await db.query(`SELECT symbol, hidden FROM managed_tokens ORDER BY symbol`);
    expect(Object.fromEntries(rows.rows.map((r) => [r.symbol, r.hidden]))).toEqual({
      AVG: false,
      OLD: true,
      SPAM: true,
      USDT: false,
      ZEC: true,
      zec: true,
    });
    await db.query(`SET search_path TO public`);
  });
});
