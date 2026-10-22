/**
 * Transfer orchestration (ARCHITECTURE.md §3.4, §3.5): dry-run plan, job
 * creation with idempotency, sweep batches, listing and explicit retry.
 * No signing happens here; the worker (chain/transferWorker.ts) does that.
 */
import { randomUUID } from "crypto";
import { parseUnits } from "ethers";
import { recordManagedAudit } from "../audit";
import { gasPriceBoundsFromEnv, resolveGasPrice } from "../chain/fees";
import { getTokenBalance } from "../chain/multicall";
import { resilientProvider } from "../chain/rpc";
import {
  FALLBACK_GAS_ESTIMATE_NATIVE,
  FALLBACK_GAS_ESTIMATE_TOKEN,
  estimateInputsFor,
  isNativeAsset,
  masterReserveFor,
  plan,
} from "../chain/transferPlanner";
import { balances } from "../models/balances";
import type { PoolRecord } from "../models/pools";
import { transfers } from "../models/transfers";
import type { TransferRecord } from "../models/transfers";
import { wallets } from "../models/wallets";
import type { ManagedWalletRecord } from "../models/wallets";
import { managedLog } from "../redact";
import { NATIVE_ASSET } from "../types";
import { pools } from "../models/pools";
import type {
  CreateTransferRequest,
  GetTransferResponse,
  ListTransfersQuery,
  ListTransfersResponse,
  ManagedToken,
  Network,
  PlanTransferRequest,
  PlanTransferResponse,
  SweepRequest,
  SweepResponse,
  TransferFailureCode,
  TransferJob,
  TransferStatus,
} from "../types";
import {
  assetMeta,
  formatAmount,
  maxAttempts,
  maxGasLimit,
  normalizeAsset,
  requireAddress,
  requireString,
  requireUuid,
  tokenMetaForAllNetworks,
  tokenMetaForNetwork,
  topUpBufferWei,
} from "./common";
import { ManagedApiError, badRequest, conflict, notFound, validation } from "./errors";
import { requirePoolRecord } from "./poolService";

const FAILURE_CODES: ReadonlySet<string> = new Set<TransferFailureCode>([
  "NOTHING_TO_SWEEP",
  "INSUFFICIENT_TOKEN_BALANCE",
  "INSUFFICIENT_NATIVE_FOR_AMOUNT",
  "MASTER_INSUFFICIENT_BNB",
  "GAS_LIMIT_EXCEEDED",
  "INVALID_DESTINATION",
  "TIMEOUT",
  "BROADCAST_FAILED",
  "REVERTED",
  "MAX_ATTEMPTS",
  "KEY_VAULT_UNAVAILABLE",
  "POOL_ARCHIVED",
  "WALLET_DISABLED",
  "UNKNOWN",
]);

const STATUSES: ReadonlySet<string> = new Set<TransferStatus>([
  "PENDING",
  "FUNDING_GAS",
  "SENDING",
  "CONFIRMED",
  "FAILED",
  "CANCELLED",
]);

/** The stored `error` column is `"<CODE>: <message>"`; see adapters.ts. */
export function encodeError(code: TransferFailureCode | null | undefined, message: string | null | undefined): string | null {
  if (!code) return message ?? null;
  return `${code}: ${message ?? ""}`.trimEnd();
}

export function parseErrorCode(error: string | null): TransferFailureCode | null {
  if (!error) return null;
  const match = /^([A-Z_]+):/.exec(error);
  if (match && FAILURE_CODES.has(match[1])) return match[1] as TransferFailureCode;
  return "UNKNOWN";
}

/** API `TransferJob` from a stored record plus token metadata. */
export function toJob(
  network: Network,
  record: TransferRecord,
  meta: Map<string, ManagedToken>,
  key: (asset: string) => string = (a) => a
): TransferJob {
  const m = assetMeta(network, record.asset, meta, key);
  return {
    ...record,
    symbol: m.symbol,
    decimals: m.decimals,
    amount: formatAmount(record.amountWei, m.decimals),
    errorCode: parseErrorCode(record.error),
  };
}

// ─── Validation ───────────────────────────────────────────────────────────────

interface ParsedPlanRequest {
  walletId: string;
  toAddress: string;
  asset: string;
  sweepAll: boolean;
  /** Human amount; undefined when sweepAll. */
  amount?: string;
}

function parsePlanRequest(body: PlanTransferRequest): ParsedPlanRequest {
  const walletId = requireUuid(body?.walletId, "walletId");
  const toAddress = requireAddress(body?.toAddress, "toAddress");
  const asset = normalizeAsset(body?.asset);
  const sweepAll = body?.sweepAll === true;
  if (sweepAll) return { walletId, toAddress, asset, sweepAll };

  if (typeof body?.amount !== "string" || !/^\d+(\.\d+)?$/.test(body.amount.trim())) {
    throw validation("amount must be a positive decimal string, or set sweepAll");
  }
  return { walletId, toAddress, asset, sweepAll, amount: body.amount.trim() };
}

