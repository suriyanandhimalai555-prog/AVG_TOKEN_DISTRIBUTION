import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";
import { Pool } from "pg";

/**
 * Recover private keys for HD_SINGLE_SEED sessions generated before commit d58b556.
 *
 * Those wallets were derived at the NON-standard path
 *   m/44'/60'/0'/0/0/44'/60'/0'/0/<i>
 * (HDNodeWallet.fromPhrase() returned m/44'/60'/0'/0/0 and a relative derivePath was
 * applied on top), so importing the master mnemonic into MetaMask shows empty wallets.
 * The funds are safe — this script re-derives each key from the stored mnemonic and
 * only trusts it if it reproduces the address saved in the `wallets` table.
 *
 * READ-ONLY against the database. Output files contain PRIVATE KEYS (mode 0600).
 *
 * Usage (from backend/):
 *   npm run recover:hd -- --scan
 *       List sessions that have a master mnemonic and classify them (no secrets printed).
 *   npm run recover:hd -- --session <id> [--session <id> ...] [--out <dir>]
 *       Write <out>/<sessionId>.csv with index,address,privateKey,... for affected sessions.
 *   npm run recover:hd -- --mnemonic-file <file> --count <n> [--out <dir>]
 *       Offline mode (no database): derive the first n old-path wallets from a mnemonic file.
 *
 * Env: DATABASE_URL (same as the API). Set PGSSL=false for a local Postgres without TLS.
 */

const OLD_ACCOUNT_PATH = "m/44'/60'/0'/0/0/44'/60'/0'/0";
const STANDARD_ACCOUNT_PATH = "m/44'/60'/0'/0";
const DEFAULT_OUT_DIR = path.resolve(__dirname, "../output/recovery");
/** Wallets checked per session in --scan mode to classify it. */
const SCAN_SAMPLE = 3;
const LOG_EVERY = 5_000;

type Classification =
  | "OLD_PATH_NEEDS_RECOVERY"
  | "STANDARD_PATH_OK"
  | "MNEMONIC_DOES_NOT_MATCH"
  | "NO_WALLETS";

interface Args {
  scan: boolean;
  sessions: string[];
  mnemonicFile?: string;
  count?: number;
  outDir: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { scan: false, sessions: [], outDir: DEFAULT_OUT_DIR };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (!v || v.startsWith("--")) throw new Error(`${flag} needs a value`);
      return v;
    };
    switch (flag) {
      case "--scan":          args.scan = true; break;
      case "--session":       args.sessions.push(next()); break;
      case "--mnemonic-file": args.mnemonicFile = next(); break;
      case "--count":         args.count = parseInt(next(), 10); break;
      case "--out":           args.outDir = path.resolve(next()); break;
      default: throw new Error(`Unknown argument: ${flag}`);
    }
  }
  const modes = [args.scan, args.sessions.length > 0, Boolean(args.mnemonicFile)].filter(Boolean).length;
  if (modes !== 1) {
    throw new Error("Pick exactly one mode: --scan, --session <id>, or --mnemonic-file <file> --count <n>");
  }
  if (args.mnemonicFile && (!Number.isFinite(args.count) || (args.count ?? 0) < 1)) {
    throw new Error("--mnemonic-file requires --count <n> (n ≥ 1)");
  }
  return args;
}

function accountNode(mnemonic: string, accountPath: string): ethers.HDNodeWallet {
  return ethers.HDNodeWallet.fromPhrase(mnemonic.trim(), undefined, accountPath);
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set (put it in backend/.env or the environment)");
  return new Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: 10_000,
    // Same TLS settings as src/lib/postgres.ts; PGSSL=false only for local testing.
    ssl: process.env.PGSSL === "false" ? false : { rejectUnauthorized: false },
  });
}

/** Writes a file only the current user can read; refuses to overwrite. */
function writeSecretFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
}

function classify(
  mnemonic: string | null,
  sample: Array<{ wallet_index: number; address: string }>
): Classification {
  if (sample.length === 0) return "NO_WALLETS";
  if (!mnemonic || !ethers.Mnemonic.isValidMnemonic(mnemonic.trim())) return "MNEMONIC_DOES_NOT_MATCH";
  const oldNode = accountNode(mnemonic, OLD_ACCOUNT_PATH);
  const stdNode = accountNode(mnemonic, STANDARD_ACCOUNT_PATH);
  const same = (node: ethers.HDNodeWallet) =>
    sample.every((w) => node.deriveChild(w.wallet_index).address.toLowerCase() === w.address.toLowerCase());
  if (same(oldNode)) return "OLD_PATH_NEEDS_RECOVERY";
  if (same(stdNode)) return "STANDARD_PATH_OK";
  // Typically an INDEPENDENT_SEEDS session that stored a stale MASTER_MNEMONIC.txt.
  return "MNEMONIC_DOES_NOT_MATCH";
}

