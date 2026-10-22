/**
 * Rebuild the wallets of a PRIVATE_KEY managed pool from the private key alone.
 *
 * Offline: no database, no network. The key is read from a file (never from the
 * command line, so it does not end up in shell history).
 *
 * Usage (from backend/):
 *   npx ts-node scripts/managed/derive-from-key.ts --key-file <file> --count <n>
 *       Prints the master address and managed wallet addresses 1..n.
 *   npx ts-node scripts/managed/derive-from-key.ts --key-file <file> --count <n> --with-keys [--out <dir>]
 *       Also writes <out>/derived-<master>-<timestamp>.csv with private keys (mode 0600, never overwrites).
 *   Add --account <n> for the n-th pool made from the same key (pool settings show its account;
 *   the first pool is account 0, the default).
 *
 * Derivation (must match src/managed/derive.ts): master = the key itself;
 * wallet i = BIP-32 seed HMAC-SHA512("HolderForge managed wallets v1", key) at m/44'/60'/<account>'/0/i.
 */
import * as fs from "fs";
import * as path from "path";
import { accountPathFor, addressesForSecret, childSignerFor, masterSignerFor, normalizePrivateKey } from "../../src/managed/derive";

interface Args {
  keyFile: string;
  count: number;
  withKeys: boolean;
  outDir: string;
  account: number;
}

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = { withKeys: false, outDir: path.resolve(__dirname, "../../output/recovery"), account: 0 };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (!v || v.startsWith("--")) throw new Error(`${flag} needs a value`);
      return v;
    };
    switch (flag) {
      case "--key-file": args.keyFile = next(); break;
      case "--count": args.count = Number(next()); break;
      case "--with-keys": args.withKeys = true; break;
      case "--out": args.outDir = path.resolve(next()); break;
      case "--account": args.account = Number(next()); break;
      default: throw new Error(`Unknown argument: ${flag}`);
    }
  }
  if (!args.keyFile) throw new Error("--key-file <file> is required");
  if (!Number.isInteger(args.account) || (args.account ?? -1) < 0) throw new Error("--account <n> must be a whole number >= 0");
  if (!Number.isInteger(args.count) || (args.count ?? 0) < 1 || (args.count ?? 0) > 100_000) {
    throw new Error("--count <n> must be an integer from 1 to 100000");
  }
  return args as Args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const key = normalizePrivateKey(fs.readFileSync(path.resolve(args.keyFile), "utf8"));
  if (!key) throw new Error("The key file does not contain a valid private key (64 hex characters)");

  const accountPath = accountPathFor(args.account);
  const master = masterSignerFor(key, "PRIVATE_KEY").address;
  console.log(`Master (pool index 0): ${master}`);
  console.log(`Account: ${args.account} (${accountPath})`);
  const rows = addressesForSecret(key, "PRIVATE_KEY", 1, args.count + 1, accountPath);
  for (const r of rows) console.log(`${String(r.index).padStart(6)}  ${r.address}`);

  if (!args.withKeys) return;
  const lines = ["index,address,privateKey,derivation"];
  lines.push(`0,${master},${key},imported key (master)`);
  for (const r of rows) {
    lines.push(`${r.index},${r.address},${childSignerFor(key, "PRIVATE_KEY", r.index, accountPath).privateKey},hmac-seed ${accountPath}/${r.index}`);
  }
  fs.mkdirSync(args.outDir, { recursive: true, mode: 0o700 });
  const file = path.join(args.outDir, `derived-${master.slice(2, 10)}-${Date.now()}.csv`);
  fs.writeFileSync(file, lines.join("\n") + "\n", { encoding: "utf8", mode: 0o600, flag: "wx" });
  console.log(`\nPrivate keys written to ${file} (readable only by you). Keep it offline and delete it when done.`);
}

try {
  main();
} catch (err) {
  console.error("derive-from-key failed:", err instanceof Error ? err.message : err);
  process.exit(1);
}
