/**
 * Wires a distribution session (Setup → Generate → Prepare → Distribute) to
 * the Managed Wallets pool whose master is the session's signing wallet.
 *
 * "Pool wallets" generation allocates the session's recipient wallets from
 * that pool instead of creating fresh random keys. Prepare and Distribute are
 * unchanged (they only read index + address from output/wallets.csv), so the
 * tokens they send land in pool wallets: the indexer records the deposits,
 * the pool shows the balances, and the master can sweep them back.
 *
 * No private key of a pool wallet is ever written to disk here: the CSV's
 * privateKey column stays empty because the pool secret already controls
 * every wallet.
 */
import fs from "fs";
import path from "path";
import { ethers } from "ethers";
import { getScriptsDir, isRunning } from "../../lib/runner";
import { recordSessionAudit } from "../../lib/sessionAudit";
import { Session, type ISession } from "../../models/Session";
import { Wallet } from "../../models/Wallet";
import { normalizePrivateKey } from "../derive";
import { maxWalletsPerPool, pools, type PoolRecord } from "../models/pools";
import { sessionPools } from "../models/sessionPools";
import { accountNumberOf } from "../derive";
import { managedLog } from "../redact";
import type { Network, PoolSummary } from "../types";
import { requireString, toPoolSummary } from "./common";
import { badRequest, conflict, ManagedApiError, notFound } from "./errors";
import { refreshBalancesSoon } from "./indexerService";
import { trackToken } from "./tokenService";
import { generateWallets } from "./walletService";

export interface SessionPoolMatch {
  sessionId: string;
  network: Network;
  /** Address of the session's signing wallet (the would-be pool master). */
  signingAddress: string;
  /**
   * The pool generation would use: the one picked (poolId), else the one
   * linked to this session (created for it from Setup, or used before), else
   * the newest pool of the signing wallet on the session's network.
   */
  pool: PoolSummary | null;
  /** Every ACTIVE pool of the signing wallet on the session's network, oldest first. */
  candidates: Array<PoolSummary & { account: number | null }>;
  /** Pool recorded for this session, if any. */
  linkedPoolId: string | null;
  /** Why `pool` is null or cannot be used, for the Generate page hint. */
  reason: "NO_POOL" | "NETWORK_MISMATCH" | "POOL_ARCHIVED" | "POOL_FULL" | null;
  /** Free wallet slots left in the pool. */
  remaining: number;
  /** Wallets this session needs. */
  needed: number;
}

export interface SessionPoolGenerateResponse {
  status: "done";
  sessionId: string;
  pool: PoolSummary;
  created: number;
  fromIndex: number;
  toIndex: number;
}

async function requireOwnSession(userId: string, sessionId: string): Promise<ISession> {
  const session = await Session.findById(sessionId);
  // Same 404 for "missing" and "someone else's", as the core session routes do.
  if (!session || !session.userId || String(session.userId) !== userId) {
    throw notFound("SESSION_NOT_FOUND", "Session not found");
  }
  return session;
}

function signingAddressFrom(body: unknown): string {
  const raw = requireString((body as { privateKey?: unknown } | undefined)?.privateKey, "privateKey", 200);
  const key = normalizePrivateKey(raw);
  if (!key) throw badRequest("INVALID_PRIVATE_KEY", "privateKey must be 64 hex characters");
  return new ethers.Wallet(key).address;
}

function remainingSlots(pool: PoolRecord): number {
  return Math.max(0, maxWalletsPerPool() - (pool.nextIndex - 1));
}

async function resolve(
  userId: string,
  sessionId: string,
  body: unknown
): Promise<{ session: ISession; match: SessionPoolMatch; record: PoolRecord | null }> {
  const session = await requireOwnSession(userId, sessionId);
  const signingAddress = signingAddressFrom(body);
  const requested = (body as { poolId?: unknown } | undefined)?.poolId;
  const needed = session.totalWallets;

  const all = await pools.listByMasterAddress(signingAddress);
  const candidates = all.filter((p) => p.network === session.network && p.status === "ACTIVE");
  const linkedPoolId = await sessionPools.poolIdFor(sessionId);

  let record: PoolRecord | null = null;
  if (requested !== undefined && requested !== null && requested !== "") {
    record = candidates.find((p) => p.id === requested) ?? null;
    if (!record) {
      throw conflict("POOL_NOT_FOR_SESSION", "That pool is not an active pool of this signing wallet on the session's network");
    }
  } else {
    record = candidates.find((p) => p.id === linkedPoolId) ?? candidates[candidates.length - 1] ?? null;
  }

  let reason: SessionPoolMatch["reason"] = null;
  // For the hint, show the wallet's pool on another network or the archived one.
  let shown: PoolRecord | null = record;
  if (!record) {
    if (all.length === 0) reason = "NO_POOL";
    else {
      const otherNetwork = all.find((p) => p.network !== session.network);
      shown = otherNetwork ?? all[all.length - 1];
      reason = otherNetwork ? "NETWORK_MISMATCH" : "POOL_ARCHIVED";
    }
  } else if (remainingSlots(record) < needed) {
    reason = "POOL_FULL";
  }

  const match: SessionPoolMatch = {
    sessionId,
    network: session.network,
    signingAddress,
    pool: shown ? toPoolSummary(shown) : null,
    candidates: candidates.map((p) => ({ ...toPoolSummary(p), account: accountNumberOf(p.accountPath) })),
    linkedPoolId,
    reason,
    remaining: record ? remainingSlots(record) : 0,
    needed,
  };
  return { session, match, record };
}