function toAmountWei(amount: string | undefined, decimals: number): bigint | undefined {
  if (amount === undefined) return undefined;
  let wei: bigint;
  try {
    wei = parseUnits(amount, decimals);
  } catch {
    throw validation(`amount has more than ${decimals} decimals`);
  }
  if (wei <= 0n) throw validation("amount must be greater than zero");
  return wei;
}

async function loadTarget(walletId: string): Promise<{ wallet: ManagedWalletRecord; pool: PoolRecord }> {
  const wallet = await wallets.findById(walletId);
  if (!wallet) throw notFound("WALLET_NOT_FOUND", "Wallet not found");
  const pool = await requirePoolRecord(wallet.poolId);
  return { wallet, pool };
}

// ─── Plan (dry run) ───────────────────────────────────────────────────────────

async function computePlan(
  pool: PoolRecord,
  wallet: ManagedWalletRecord,
  req: ParsedPlanRequest
): Promise<PlanTransferResponse["plan"]> {
  const meta = await tokenMetaForNetwork(pool.network);
  const decimals = assetMeta(pool.network, req.asset, meta).decimals;
  const amountWei = req.sweepAll ? undefined : toAmountWei(req.amount, decimals);
  const native = isNativeAsset(req.asset);

  let provider;
  try {
    provider = resilientProvider(pool.network);
  } catch {
    throw new ManagedApiError(503, "RPC_UNAVAILABLE", `No RPC configured for ${pool.network}`);
  }

  try {
    const [childNativeWei, masterNativeWei, gasPriceWei] = await Promise.all([
      provider.getBalance(wallet.address),
      provider.getBalance(pool.masterAddress),
      resolveGasPrice(provider, gasPriceBoundsFromEnv()),
    ]);
    const childAssetWei = native
      ? childNativeWei
      : await getTokenBalance(provider, req.asset, wallet.address);

    let gasLimitEstimate: bigint;
    try {
      gasLimitEstimate = await provider.estimateGas(
        estimateInputsFor({
          asset: req.asset,
          childAddress: wallet.address,
          toAddress: req.toAddress,
          amountWei,
          sweepAll: req.sweepAll,
          childAssetWei,
        })
      );
    } catch (err) {
      managedLog("warn", "estimateGas failed in plan; using fallback", { walletId: wallet.id, error: err });
      gasLimitEstimate = native ? FALLBACK_GAS_ESTIMATE_NATIVE : FALLBACK_GAS_ESTIMATE_TOKEN;
    }

    const buffer = topUpBufferWei();
    return plan({
      childAddress: wallet.address,
      masterAddress: pool.masterAddress,
      toAddress: req.toAddress,
      asset: req.asset,
      amountWei,
      sweepAll: req.sweepAll,
      childNativeWei,
      childAssetWei,
      masterNativeWei,
      gasLimitEstimate,
      gasPriceWei,
      maxGasLimit: maxGasLimit(),
      topUpBufferWei: buffer,
      masterReserveWei: masterReserveFor(gasPriceWei, buffer),
    });
  } catch (err) {
    if (err instanceof ManagedApiError) throw err;
    managedLog("error", "plan failed", { walletId: wallet.id, error: err });
    throw new ManagedApiError(503, "RPC_UNAVAILABLE", "Could not read balances or fees from the network");
  }
}

export async function planTransfer(body: PlanTransferRequest): Promise<PlanTransferResponse> {
  const req = parsePlanRequest(body);
  const { wallet, pool } = await loadTarget(req.walletId);
  return { plan: await computePlan(pool, wallet, req) };
}

// ─── Idempotency (SR-08) ──────────────────────────────────────────────────────
//
// Client keys are scoped per requesting user so two admins can never collide,
// and a plain-transfer key can never collide with a sweep entry (which carries
// an extra `:walletId:asset` suffix). The scoped form is what is persisted in
// `managed_transfers.idempotency_key`.

/** Persisted key for a single transfer: `${userId}:${clientKey}`. */
export function transferIdempotencyKey(userId: string, clientKey: string): string {
  return `${userId}:${clientKey}`;
}

/** Persisted key for one sweep entry: `${userId}:${clientKey}:${walletId}:${asset}`. */
export function sweepIdempotencyKey(userId: string, clientKey: string, walletId: string, asset: string): string {
  return `${userId}:${clientKey}:${walletId}:${asset}`;
}

/**
 * 409 IDEMPOTENCY_MISMATCH when a key is reused for a different request, so a
 * reused key can never silently return a job that moves other funds.
 */
