/**
 * Migration runner for backend/migrations/*.sql.
 *
 * - Applies every *.sql file in filename order, each inside its own transaction.
 * - Skips 0000_baseline.sql by name (documentation of the pre-existing schema).
 * - Records applied files in schema_migrations and skips them on later runs,
 *   so it is safe to re-run.
 * - Uses DATABASE_URL and the same ssl setting as src/lib/postgres.ts;
 *   set PGSSL=false for a local Postgres without TLS.
 * - Exits non-zero and names the failing file on error.
 *
 * Usage: `npm run migrate` (dist) or `npm run migrate:dev` (ts-node).
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { Client } from "pg";

const SKIPPED_FILES = new Set(["0000_baseline.sql"]);

/** Resolves to backend/migrations from both src/ (ts-node) and dist/ (build). */
const MIGRATIONS_DIR = path.resolve(__dirname, "..", "migrations");

function sslSetting(): false | { rejectUnauthorized: boolean } {
  if (process.env.PGSSL === "false") return false;
  return { rejectUnauthorized: false };
}

function listMigrationFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    throw new Error(`migrations directory not found: ${dir}`);
  }

  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".sql") && !SKIPPED_FILES.has(name))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export async function runMigrations(): Promise<{
  applied: string[];
  skipped: string[];
}> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  const client = new Client({
    connectionString: databaseUrl,
    ssl: sslSetting(),
    connectionTimeoutMillis: 10_000,
  });

  await client.connect();

  const applied: string[] = [];
  const skipped: string[] = [];

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name        TEXT PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const recorded = await client.query<{ name: string }>(
      "SELECT name FROM schema_migrations"
    );
    const already = new Set(recorded.rows.map((r) => r.name));

    for (const file of listMigrationFiles(MIGRATIONS_DIR)) {
      if (already.has(file)) {
        skipped.push(file);
        continue;
      }

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");

      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (name) VALUES ($1)",
          [file]
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`migration ${file} failed: ${message}`);
      }

      applied.push(file);
      console.log(`[migrate] applied ${file}`);
    }
  } finally {
    await client.end().catch(() => undefined);
  }

  return { applied, skipped };
}

if (require.main === module) {
  runMigrations()
    .then(({ applied, skipped }) => {
      if (skipped.length > 0) {
        console.log(`[migrate] already applied: ${skipped.join(", ")}`);
      }
      if (applied.length === 0) {
        console.log("[migrate] nothing to apply");
      } else {
        console.log(`[migrate] done, applied ${applied.length} file(s)`);
      }
      process.exit(0);
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[migrate] FAILED: ${message}`);
      process.exit(1);
    });
}
