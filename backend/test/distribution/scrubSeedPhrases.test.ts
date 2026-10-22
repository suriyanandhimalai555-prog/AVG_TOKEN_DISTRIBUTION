/**
 * migrations/0003_scrub_seed_phrases.sql — seed phrases (and bare private keys)
 * in wallets.derivation_path become 'independent'; paths are left alone.
 *
 * The Postgres case runs the real file against the throwaway database, inside
 * a transaction that is rolled back, on a TEMP table named wallets that
 * shadows public.wallets. public.wallets is checked to be unchanged.
 */
import fs from "fs";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const TEST_DB_URL = "postgres://postgres:test@localhost:55432/managed_test?sslmode=disable";
const MIGRATION_SQL = fs.readFileSync(
  path.resolve(__dirname, "../../migrations/0003_scrub_seed_phrases.sql"),
  "utf8"
);

const PHRASE_12 = "test test test test test test test test test test test junk";
const words = (n: number) => [...Array(n - 1).fill("abandon"), "art"].join(" ");
const POOL_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

/** [stored value, value after the migration] */
const CASES: Array<[string | null, string | null]> = [
  [`"${PHRASE_12}"`, "independent"], // what the bug stored: csvEscape's quotes kept
  [PHRASE_12, "independent"],
  [`"${words(15)}"`, "independent"],
  [`"${words(18)}"`, "independent"],
  [`"${words(21)}"`, "independent"],
  [`"${words(24)}"`, "independent"],
  ["0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", "independent"],
  ["m/44'/60'/0'/0/7", "m/44'/60'/0'/0/7"],
  [`pool:${POOL_ID}/3`, `pool:${POOL_ID}/3`],
  ["independent", "independent"],
  [words(11), words(11)], // too short for a BIP-39 phrase
  ["", ""],
  [null, null],
];

describe("0003 patterns (JS regex semantics)", () => {
  const patterns = [...MIGRATION_SQL.matchAll(/derivation_path ~ '([^']+)'/g)].map((m) => new RegExp(m[1]));

  it("finds both patterns in the migration", () => {
    expect(patterns).toHaveLength(2);
  });

  it.each(CASES.filter(([v]) => v !== null))("%j → %j", (value, expected) => {
    const scrubbed = patterns.some((p) => p.test(value as string));
    expect(scrubbed ? "independent" : value).toBe(expected);
  });
});

async function probe(): Promise<boolean> {
  const client = new Client({ connectionString: TEST_DB_URL, connectionTimeoutMillis: 3_000 });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const dbAvailable = await probe();
if (!dbAvailable) {
  console.warn("[scrubSeedPhrases.test] throwaway database not reachable at localhost:55432 — Postgres case skipped");
}

describe.skipIf(!dbAvailable)("0003_scrub_seed_phrases.sql on Postgres", () => {
  const client = new Client({ connectionString: TEST_DB_URL });

  const publicFingerprint = async () =>
    (
      await client.query(
        `SELECT count(*)::int AS n,
                md5(coalesce(string_agg(id || ':' || coalesce(derivation_path, '∅'), ',' ORDER BY id), '')) AS h
           FROM public.wallets`
      )
    ).rows[0];

  const tempRows = async () =>
    (await client.query("SELECT id, derivation_path FROM wallets ORDER BY id::int")).rows.map(
      (r) => r.derivation_path as string | null
    );

  beforeAll(async () => {
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  it("scrubs seed phrases and keys, keeps paths, and is idempotent", async () => {
    const publicBefore = await publicFingerprint();

    await client.query("BEGIN");
    try {
      await client.query("CREATE TEMP TABLE wallets (id TEXT PRIMARY KEY, derivation_path TEXT) ON COMMIT DROP");
      const schema = await client.query(
        "SELECT n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.oid = to_regclass('wallets')"
      );
      // Refuse to run the UPDATE unless `wallets` resolves to the temp table.
      expect(schema.rows[0].nspname).toMatch(/^pg_temp/);

      for (const [i, [value]] of CASES.entries()) {
        await client.query("INSERT INTO wallets (id, derivation_path) VALUES ($1, $2)", [String(i), value]);
      }

      await client.query(MIGRATION_SQL);
      const once = await tempRows();
      expect(once).toEqual(CASES.map(([, expected]) => expected));

      await client.query(MIGRATION_SQL);
      expect(await tempRows()).toEqual(once);
    } finally {
      await client.query("ROLLBACK");
    }

    expect(await publicFingerprint()).toEqual(publicBefore);
  });
});