async function scan(pool: Pool): Promise<void> {
  const { rows: sessions } = await pool.query(
    `
      SELECT s.id, s.master_mnemonic, s.total_wallets, s.network, s.status, s.created_at, u.email
      FROM distribution_sessions s
      LEFT JOIN users u ON u.id = s.user_id
      WHERE s.master_mnemonic IS NOT NULL AND s.master_mnemonic <> ''
      ORDER BY s.created_at ASC
    `
  );

  console.log(`Sessions with a stored master mnemonic: ${sessions.length}\n`);
  const counts: Record<Classification, number> = {
    OLD_PATH_NEEDS_RECOVERY: 0,
    STANDARD_PATH_OK: 0,
    MNEMONIC_DOES_NOT_MATCH: 0,
    NO_WALLETS: 0,
  };

  for (const s of sessions) {
    const { rows: sample } = await pool.query(
      `SELECT wallet_index, address FROM wallets WHERE session_id = $1 ORDER BY wallet_index ASC LIMIT $2`,
      [s.id, SCAN_SAMPLE]
    );
    const result = classify(s.master_mnemonic, sample);
    counts[result]++;
    console.log(
      [
        result.padEnd(24),
        s.id,
        s.email ?? "(no user)",
        s.network,
        `${s.total_wallets} wallets`,
        s.status,
        new Date(s.created_at).toISOString(),
      ].join(" | ")
    );
  }

  console.log("\nSummary:");
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(24)} ${v}`);
  if (counts.OLD_PATH_NEEDS_RECOVERY > 0) {
    console.log("\nNext: npm run recover:hd -- --session <id>   (for each OLD_PATH_NEEDS_RECOVERY row)");
  }
}

async function recoverSession(pool: Pool, sessionId: string, outDir: string): Promise<boolean> {
  const { rows: found } = await pool.query(
    `SELECT id, master_mnemonic, network, token_address FROM distribution_sessions WHERE id = $1`,
    [sessionId]
  );
  const session = found[0];
  if (!session) {
    console.error(`[${sessionId}] session not found`);
    return false;
  }

  const { rows: wallets } = await pool.query(
    `SELECT wallet_index, address, sent, tx_hash FROM wallets WHERE session_id = $1 ORDER BY wallet_index ASC`,
    [sessionId]
  );

  const kind = classify(session.master_mnemonic, wallets.slice(0, SCAN_SAMPLE));
  if (kind !== "OLD_PATH_NEEDS_RECOVERY") {
    console.error(`[${sessionId}] ${kind} — nothing to recover with the old HD path, skipping`);
    return false;
  }

  console.log(`[${sessionId}] deriving ${wallets.length.toLocaleString()} keys (network=${session.network})...`);
  const node = accountNode(session.master_mnemonic, OLD_ACCOUNT_PATH);
  const lines = ["index,address,privateKey,derivationPath,sent,txHash,network,tokenAddress"];
  let mismatches = 0;

  for (let n = 0; n < wallets.length; n++) {
    const w = wallets[n];
    const child = node.deriveChild(w.wallet_index);
    if (child.address.toLowerCase() !== String(w.address).toLowerCase()) {
      mismatches++;
      console.error(`[${sessionId}] index ${w.wallet_index}: derived ${child.address} ≠ stored ${w.address} — key omitted`);
      continue;
    }
    lines.push(
      [
        w.wallet_index,
        w.address,
        child.privateKey,
        `${OLD_ACCOUNT_PATH}/${w.wallet_index}`,
        w.sent ? "true" : "false",
        w.tx_hash ?? "",
        session.network,
        session.token_address,
      ].join(",")
    );
    if ((n + 1) % LOG_EVERY === 0) console.log(`  ${(n + 1).toLocaleString()} / ${wallets.length.toLocaleString()}`);
  }

  const outFile = path.join(outDir, `${sessionId}.csv`);
  writeSecretFile(outFile, lines.join("\n") + "\n");
  console.log(
    `[${sessionId}] recovered ${(lines.length - 1).toLocaleString()} keys, ${mismatches} mismatches → ${outFile}`
  );
  return mismatches === 0;
}

function recoverOffline(mnemonicFile: string, count: number, outDir: string): void {
  const mnemonic = fs.readFileSync(path.resolve(mnemonicFile), "utf8").trim();
  if (!ethers.Mnemonic.isValidMnemonic(mnemonic)) throw new Error("File does not contain a valid BIP-39 mnemonic");

  const node = accountNode(mnemonic, OLD_ACCOUNT_PATH);
  const lines = ["index,address,privateKey,derivationPath"];
  for (let i = 0; i < count; i++) {
    const child = node.deriveChild(i);
    lines.push([i, child.address, child.privateKey, `${OLD_ACCOUNT_PATH}/${i}`].join(","));
  }

  const outFile = path.join(outDir, `offline-${Date.now()}.csv`);
  writeSecretFile(outFile, lines.join("\n") + "\n");
  console.log(`Derived ${count.toLocaleString()} old-path wallets → ${outFile}`);
  console.log("Compare these addresses with the customer's report before handing over any key.");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.mnemonicFile) {
    recoverOffline(args.mnemonicFile, args.count!, args.outDir);
    return;
  }

  const pool = createPool();
  try {
    if (args.scan) {
      await scan(pool);
      return;
    }
    let allClean = true;
    for (const id of args.sessions) {
      allClean = (await recoverSession(pool, id, args.outDir)) && allClean;
    }
    if (!allClean) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error("recover-hd-wallets failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