/**
 * Records `poolId` as the pool this session generates into (Setup → "create
 * a pool for this wallet"). Only the session's owner, and only a pool on the
 * session's network. Returns false when the link does not apply.
 */
export async function linkSessionToPool(userId: string, sessionId: string, poolId: string): Promise<boolean> {
  const session = await Session.findById(sessionId);
  if (!session || !session.userId || String(session.userId) !== userId) return false;
  const pool = await pools.findById(poolId);
  if (!pool || pool.network !== session.network) return false;
  await sessionPools.link(sessionId, poolId);
  return true;
}

/** Which pool (if any) "Pool wallets" generation would use for this session. */
export async function findSessionPool(userId: string, sessionId: string, body: unknown): Promise<SessionPoolMatch> {
  return (await resolve(userId, sessionId, body)).match;
}

function writeWalletsCsv(rows: Array<{ index: number; address: string; derivationPath: string }>): void {
  const outputDir = path.join(getScriptsDir(), "output");
  fs.mkdirSync(outputDir, { recursive: true });
  // Same header as scripts/generate-wallets.ts; the privateKey column is
  // deliberately empty (prepare-distribution only reads index and address).
  const lines = ["index,address,privateKey,derivationPath", ...rows.map((r) => `${r.index},${r.address},,${r.derivationPath}`)];
  fs.writeFileSync(path.join(outputDir, "wallets.csv"), lines.join("\n"), "utf8");
}

/**
 * Generates this session's wallets inside the matching pool. Replaces any
 * wallets the session had, exactly like POST /api/generate does.
 */
export async function generateSessionWalletsFromPool(
  userId: string,
  sessionId: string,
  body: unknown
): Promise<SessionPoolGenerateResponse> {
  const { session, match, record } = await resolve(userId, sessionId, body);

  if (match.reason === "NETWORK_MISMATCH") {
    throw conflict(
      "POOL_NETWORK_MISMATCH",
      `The pool for this wallet is on ${match.pool?.network ?? "another network"}, but this session distributes on ${session.network}.`
    );
  }
  if (match.reason === "POOL_ARCHIVED") throw conflict("POOL_ARCHIVED", "Pool is archived");
  if (!record || match.reason === "NO_POOL") {
    throw conflict("NO_POOL_FOR_WALLET", "No Managed Wallets pool uses this signing wallet as master. Create one first.");
  }
  if (match.reason === "POOL_FULL") {
    throw conflict(
      "POOL_LIMIT_REACHED",
      `The pool has room for ${match.remaining} more wallets; this session needs ${match.needed}.`
    );
  }
  if (isRunning(sessionId) || ["generating", "preparing", "distributing"].includes(session.status)) {
    throw conflict("SESSION_BUSY", "Another step is already running for this session");
  }

  await Session.update(sessionId, { status: "generating", startedAt: new Date(), sentCount: 0 });
  await recordSessionAudit({
    userId,
    sessionId,
    action: "GENERATE_STARTED",
    message: "Wallet generation started (pool wallets)",
    details: { totalWallets: session.totalWallets, mode: "MANAGED_POOL", poolId: record.id },
  });

  try {
    await Wallet.deleteBySession(sessionId);

    const generated = await generateWallets(userId, record.id, {
      count: session.totalWallets,
      labelPrefix: `Session ${sessionId.slice(-12)} #`,
    });
    const created = [...generated.created].sort((a, b) => a.derivationIndex - b.derivationIndex);

    const rows = created.map((w, i) => ({
      index: i,
      address: w.address,
      derivationPath: `pool:${record.id}/${w.derivationIndex}`,
    }));
    writeWalletsCsv(rows);
    await Wallet.insertMany(
      rows.map((r) => ({
        sessionId,
        index: r.index,
        address: r.address,
        derivationPath: r.derivationPath,
        amount: 0,
        amountWei: "0",
        packedHex: "0x",
        sent: false,
        failed: false,
      }))
    );

    // The pool secret controls these wallets; a mnemonic from an earlier
    // generation of this session would only mislead.
    await Session.update(sessionId, { status: "idle", sentCount: rows.length, masterMnemonic: undefined });

    // Make sure the session's token shows in the pool. Best effort: the
    // indexer also discovers it from the first deposit.
    try {
      await trackToken(userId, { network: session.network, tokenAddress: session.tokenAddress });
    } catch (err) {
      if (!(err instanceof ManagedApiError && err.code === "ALREADY_TRACKED")) {
        managedLog("warn", "session token not tracked", { network: session.network, error: err });
      }
    }
    refreshBalancesSoon(session.network);
    await sessionPools.link(sessionId, record.id);

    const fromIndex = created[0]?.derivationIndex ?? generated.nextIndex;
    const toIndex = created[created.length - 1]?.derivationIndex ?? generated.nextIndex - 1;
    await recordSessionAudit({
      userId,
      sessionId,
      action: "GENERATE_COMPLETED",
      message: "Wallet generation completed (pool wallets)",
      details: { importedWallets: rows.length, mode: "MANAGED_POOL", poolId: record.id, fromIndex, toIndex },
    });

    const fresh = await pools.findById(record.id);
    return {
      status: "done",
      sessionId,
      pool: toPoolSummary(fresh ?? record),
      created: rows.length,
      fromIndex,
      toIndex,
    };
  } catch (err) {
    await Session.update(sessionId, { status: "error" });
    await recordSessionAudit({
      userId,
      sessionId,
      action: "GENERATE_FAILED",
      message: "Wallet generation failed (pool wallets)",
      details: { mode: "MANAGED_POOL", poolId: record.id, error: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}