function assertIdempotentMatch(
  existing: TransferRecord,
  req: ParsedPlanRequest,
  amountWei: bigint | undefined
): void {
  const differences: string[] = [];
  if (existing.walletId !== req.walletId) differences.push("walletId");
  if (existing.toAddress.toLowerCase() !== req.toAddress.toLowerCase()) differences.push("toAddress");
  if (existing.asset.toLowerCase() !== req.asset.toLowerCase()) differences.push("asset");
  if (existing.sweepAll !== req.sweepAll) differences.push("sweepAll");
  const requestedWei = req.sweepAll ? "0" : (amountWei ?? 0n).toString();
  if (!req.sweepAll && existing.amountWei !== requestedWei) differences.push("amount");
  if (differences.length > 0) {
    throw conflict(
      "IDEMPOTENCY_MISMATCH",
      `idempotencyKey was already used for a different request (${differences.join(", ")} differ)`
    );
  }
}

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createTransfer(
  userId: string,
  body: CreateTransferRequest
): Promise<{ job: TransferJob; created: boolean }> {
  const req = parsePlanRequest(body);
  const clientKey = requireString(body?.idempotencyKey, "idempotencyKey", 200);
  const idempotencyKey = transferIdempotencyKey(userId, clientKey);
  const { wallet, pool } = await loadTarget(req.walletId);

  if (pool.status !== "ACTIVE") throw conflict("POOL_ARCHIVED", "Pool is archived");
  if (wallet.status !== "ACTIVE") throw conflict("WALLET_DISABLED", "Wallet is disabled");

  const existing = await transfers.findByIdempotencyKey(idempotencyKey);
  const meta = await tokenMetaForNetwork(pool.network);
  if (existing) {
    const decimals = assetMeta(pool.network, req.asset, meta).decimals;
    assertIdempotentMatch(existing, req, req.sweepAll ? undefined : toAmountWei(req.amount, decimals));
    return { job: toJob(pool.network, existing, meta), created: false };
  }

  const planned = await computePlan(pool, wallet, req);
  if (!planned.ok) throw badRequest(planned.code, planned.message);

  const result = await transfers.create({
    poolId: pool.id,
    walletId: wallet.id,
    toAddress: req.toAddress,
    asset: req.asset,
    amountWei: req.sweepAll ? "0" : planned.amountWei,
    sweepAll: req.sweepAll,
    idempotencyKey,
    requestedBy: userId,
  });

  // Lost the insert race to a concurrent request with the same key: apply the
  // same mismatch rule to the row that won.
  if (!result.created) {
    assertIdempotentMatch(result.job, req, req.sweepAll ? undefined : BigInt(planned.amountWei));
  }

  if (result.created) {
    await recordManagedAudit({
      userId,
      poolId: pool.id,
      walletId: wallet.id,
      action: "TRANSFER_REQUESTED",
      details: {
        jobId: result.job.id,
        asset: req.asset,
        toAddress: req.toAddress,
        amountWei: result.job.amountWei,
        sweepAll: req.sweepAll,
        topUpWei: planned.topUpWei,
      },
    });
  }

  return { job: toJob(pool.network, result.job, meta), created: result.created };
}

// ─── Sweep ────────────────────────────────────────────────────────────────────

