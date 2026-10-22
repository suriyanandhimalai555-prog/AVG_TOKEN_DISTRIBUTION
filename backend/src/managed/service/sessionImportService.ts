/**
 * Imports a distribution session's already-generated (and possibly funded)
 * wallets into a pool as IMPORTED wallets, so the pool shows their balances
 * and the master can sweep them.
 *
 * Keys are rebuilt server-side, never sent by the browser:
 *   - HD sessions: from the session's stored master mnemonic, at the standard
 *     path m/44'/60'/0'/0/i or the pre-d58b556 path (see
 *     scripts/recover-hd-wallets.ts);
 *   - otherwise: from output/wallets.csv, when it still holds this session.
 * A key is used only if it reproduces the wallet's exact address. Each key is
 * stored AES-256-GCM encrypted with AAD "managed-wallet:<walletId>".
 *
 * The pool secret is NOT a backup for imported wallets: their keys still come
 * from the session's seed / key files.
 */
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { HDNodeWallet, Mnemonic, Wallet, getAddress } from "ethers";
import { getScriptsDir } from "../../lib/runner";
import { Session, type ISession } from "../../models/Session";
import { encryptSecret } from "../keyVault";
import { maxWalletsPerPool, pools, type PoolRecord } from "../models/pools";
import { sessionImports, type ImportableSessionRow, type SessionWalletMode } from "../models/sessionImports";
import { importedKeyAad, wallets } from "../models/wallets";
import { recordManagedAudit } from "../audit";
import { managedLog } from "../redact";
import type { Network, PoolSummary } from "../types";
import { requireUuid, toPoolSummary } from "./common";
import { conflict, ManagedApiError, notFound } from "./errors";
import { refreshBalancesSoon } from "./indexerService";
import { requirePoolRecord } from "./poolService";
import { trackToken } from "./tokenService";

const STANDARD_ACCOUNT_PATH = "m/44'/60'/0'/0";
/** HD sessions generated before commit d58b556 (scripts/recover-hd-wallets.ts). */
const LEGACY_ACCOUNT_PATH = "m/44'/60'/0'/0/0/44'/60'/0'/0";

export type ImportKeySource = "SESSION_SEED" | "WALLETS_CSV" | "MIXED" | null;

export interface ImportableSession extends ImportableSessionRow {
  shortId: string;
}

export interface ListImportableSessionsResponse {
  network: Network;
  sessions: ImportableSession[];
}

export interface SessionImportPreview {
  sessionId: string;
  mode: SessionWalletMode;
  total: number;
  /** Wallets that will be added. */
  importable: number;
  alreadyInPool: number;
  inOtherPools: number;
  /** Wallets whose key could not be rebuilt (they are skipped). */
  keysUnavailable: number;
  keySource: ImportKeySource;
  remaining: number;
}

export interface SessionImportResponse extends SessionImportPreview {
  imported: number;
  fromIndex: number | null;
  toIndex: number | null;
  pool: PoolSummary;
}

interface ResolvedWallet {
  index: number;
  address: string;
  privateKey: string;
}

interface Resolution {
  session: ISession;
  pool: PoolRecord;
  preview: SessionImportPreview;
  toImport: ResolvedWallet[];
}

async function requireOwnSession(userId: string, sessionId: string): Promise<ISession> {
  const session = await Session.findById(sessionId);
  if (!session || !session.userId || String(session.userId) !== userId) {
    throw notFound("SESSION_NOT_FOUND", "Session not found");
  }
  return session;
}

function remainingSlots(pool: PoolRecord): number {
  return Math.max(0, maxWalletsPerPool() - (pool.nextIndex - 1));
}

/** Minimal CSV line split that honours double-quoted fields. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/** lowercase address → private key, from output/wallets.csv (header-aware). */
function keysFromWalletsCsv(): Map<string, string> {
  const keys = new Map<string, string>();
  const file = path.join(getScriptsDir(), "output", "wallets.csv");
  if (!fs.existsSync(file)) return keys;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return keys;
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const addrCol = header.indexOf("address");
  const keyCol = header.indexOf("privateKey");
  if (addrCol < 0 || keyCol < 0) return keys;
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line);
    const address = cols[addrCol]?.trim();
    const key = cols[keyCol]?.trim();
    if (address && key) keys.set(address.toLowerCase(), key);
  }
  return keys;
}

