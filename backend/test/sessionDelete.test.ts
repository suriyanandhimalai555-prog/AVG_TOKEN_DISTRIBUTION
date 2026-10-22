/**
 * Deleting a distribution session that has audit history.
 *
 * Production had a foreign key session_audits.session_id → distribution_sessions
 * that 0000_baseline.sql does not declare, so DELETE /api/sessions/:id failed
 * with 23503 for every session with history (and the SESSION_DELETED audit it
 * writes afterwards could not be stored). Migration 0005 drops any such key.
 *
 * Runs in a private schema on the throwaway database, so the shared tables
 * other suites use in parallel are never altered.
 */
import { randomBytes } from "crypto";
import fs from "fs";
import path from "path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_URL = "postgres://postgres:test@localhost:55432/managed_test?sslmode=disable";
const MIGRATION = fs.readFileSync(path.join(__dirname, "..", "migrations", "0005_session_audits_keep_history.sql"), "utf8");

async function probeDb(): Promise<boolean> {
  const client = new Client({ connectionString: TEST_DB_URL, connectionTimeoutMillis: 3_000 });
  try {
    await client.connect();
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const dbAvailable = await probeDb();

describe.skipIf(!dbAvailable)("migration 0005: deleting a session with audit history", () => {
  const db = new Client({ connectionString: TEST_DB_URL });
  const schema = `fk_test_${randomBytes(4).toString("hex")}`;

  beforeAll(async () => {
    await db.connect();
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET search_path TO ${schema}`);
    // The production shape: the baseline tables plus the stray foreign key.
    await db.query(`CREATE TABLE distribution_sessions (id TEXT PRIMARY KEY)`);
    await db.query(`
      CREATE TABLE session_audits (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL,
        session_id  TEXT NOT NULL,
        action      TEXT NOT NULL,
        CONSTRAINT session_audits_session_id_fkey FOREIGN KEY (session_id) REFERENCES distribution_sessions(id)
      )`);
  });

  afterAll(async () => {
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db.end();
  });

  it("the stray key blocks the delete; after 0005 the session goes and its history stays", async () => {
    await db.query(`INSERT INTO distribution_sessions (id) VALUES ('s1')`);
    await db.query(`INSERT INTO session_audits (id, user_id, session_id, action) VALUES ('a1', 'u1', 's1', 'GENERATE_STARTED')`);

    await expect(db.query(`DELETE FROM distribution_sessions WHERE id = 's1'`)).rejects.toMatchObject({ code: "23503" });

    await db.query(MIGRATION);
    await db.query(MIGRATION); // idempotent

    const keys = await db.query(
      `SELECT conname FROM pg_constraint
        WHERE contype = 'f' AND conrelid = 'session_audits'::regclass AND confrelid = 'distribution_sessions'::regclass`
    );
    expect(keys.rows).toHaveLength(0);

    await db.query(`DELETE FROM distribution_sessions WHERE id = 's1'`);
    await db.query(`INSERT INTO session_audits (id, user_id, session_id, action) VALUES ('a2', 'u1', 's1', 'SESSION_DELETED')`);
    const history = await db.query(`SELECT action FROM session_audits WHERE session_id = 's1' ORDER BY id`);
    expect(history.rows.map((r) => r.action)).toEqual(["GENERATE_STARTED", "SESSION_DELETED"]);
  });
});
