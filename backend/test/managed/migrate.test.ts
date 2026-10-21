/**
 * N8 QA — src/migrate.ts re-run is a no-op on an already-migrated database.
 *
 * Runs against the throwaway database (0001 recorded in schema_migrations).
 * It only reads: nothing is applied, no table is dropped or created, and the
 * schema_migrations rows are byte-for-byte the same before and after.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "pg";

const TEST_DB_URL = "postgres://postgres:test@localhost:55432/managed_test?sslmode=disable";

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://postgres:test@localhost:55432/managed_test?sslmode=disable";
  process.env.PGSSL = "false";
});

import { runMigrations } from "../../src/migrate";

async function snapshot(client: Client): Promise<{ migrations: unknown[]; tables: string[] }> {
  const migrations = await client.query("SELECT name, applied_at FROM schema_migrations ORDER BY name");
  const tables = await client.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
  );
  return {
    migrations: migrations.rows.map((r) => ({ name: r.name, applied_at: String(r.applied_at) })),
    tables: tables.rows.map((r) => r.tablename as string),
  };
}

async function probe(): Promise<boolean> {
  const client = new Client({ connectionString: TEST_DB_URL, connectionTimeoutMillis: 3_000 });
  try {
    await client.connect();
    await client.query("SELECT 1 FROM schema_migrations LIMIT 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const dbAvailable = await probe();
if (!dbAvailable) {
  console.warn("[migrate.test] throwaway database not reachable at localhost:55432 — skipped");
}

describe.skipIf(!dbAvailable)("migrate.ts re-run", () => {
  const client = new Client({ connectionString: TEST_DB_URL });

  beforeAll(async () => {
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  it("applies nothing and records nothing when every migration is already applied", async () => {
    const before = await snapshot(client);
    expect(before.migrations.map((m) => (m as { name: string }).name)).toContain("0001_managed_wallets.sql");
    expect(before.tables).toEqual(
      expect.arrayContaining([
        "managed_pools",
        "managed_wallets",
        "managed_tokens",
        "managed_balances",
        "managed_master_balances",
        "managed_deposits",
        "managed_transfers",
        "managed_indexer_state",
        "managed_audits",
        "schema_migrations",
      ])
    );

    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const first = await runMigrations();
      expect(first.applied).toEqual([]);
      expect(first.skipped).toContain("0001_managed_wallets.sql");
      expect(first.skipped).not.toContain("0000_baseline.sql");

      const second = await runMigrations();
      expect(second).toEqual(first);
      expect(log).not.toHaveBeenCalled(); // "[migrate] applied …" is only printed for applied files
    } finally {
      log.mockRestore();
    }

    const after = await snapshot(client);
    expect(after).toEqual(before);
  });

  it("never lists 0000_baseline.sql as a candidate (documentation only)", async () => {
    const { applied, skipped } = await runMigrations();
    expect([...applied, ...skipped]).not.toContain("0000_baseline.sql");
  });
});