function keyMatches(privateKey: string, address: string): boolean {
  try {
    return new Wallet(privateKey).address.toLowerCase() === address.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Rebuilds the private key of every wallet in `targets`. Wallets whose key
 * cannot be rebuilt are left out (counted as keysUnavailable).
 */
function resolveKeys(
  session: ISession,
  targets: Array<{ index: number; address: string }>
): { resolved: ResolvedWallet[]; source: ImportKeySource } {
  const resolved: ResolvedWallet[] = [];
  let fromSeed = 0;
  let fromCsv = 0;
  let pending = targets;

  const phrase = session.masterMnemonic?.trim();
  if (phrase && Mnemonic.isValidMnemonic(phrase)) {
    const nodes = [STANDARD_ACCOUNT_PATH, LEGACY_ACCOUNT_PATH].map((p) => HDNodeWallet.fromPhrase(phrase, undefined, p));
    const unresolved: typeof targets = [];
    for (const t of pending) {
      let key: string | null = null;
      for (const node of nodes) {
        const child = node.deriveChild(t.index);
        if (child.address.toLowerCase() === t.address.toLowerCase()) {
          key = child.privateKey;
          break;
        }
      }
      if (key) {
        resolved.push({ index: t.index, address: t.address, privateKey: key });
        fromSeed++;
      } else {
        unresolved.push(t);
      }
    }
    pending = unresolved;
  }

  if (pending.length > 0) {
    const csvKeys = keysFromWalletsCsv();
    for (const t of pending) {
      const key = csvKeys.get(t.address.toLowerCase());
      if (key && keyMatches(key, t.address)) {
        resolved.push({ index: t.index, address: t.address, privateKey: key });
        fromCsv++;
      }
    }
    csvKeys.clear();
  }

  const source: ImportKeySource = fromSeed && fromCsv ? "MIXED" : fromSeed ? "SESSION_SEED" : fromCsv ? "WALLETS_CSV" : null;
  return { resolved, source };
}

async function resolve(userId: string, poolId: string, body: unknown): Promise<Resolution> {
  const sessionId = requireUuid((body as { sessionId?: unknown } | undefined)?.sessionId, "sessionId");
  const pool = await requirePoolRecord(poolId);
  if (pool.status !== "ACTIVE") throw conflict("POOL_ARCHIVED", "Pool is archived");
  const session = await requireOwnSession(userId, sessionId);
  if (session.network !== pool.network) {
    throw conflict(
      "POOL_NETWORK_MISMATCH",
      `This session distributed on ${session.network}; the pool is on ${pool.network}.`
    );
  }

  const rows = await sessionImports.walletsOf(sessionId);
  const owners = await wallets.findPoolsByAddresses(rows.map((r) => r.address));
  let alreadyInPool = 0;
  let inOtherPools = 0;
  const candidates: Array<{ index: number; address: string }> = [];
  for (const r of rows) {
    const owner = owners.get(r.address.toLowerCase());
    if (owner === pool.id) alreadyInPool++;
    else if (owner) inOtherPools++;
    else candidates.push({ index: r.index, address: r.address });
  }

  const { resolved, source } = resolveKeys(session, candidates);
  const mode: SessionWalletMode = rows.some((r) => r.pathKind === "POOL")
    ? "POOL"
    : rows.some((r) => r.pathKind === "STANDARD_HD")
      ? "HD"
      : "INDEPENDENT";

  return {
    session,
    pool,
    toImport: resolved.sort((a, b) => a.index - b.index),
    preview: {
      sessionId,
      mode,
      total: rows.length,
      importable: resolved.length,
      alreadyInPool,
      inOtherPools,
      keysUnavailable: candidates.length - resolved.length,
      keySource: source,
      remaining: remainingSlots(pool),
    },
  };
}

/** The admin's own distribution sessions on the pool's network, newest first. */
export async function listImportableSessions(userId: string, poolId: string): Promise<ListImportableSessionsResponse> {
  const pool = await requirePoolRecord(poolId);
  const rows = await sessionImports.listForUser(userId, pool.network, pool.id);
  return { network: pool.network, sessions: rows.map((r) => ({ ...r, shortId: r.id.slice(-12) })) };
}

/** What an import would do. Writes nothing and returns no key material. */
export async function previewSessionImport(userId: string, poolId: string, body: unknown): Promise<SessionImportPreview> {
  const { preview, toImport } = await resolve(userId, poolId, body);
  toImport.length = 0;
  return preview;
}

export async function importSessionWallets(userId: string, poolId: string, body: unknown): Promise<SessionImportResponse> {
  const { session, pool, preview, toImport } = await resolve(userId, poolId, body);

  if (toImport.length === 0) {
    return { ...preview, imported: 0, fromIndex: null, toIndex: null, pool: toPoolSummary(pool) };
  }
  if (toImport.length > preview.remaining) {
    throw conflict(
      "POOL_LIMIT_REACHED",
      `The pool has room for ${preview.remaining} more wallets; this session has ${toImport.length} to import.`
    );
  }

  const range = await pools.reserveIndexes(pool.id, toImport.length);
  const shortId = session._id.slice(-12);
  let created: Array<{ id: string; derivationIndex: number; address: string }>;
  try {
    const rows = toImport.map((w, i) => {
      const id = randomUUID();
      return {
        id,
        poolId: pool.id,
        derivationIndex: range.from + i,
        address: getAddress(w.address),
        label: `Session ${shortId} #${w.index} (imported)`,
        key: encryptSecret(w.privateKey, importedKeyAad(id)),
      };
    });
    created = await wallets.insertImported(rows);
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      throw conflict("ALREADY_IMPORTED", "Some of these wallets were just added to a pool; refresh and try again");
    }
    throw err;
  } finally {
    for (const w of toImport) w.privateKey = "";
    toImport.length = 0;
  }

  const fromIndex = range.from;
  const toIndex = range.to - 1;
  await recordManagedAudit({
    userId,
    poolId: pool.id,
    action: "WALLETS_IMPORTED",
    details: {
      sessionId: session._id,
      count: created.length,
      fromIndex,
      toIndex,
      keySource: preview.keySource,
      skippedInPool: preview.alreadyInPool,
      skippedOtherPools: preview.inOtherPools,
      skippedNoKey: preview.keysUnavailable,
    },
  });

  // Make sure the session's token is listed in the pool; best effort.
  try {
    await trackToken(userId, { network: session.network, tokenAddress: session.tokenAddress });
  } catch (err) {
    if (!(err instanceof ManagedApiError && err.code === "ALREADY_TRACKED")) {
      managedLog("warn", "session token not tracked on import", { network: session.network, error: err });
    }
  }
  refreshBalancesSoon(pool.network);

  const fresh = await pools.findById(pool.id);
  return {
    ...preview,
    importable: 0,
    imported: created.length,
    fromIndex,
    toIndex,
    remaining: fresh ? remainingSlots(fresh) : preview.remaining - created.length,
    pool: toPoolSummary(fresh ?? pool),
  };
}