export async function sweep(userId: string, body: SweepRequest): Promise<SweepResponse> {
  const poolId = requireUuid(body?.poolId, "poolId");
  const clientKey = requireString(body?.idempotencyKey, "idempotencyKey", 200);

  let walletIds: string[] | undefined;
  if (body?.walletIds !== "ALL") {
    if (!Array.isArray(body?.walletIds) || body.walletIds.length === 0) {
      throw validation('walletIds must be "ALL" or a non-empty array of wallet ids');
    }
    walletIds = body.walletIds.map((id) => requireUuid(id, "walletIds[]"));
  }

  let assets: string[] | undefined;
  if (body?.assets !== "ALL") {
    if (!Array.isArray(body?.assets) || body.assets.length === 0) {
      throw validation('assets must be "ALL" or a non-empty array of assets');
    }
    assets = body.assets.map(normalizeAsset);
  }

  const pool = await requirePoolRecord(poolId);
  if (pool.status !== "ACTIVE") throw conflict("POOL_ARCHIVED", "Pool is archived");
  const toAddress =
    body?.toAddress !== undefined && body.toAddress !== null && body.toAddress !== ""
      ? requireAddress(body.toAddress, "toAddress")
      : pool.masterAddress;

  const meta = await tokenMetaForNetwork(pool.network);
  const visibleAssetCount = 1 + [...meta.values()].filter((t) => !t.hidden).length;

  const candidates = await balances.listNonZeroByPool(poolId, { walletIds, assets });
  const candidateWallets = await wallets.findByIds([...new Set(candidates.map((c) => c.walletId))]);
  const activeWallets = new Set(candidateWallets.filter((w) => w.status === "ACTIVE").map((w) => w.id));

  const entries = candidates
    .filter((c) => activeWallets.has(c.walletId))
    .filter((c) => c.asset === NATIVE_ASSET || !assetMeta(pool.network, c.asset, meta).hidden)
    .map((c) => ({
      poolId,
      walletId: c.walletId,
      toAddress,
      asset: c.asset,
      amountWei: "0",
      sweepAll: true,
      idempotencyKey: sweepIdempotencyKey(userId, clientKey, c.walletId, c.asset),
      requestedBy: userId,
    }));

  const batchId = randomUUID();
  const jobs = entries.length > 0 ? await transfers.createBatch(batchId, entries) : 0;

  const walletUniverse = walletIds ? walletIds.length : pool.walletCount;
  const assetUniverse = assets ? assets.length : visibleAssetCount;
  const skipped = Math.max(0, walletUniverse * assetUniverse - jobs);

  await recordManagedAudit({
    userId,
    poolId,
    action: "SWEEP_REQUESTED",
    details: {
      batchId,
      jobs,
      skipped,
      toAddress,
      walletIds: walletIds ? walletIds.length : "ALL",
      assets: assets ?? "ALL",
    },
  });

  return { batchId, jobs, skipped };
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function listTransfers(query: ListTransfersQuery): Promise<ListTransfersResponse> {
  const poolId = query.poolId ? requireUuid(query.poolId, "poolId") : undefined;
  const batchId = query.batchId ? requireUuid(query.batchId, "batchId") : undefined;
  let status: TransferStatus | undefined;
  if (query.status !== undefined) {
    if (!STATUSES.has(query.status)) throw validation("status is not a valid transfer status");
    status = query.status;
  }

  const [page, byStatus, meta, networks] = await Promise.all([
    transfers.list({ poolId, batchId, status, skip: query.skip, limit: query.limit }),
    transfers.countByStatus({ poolId, batchId }),
    tokenMetaForAllNetworks(),
    poolNetworks(),
  ]);

  return {
    jobs: page.jobs.map((job) => {
      const network = networks.get(job.poolId) ?? "bscMainnet";
      return toJob(network, job, meta, (a) => `${network}:${a}`);
    }),
    total: page.total,
    byStatus,
  };
}

export async function getTransfer(id: string): Promise<GetTransferResponse> {
  const job = await transfers.findById(requireUuid(id, "id"));
  if (!job) throw notFound("TRANSFER_NOT_FOUND", "Transfer job not found");
  const pool = await requirePoolRecord(job.poolId);
  return { job: toJob(pool.network, job, await tokenMetaForNetwork(pool.network)) };
}

/**
 * Retry a FAILED job: back to PENDING with the error cleared. The gas top-up
 * hash is always kept; the transfer hash is cleared only after a REVERTED
 * outcome. A TIMEOUT keeps its hash so the worker re-checks the receipt
 * before broadcasting anything.
 */
export async function retryTransfer(userId: string, id: string): Promise<GetTransferResponse> {
  const job = await transfers.findById(requireUuid(id, "id"));
  if (!job) throw notFound("TRANSFER_NOT_FOUND", "Transfer job not found");
  if (job.status !== "FAILED") throw conflict("NOT_RETRYABLE", `Only FAILED jobs can be retried (status ${job.status})`);
  if (job.attempts >= maxAttempts()) {
    throw conflict("MAX_ATTEMPTS", `Job already used ${job.attempts} of ${maxAttempts()} attempts`);
  }

  const errorCode = parseErrorCode(job.error);
  const patch: Parameters<typeof transfers.update>[1] = { status: "PENDING", error: null };
  if (errorCode === "REVERTED" && job.transferTxHash) {
    patch.transferTxHash = null;
  }

  const updated = await transfers.update(job.id, patch);
  if (!updated) throw notFound("TRANSFER_NOT_FOUND", "Transfer job not found");

  await recordManagedAudit({
    userId,
    poolId: job.poolId,
    walletId: job.walletId,
    action: "TRANSFER_RETRIED",
    details: { jobId: job.id, previousErrorCode: errorCode, attempts: job.attempts },
  });

  const pool = await requirePoolRecord(job.poolId);
  return { job: toJob(pool.network, updated, await tokenMetaForNetwork(pool.network)) };
}

async function poolNetworks(): Promise<Map<string, Network>> {
  const map = new Map<string, Network>();
  for (const p of await pools.listAll()) map.set(p.id, p.network);
  return map;
}
