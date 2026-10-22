/**
 * Transfer worker — the only place that signs with managed keys (SPEC §6.5).
 *
 * Single loop, concurrency 1. Per job:
 *   load pool + wallet → restart safety (stored hashes first) → refuse archived
 *   pool / disabled wallet / too many attempts → decrypt seed → derive master
 *   (index 0) and child (derivation index) → fresh balances → estimateGas →
 *   planner → FUNDING_GAS (master top-up: hash stored BEFORE broadcast,
 *   1 confirmation) → SENDING (child transfer: hash stored BEFORE broadcast,
 *   1 confirmation) → CONFIRMED | FAILED{code}.
 *
 * Double-send safety (SR-03): the hash of the signed transaction is
 * deterministic, so it is persisted before `broadcastTransaction`. An ambiguous
 * broadcast failure (timeout, network error, "already known") keeps the hash
 * and fails the job as TIMEOUT; a retry then observes the chain first. After a
 * receipt timeout the mempool decides: a tx still pending for the address
 * keeps TIMEOUT, no pending tx and no receipt means the tx was dropped and the
 * job is re-signed with the same, still free, nonce.
 *
 * Keys (SR-06): the mnemonic lives in one local inside `deriveSigners`; the
 * signers it returns are plain `Wallet`s holding a private key only (an
 * `HDNodeWallet` child would carry the whole pool mnemonic). Nothing in this
 * file logs a signer, a signed transaction or a full ethers error message
 * (SR-05: only `code` + `shortMessage`, truncated).
 *
 * Signers are not connected to a provider: transactions are signed offline with
 * an explicit nonce (getTransactionCount(addr, "pending")) and broadcast through
 * the provider, the same pattern as scripts/distribute.ts.
 */

import { HDNodeWallet, Transaction, Wallet } from "ethers";
import { childSignerFor, masterSignerFor } from "../derive";
import { NATIVE_ASSET } from "../types";
import type { ManagedAuditAction, Network, TransferFailureCode } from "../types";
import type { BalanceRefresher, DirtyPair } from "./balances";
import { DEFAULTS, gasPriceBoundsFromEnv, readEnvBigint, readEnvInt, resolveGasPrice } from "./fees";
import type { GasPriceBounds } from "./fees";
import { getTokenBalance } from "./multicall";
import type {
  AuditPort,
  ChainProvider,
  ClockPort,
  LoggerPort,
  PoolRow,
  PoolsPort,
  ReceiptLike,
  TransferJobRow,
  TransfersPort,
  VaultPort,
  WalletRow,
  WalletsPort,
} from "./ports";
import { systemClock } from "./ports";
import { chainIdFor, resilientProvider, shortRpcError } from "./rpc";
import {
  FALLBACK_GAS_ESTIMATE_NATIVE,
  FALLBACK_GAS_ESTIMATE_TOKEN,
  TOPUP_GAS_LIMIT,
  estimateInputsFor,
  isNativeAsset,
  masterReserveFor,
  plan,
} from "./transferPlanner";

export const DEFAULT_ACCOUNT_PATH = "m/44'/60'/0'/0";

export interface WorkerDeps {
  pools: PoolsPort;
  wallets: WalletsPort;
  transfers: TransfersPort;
  vault: VaultPort;
  audits: AuditPort;
  balances: BalanceRefresher;
  providerFor?: (network: Network) => ChainProvider;
  /** Override for tests; default resolveGasPrice with env bounds. */
  gasPriceFor?: (provider: ChainProvider) => Promise<bigint>;
  clock?: ClockPort;
  /** Required: a redacting logger (SR-09). */
  logger: LoggerPort;
}

export interface WorkerOptions {
  pollIntervalMs: number;
  txTimeoutMs: number;
  maxAttempts: number;
  maxGasLimit: bigint;
  topUpBufferWei: bigint;
  /** How often to poll for a receipt while waiting (ms). */
  receiptPollMs: number;
  gasPriceBounds: GasPriceBounds;
  chainIdFor: (network: Network) => number;
}

export function workerOptionsFromEnv(): WorkerOptions {
  return {
    pollIntervalMs: readEnvInt("MANAGED_WORKER_INTERVAL_MS", DEFAULTS.MANAGED_WORKER_INTERVAL_MS),
    txTimeoutMs: readEnvInt("MANAGED_TX_TIMEOUT_MS", DEFAULTS.MANAGED_TX_TIMEOUT_MS),
    maxAttempts: readEnvInt("MANAGED_MAX_ATTEMPTS", DEFAULTS.MANAGED_MAX_ATTEMPTS),
    maxGasLimit: BigInt(readEnvInt("MANAGED_MAX_GAS_LIMIT", DEFAULTS.MANAGED_MAX_GAS_LIMIT)),
    topUpBufferWei: readEnvBigint("MANAGED_TOPUP_BUFFER_WEI", DEFAULTS.MANAGED_TOPUP_BUFFER_WEI),
    receiptPollMs: 3_000,
    gasPriceBounds: gasPriceBoundsFromEnv(),
    chainIdFor,
  };
}

/** A typed, terminal failure of one job. */
export class WorkerFailure extends Error {
  constructor(
    public readonly code: TransferFailureCode,
    message: string
  ) {
    super(message);
    this.name = "WorkerFailure";
  }
}

export type ReceiptOutcome =
  | { kind: "confirmed"; receipt: ReceiptLike }
  | { kind: "reverted"; receipt: ReceiptLike }
  | { kind: "timeout" };

/** ReceiptOutcome plus "gone": timed out AND no longer in the mempool (SR-03). */
type StoredHashOutcome = ReceiptOutcome | { kind: "gone" };

export interface JobOutcome {
  jobId: string;
  status: "CONFIRMED" | "FAILED";
  code: TransferFailureCode | null;
  transferTxHash: string | null;
  gasTopupTxHash: string | null;
}

/** Provider-less signers holding a private key only (never an HD node). */
export interface Signers {
  master: Wallet;
  child: Wallet;
}

interface TxFields {
  to: string;
  value: bigint;
  data?: string;
  gasLimit: bigint;
  gasPrice: bigint;
  chainId: number;
}

const ALREADY_KNOWN = [
  /already known/i,
  /ALREADY_EXISTS/,
  /already imported/i,
  /known transaction/i,
  /transaction already in (the )?pool/i,
];

/**
 * Positive list of broadcast failures that prove the node did NOT accept the
 * transaction (SR-03). Only these clear the stored hash; every other error —
 * including ethers' `UNKNOWN_ERROR` "could not coalesce error" wrapper — is
 * treated as "outcome unknown" and keeps the hash.
 */
const DEFINITE_REJECTION_CODES = new Set([
  "NONCE_EXPIRED",
  "INSUFFICIENT_FUNDS",
  "REPLACEMENT_UNDERPRICED",
  "UNSUPPORTED_OPERATION",
  "INVALID_ARGUMENT",
]);
const DEFINITE_REJECTION_RE =
  /nonce too low|insufficient funds|underpriced|intrinsic gas too low|exceeds block gas limit|invalid sender/i;

export function isDefiniteRejection(code: string | null, message: string): boolean {
  if (code && DEFINITE_REJECTION_CODES.has(code)) return true;
  return DEFINITE_REJECTION_RE.test(message);
}

/**
 * Short, payload-free error text for logs, `managed_transfers.error` and audit
 * details (SR-05): ethers `code` + `shortMessage`, or the message truncated to
 * 300 chars with long hex runs (raw signed transactions) removed. Never the
 * full ethers message, which serialises the signed tx and the RPC payload.
 */
function errorMessage(err: unknown): string {
  if (err instanceof WorkerFailure) return err.message;
  const { code, message } = shortRpcError(err);
  return code && !message.includes(code) ? `${code}: ${message}` : message;
}

/**
 * Derives the master (index 0) and child signers from the pool phrase as plain
 * `Wallet`s (SR-06). `HDNodeWallet.deriveChild` copies the mnemonic reference
 * onto every child, so HD nodes must not leave this function: the HD account is
 * dropped on return and only the two private-key strings survive, until
 * `processJob` returns (JS strings cannot be wiped).
 */
/**
 * Signers for either kind of pool secret. MNEMONIC pools use the stored
 * account path; PRIVATE_KEY pools use the key as master and the documented
 * HMAC-derived seed for children (see derive.ts).
 */
export function signersFromSecret(
  secret: string,
  seedType: "MNEMONIC" | "PRIVATE_KEY",
  accountPath: string,
  derivationIndex: number
): Signers {
  if (seedType === "PRIVATE_KEY") {
    return {
      master: new Wallet(masterSignerFor(secret, "PRIVATE_KEY").privateKey),
      child: new Wallet(childSignerFor(secret, "PRIVATE_KEY", derivationIndex).privateKey),
    };
  }
  return signersFromMnemonic(secret, accountPath, derivationIndex);
}

export function signersFromMnemonic(mnemonic: string, accountPath: string, derivationIndex: number): Signers {
  const account = HDNodeWallet.fromPhrase(mnemonic, undefined, accountPath);
  return {
    master: new Wallet(account.deriveChild(0).privateKey),
    child: new Wallet(account.deriveChild(derivationIndex).privateKey),
  };
}

function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

export class TransferWorker {
  private readonly clock: ClockPort;
  private readonly logger: LoggerPort;
  private readonly providerFor: (network: Network) => ChainProvider;
  private readonly gasPriceFor: (provider: ChainProvider) => Promise<bigint>;
  private loop: Promise<void> | null = null;
  private stopRequested = false;
  private current: Promise<unknown> | null = null;

  constructor(
    private readonly deps: WorkerDeps,
    private readonly options: WorkerOptions = workerOptionsFromEnv()
  ) {
    this.clock = deps.clock ?? systemClock;
    this.logger = deps.logger;
    this.providerFor = deps.providerFor ?? resilientProvider;
    this.gasPriceFor =
      deps.gasPriceFor ?? ((provider) => resolveGasPrice(provider, this.options.gasPriceBounds));
  }

  get running(): boolean {
    return this.loop !== null;
  }

  /** Starts the single loop (idempotent). */
  start(): void {
    if (this.loop) return;
    this.stopRequested = false;
    this.loop = this.run()
      .catch((err) => this.logger.error("transfer worker loop crashed", { error: errorMessage(err) }))
      .finally(() => {
        this.loop = null;
      });
    this.logger.info("transfer worker started", { pollIntervalMs: this.options.pollIntervalMs });
  }

  /** Requests a stop and waits for the current job to finish. */
  async stop(): Promise<void> {
    this.stopRequested = true;
    if (this.loop) await this.loop;
    if (this.current) await this.current.catch(() => undefined);
    this.logger.info("transfer worker stopped");
  }

  private async run(): Promise<void> {
    await this.recoverInterrupted();
    while (!this.stopRequested) {
      let processed = false;
      try {
        processed = await this.tick();
      } catch (err) {
        this.logger.error("transfer worker tick failed", { error: errorMessage(err) });
      }
      if (!processed && !this.stopRequested) {
        await this.clock.sleep(this.options.pollIntervalMs);
      }
    }
  }

  /**
   * Picks one PENDING job, commits the pick, processes it. Returns false when
   * nothing was pending. Exposed for tests and for a "drain now" call.
   */
  async tick(): Promise<boolean> {
    let picked;
    try {
      picked = await this.deps.transfers.pickNextPending();
    } catch (err) {
      this.logger.error("pickNextPending failed", { error: errorMessage(err) });
      return false;
    }
    if (!picked) return false;
    try {
      await picked.commit();
    } catch (err) {
      this.logger.error("could not commit job pick", { jobId: picked.job.id, error: errorMessage(err) });
      await picked.rollback().catch(() => undefined);
      return false;
    }
    const work = this.processJob(picked.job);
    this.current = work;
    try {
      await work;
    } finally {
      this.current = null;
    }
    return true;
  }

  /**
   * Jobs left in FUNDING_GAS / SENDING by a previous process: those with a
   * stored hash are resolved through the normal receipt-first path; those with
   * nothing broadcast go back to PENDING.
   */
  async recoverInterrupted(): Promise<void> {
    if (!this.deps.transfers.listInterrupted) return;
    let jobs: TransferJobRow[] = [];
    try {
      jobs = await this.deps.transfers.listInterrupted();
    } catch (err) {
      this.logger.error("listInterrupted failed", { error: errorMessage(err) });
      return;
    }
    for (const job of jobs) {
      if (this.stopRequested) return;
      if (job.transferTxHash || job.gasTopupTxHash) {
        this.logger.warn("recovering interrupted job with stored hash", { jobId: job.id, status: job.status });
        await this.processJob(job);
      } else {
        this.logger.warn("re-queueing interrupted job (nothing broadcast)", { jobId: job.id });
        try {
          await this.deps.transfers.update(job.id, { status: "PENDING" });
        } catch (err) {
          this.logger.error("could not re-queue job", { jobId: job.id, error: errorMessage(err) });
        }
      }
    }
  }

  /** Processes one job to a terminal state. Never throws. */
  async processJob(initial: TransferJobRow): Promise<JobOutcome> {
    let job = initial;
    let pool: PoolRow | null = null;
    let wallet: WalletRow | null = null;
    this.logger.info("job started", {
      jobId: job.id,
      walletId: job.walletId,
      asset: job.asset,
      sweepAll: job.sweepAll,
      attempts: job.attempts,
    });

    try {
      pool = await this.deps.pools.findById(job.poolId);
      if (!pool) throw new WorkerFailure("UNKNOWN", "Pool not found");
      wallet = await this.deps.wallets.findById(job.walletId);
      if (!wallet) throw new WorkerFailure("UNKNOWN", "Wallet not found");
      const provider = this.providerFor(pool.network);
      const chainId = this.options.chainIdFor(pool.network);

      // Restart safety: a transfer already broadcast (or whose broadcast was
      // ambiguous) is observed first. After a timeout the mempool decides
      // (SR-03): still pending → TIMEOUT with the hash kept; no pending tx and
      // no receipt → dropped, clear the hash and re-sign with the same nonce.
      if (job.transferTxHash) {
        const hash = job.transferTxHash;
        let outcome: StoredHashOutcome = await this.awaitReceipt(provider, hash, this.remainingTimeout(job));
        if (outcome.kind === "timeout") outcome = await this.afterTimeout(provider, wallet.address, hash);
        if (outcome.kind !== "gone") return await this.settle(job, pool, wallet, outcome, hash);
        this.logger.warn("stored transfer hash is gone from the mempool; re-signing with the same nonce", {
          jobId: job.id,
          hash,
        });
        await this.deps.transfers.update(job.id, { transferTxHash: null });
        job = { ...job, transferTxHash: null };
      }

      if (pool.status !== "ACTIVE") throw new WorkerFailure("POOL_ARCHIVED", "Pool is archived");
      if (wallet.status !== "ACTIVE") throw new WorkerFailure("WALLET_DISABLED", "Wallet is disabled");
      if (job.attempts > this.options.maxAttempts) {
        throw new WorkerFailure(
          "MAX_ATTEMPTS",
          `Attempt ${job.attempts} exceeds MANAGED_MAX_ATTEMPTS=${this.options.maxAttempts}`
        );
      }

      const signers = await this.deriveSigners(pool, wallet);

      // Restart safety: a top-up already broadcast is confirmed, never re-sent
      // while it can still mine (same mempool rule as the transfer).
      let topUpDone = false;
      if (job.gasTopupTxHash) {
        const hash = job.gasTopupTxHash;
        let outcome: StoredHashOutcome = await this.awaitReceipt(provider, hash, this.remainingTimeout(job));
        if (outcome.kind === "timeout") outcome = await this.afterTimeout(provider, signers.master.address, hash);
        if (outcome.kind === "reverted") throw new WorkerFailure("REVERTED", "Gas top-up reverted");
        if (outcome.kind === "timeout") {
          throw new WorkerFailure("TIMEOUT", "Gas top-up not mined within MANAGED_TX_TIMEOUT_MS (hash kept)");
        }
        if (outcome.kind === "gone") {
          this.logger.warn("stored top-up hash is gone from the mempool; re-sending the top-up", { jobId: job.id, hash });
          await this.deps.transfers.update(job.id, { gasTopupTxHash: null });
          job = { ...job, gasTopupTxHash: null };
        } else {
          topUpDone = true;
        }
      }

      // Fresh balances.
      const native = isNativeAsset(job.asset);
      const childAddress = signers.child.address;
      const masterAddress = signers.master.address;
      const [childNativeWei, masterNativeWei] = await Promise.all([
        provider.getBalance(childAddress),
        provider.getBalance(masterAddress),
      ]);
      const childAssetWei = native ? childNativeWei : await getTokenBalance(provider, job.asset, childAddress);
      const amountWei = job.sweepAll ? undefined : BigInt(job.amountWei);

      // Gas estimate from the child; on failure keep a fallback so the planner's
      // balance checks still produce the typed rejection.
      let gasLimitEstimate: bigint;
      let estimateError: string | null = null;
      try {
        gasLimitEstimate = await provider.estimateGas(
          estimateInputsFor({
            asset: job.asset,
            childAddress,
            toAddress: job.toAddress,
            amountWei,
            sweepAll: job.sweepAll,
            childAssetWei,
          })
        );
      } catch (err) {
        estimateError = errorMessage(err);
        gasLimitEstimate = native ? FALLBACK_GAS_ESTIMATE_NATIVE : FALLBACK_GAS_ESTIMATE_TOKEN;
      }
      const gasPriceWei = await this.gasPriceFor(provider);

      const planned = plan({
        childAddress,
        masterAddress,
        toAddress: job.toAddress,
        asset: job.asset,
        amountWei,
        sweepAll: job.sweepAll,
        childNativeWei,
        childAssetWei,
        masterNativeWei,
        gasLimitEstimate,
        gasPriceWei,
        maxGasLimit: this.options.maxGasLimit,
        topUpBufferWei: this.options.topUpBufferWei,
        masterReserveWei: masterReserveFor(gasPriceWei, this.options.topUpBufferWei),
      });
      if (!planned.ok) throw new WorkerFailure(planned.code, planned.message);
      if (estimateError) throw new WorkerFailure("UNKNOWN", `estimateGas failed: ${estimateError}`);

      await this.deps.transfers.update(job.id, {
        gasPriceWei: planned.gasPriceWei,
        gasLimit: Number(planned.gasLimit),
      });
      this.logger.info("job planned", {
        jobId: job.id,
        gasLimit: planned.gasLimit,
        gasPriceWei: planned.gasPriceWei,
        topUpWei: planned.topUpWei,
        amountWei: planned.amountWei,
      });

      // FUNDING_GAS
      const topUpWei = BigInt(planned.topUpWei);
      if (topUpWei > 0n && !topUpDone) {
        await this.deps.transfers.update(job.id, { status: "FUNDING_GAS" });
        job = { ...job, status: "FUNDING_GAS" };
        const hash = await this.broadcast(
          provider,
          signers.master,
          {
            to: childAddress,
            value: topUpWei,
            gasLimit: TOPUP_GAS_LIMIT,
            gasPrice: gasPriceWei,
            chainId,
          },
          async (h) => {
            await this.deps.transfers.update(job.id, { gasTopupTxHash: h });
            job = { ...job, gasTopupTxHash: h };
          }
        );
        this.logger.info("gas top-up broadcast", { jobId: job.id, hash, topUpWei: planned.topUpWei });
        const outcome = await this.awaitReceipt(provider, hash, this.options.txTimeoutMs);
        if (outcome.kind === "reverted") throw new WorkerFailure("REVERTED", "Gas top-up reverted");
        if (outcome.kind === "timeout") {
          throw new WorkerFailure("TIMEOUT", "Gas top-up not mined within MANAGED_TX_TIMEOUT_MS");
        }
      }

      // SENDING
      await this.deps.transfers.update(job.id, { status: "SENDING" });
      job = { ...job, status: "SENDING" };
      const intent = planned.txs.find((t) => t.kind === "transfer");
      if (!intent) throw new WorkerFailure("UNKNOWN", "Planner produced no transfer transaction");
      const transferHash = await this.broadcast(
        provider,
        signers.child,
        {
          to: intent.to,
          value: BigInt(intent.valueWei),
          data: intent.data,
          gasLimit: BigInt(planned.gasLimit),
          gasPrice: gasPriceWei,
          chainId,
        },
        async (h) => {
          await this.deps.transfers.update(job.id, { transferTxHash: h });
          job = { ...job, transferTxHash: h };
        }
      );
      this.logger.info("transfer broadcast", { jobId: job.id, hash: transferHash });
      const outcome = await this.awaitReceipt(provider, transferHash, this.options.txTimeoutMs);
      return await this.settle(job, pool, wallet, outcome, transferHash);
    } catch (err) {
      const failure =
        err instanceof WorkerFailure ? err : new WorkerFailure("UNKNOWN", errorMessage(err));
      return await this.finishFailed(job, pool, wallet, failure);
    }
  }

  // ─── Steps ────────────────────────────────────────────────────────────────

  /**
   * Decrypts the seed and derives both signers. The mnemonic and the HD
   * account never leave this frame (SR-06): the returned `Wallet`s hold the
   * two private keys only. Addresses are checked against the stored rows.
   */
  private async deriveSigners(pool: PoolRow, wallet: WalletRow): Promise<Signers> {
    let mnemonic: string;
    try {
      mnemonic = await this.deps.vault.decryptMnemonic(pool.id);
    } catch {
      throw new WorkerFailure("KEY_VAULT_UNAVAILABLE", "Could not decrypt the pool seed");
    }
    let signers: Signers;
    try {
      signers = signersFromSecret(mnemonic, pool.seedType ?? "MNEMONIC", pool.accountPath || DEFAULT_ACCOUNT_PATH, wallet.derivationIndex);
    } catch {
      throw new WorkerFailure("UNKNOWN", "Decrypted pool secret is not a valid mnemonic or private key");
    } finally {
      mnemonic = "";
    }
    if (!sameAddress(signers.master.address, pool.masterAddress)) {
      throw new WorkerFailure("UNKNOWN", "Derived master address does not match the pool");
    }
    if (!sameAddress(signers.child.address, wallet.address)) {
      throw new WorkerFailure("UNKNOWN", "Derived child address does not match the wallet");
    }
    return signers;
  }

  /**
   * Signs offline with a pending nonce, persists the deterministic hash of the
   * signed transaction through `persist` BEFORE the network call (SR-03), then
   * broadcasts. Returns the hash.
   *   - "already known" (anywhere in the nested node text): the node has it →
   *     return the hash as broadcast.
   *   - definite rejection (positive list: nonce too low, insufficient funds,
   *     underpriced, …): clear the stored hash and fail as BROADCAST_FAILED
   *     (retry re-signs).
   *   - anything else (timeouts, network errors, 429, ethers UNKNOWN_ERROR
   *     wrappers): outcome unknown → keep the stored hash and fail as TIMEOUT
   *     so the retry observes the chain first.
   */
  private async broadcast(
    provider: ChainProvider,
    signer: Wallet,
    fields: TxFields,
    persist: (hash: string | null) => Promise<void>
  ): Promise<string> {
    let signed: string;
    let expectedHash: string;
    try {
      const nonce = await provider.getTransactionCount(signer.address, "pending");
      signed = await signer.signTransaction({
        type: 0,
        chainId: fields.chainId,
        nonce,
        to: fields.to,
        value: fields.value,
        data: fields.data ?? "0x",
        gasLimit: fields.gasLimit,
        gasPrice: fields.gasPrice,
      });
      expectedHash = Transaction.from(signed).hash ?? "";
      if (!expectedHash) throw new Error("could not derive the transaction hash");
    } catch (err) {
      throw new WorkerFailure("BROADCAST_FAILED", `Could not sign transaction: ${errorMessage(err)}`);
    }
    await persist(expectedHash);
    try {
      const res = await provider.broadcastTransaction(signed);
      if (res.hash && res.hash.toLowerCase() !== expectedHash.toLowerCase()) {
        this.logger.warn("node returned an unexpected hash; storing the node's", {
          expected: expectedHash,
          returned: res.hash,
        });
        await persist(res.hash);
        return res.hash;
      }
      return expectedHash;
    } catch (err) {
      const { code, message } = shortRpcError(err);
      if (ALREADY_KNOWN.some((re) => re.test(message))) {
        this.logger.warn("transaction already known to the node; continuing", { hash: expectedHash });
        return expectedHash;
      }
      if (!isDefiniteRejection(code, message)) {
        this.logger.warn("broadcast outcome unknown; hash kept for a receipt-first retry", {
          hash: expectedHash,
          code,
          error: message,
        });
        throw new WorkerFailure("TIMEOUT", `Broadcast outcome unknown (${errorMessage(err)}); hash kept`);
      }
      try {
        await persist(null);
      } catch (clearErr) {
        this.logger.error("could not clear the stored hash after a rejected broadcast", {
          hash: expectedHash,
          error: errorMessage(clearErr),
        });
      }
      throw new WorkerFailure("BROADCAST_FAILED", errorMessage(err));
    }
  }

  /**
   * After a receipt timeout for a stored hash: is the transaction still able
   * to mine? "timeout" (keep the hash) while the address has a transaction in
   * the mempool (pending nonce > latest nonce) or while the nonce check itself
   * fails (never re-sign on doubt). Otherwise one last receipt read decides
   * between a mined outcome and "gone" (dropped, nonce free again).
   */
  private async afterTimeout(
    provider: ChainProvider,
    address: string,
    hash: string
  ): Promise<StoredHashOutcome> {
    let latest: number;
    let pending: number;
    try {
      [latest, pending] = await Promise.all([
        provider.getTransactionCount(address, "latest"),
        provider.getTransactionCount(address, "pending"),
      ]);
    } catch (err) {
      this.logger.warn("nonce check failed after timeout; keeping the hash", { hash, error: errorMessage(err) });
      return { kind: "timeout" };
    }
    if (pending > latest) {
      this.logger.info("transaction still pending in the mempool; keeping the hash", { hash, latest, pending });
      return { kind: "timeout" };
    }
    let receipt: ReceiptLike | null = null;
    try {
      receipt = await provider.getTransactionReceipt(hash);
    } catch (err) {
      this.logger.warn("final receipt read failed after timeout; keeping the hash", { hash, error: errorMessage(err) });
      return { kind: "timeout" };
    }
    if (receipt && receipt.blockNumber != null) {
      return receipt.status === 0 ? { kind: "reverted", receipt } : { kind: "confirmed", receipt };
    }
    return { kind: "gone" };
  }

  /** Polls for a receipt until mined or the timeout elapses. */
  async awaitReceipt(provider: ChainProvider, hash: string, timeoutMs: number): Promise<ReceiptOutcome> {
    const deadline = this.clock.now() + Math.max(0, timeoutMs);
    for (;;) {
      let receipt: ReceiptLike | null = null;
      try {
        receipt = await provider.getTransactionReceipt(hash);
      } catch (err) {
        this.logger.warn("getTransactionReceipt failed; will retry", { hash, error: errorMessage(err) });
      }
      if (receipt && receipt.blockNumber != null) {
        return receipt.status === 0
          ? { kind: "reverted", receipt }
          : { kind: "confirmed", receipt };
      }
      const now = this.clock.now();
      if (now >= deadline || this.stopRequested && now + this.options.receiptPollMs > deadline) {
        return { kind: "timeout" };
      }
      await this.clock.sleep(Math.min(this.options.receiptPollMs, Math.max(1, deadline - now)));
    }
  }

  /** Timeout budget left for a hash stored by an earlier run (based on updated_at). */
  private remainingTimeout(job: TransferJobRow): number {
    const since = Date.parse(job.updatedAt ?? "");
    if (!Number.isFinite(since)) return this.options.txTimeoutMs;
    const elapsed = Math.max(0, this.clock.now() - since);
    return Math.max(0, this.options.txTimeoutMs - elapsed);
  }

  private async settle(
    job: TransferJobRow,
    pool: PoolRow,
    wallet: WalletRow,
    outcome: ReceiptOutcome,
    transferHash: string
  ): Promise<JobOutcome> {
    if (outcome.kind === "confirmed") return this.finishConfirmed(job, pool, wallet, transferHash);
    if (outcome.kind === "reverted") {
      return this.finishFailed(job, pool, wallet, new WorkerFailure("REVERTED", "Transfer reverted on chain"));
    }
    return this.finishFailed(
      job,
      pool,
      wallet,
      new WorkerFailure("TIMEOUT", "Transfer not mined within MANAGED_TX_TIMEOUT_MS (hash kept)")
    );
  }

  private async finishConfirmed(
    job: TransferJobRow,
    pool: PoolRow,
    wallet: WalletRow,
    transferHash: string
  ): Promise<JobOutcome> {
    await this.deps.transfers.update(job.id, {
      status: "CONFIRMED",
      transferTxHash: transferHash,
      confirmedAt: new Date(this.clock.now()),
      error: null,
      errorCode: null,
    });
    this.logger.info("job confirmed", { jobId: job.id, hash: transferHash });
    const outcome: JobOutcome = {
      jobId: job.id,
      status: "CONFIRMED",
      code: null,
      transferTxHash: transferHash,
      gasTopupTxHash: job.gasTopupTxHash,
    };
    await this.afterTerminal(job, pool, wallet, "TRANSFER_CONFIRMED", outcome, null);
    return outcome;
  }

  private async finishFailed(
    job: TransferJobRow,
    pool: PoolRow | null,
    wallet: WalletRow | null,
    failure: WorkerFailure
  ): Promise<JobOutcome> {
    try {
      await this.deps.transfers.update(job.id, {
        status: "FAILED",
        errorCode: failure.code,
        error: failure.message,
      });
    } catch (err) {
      this.logger.error("could not mark job FAILED", { jobId: job.id, error: errorMessage(err) });
    }
    this.logger.warn("job failed", { jobId: job.id, code: failure.code, error: failure.message });
    const outcome: JobOutcome = {
      jobId: job.id,
      status: "FAILED",
      code: failure.code,
      transferTxHash: job.transferTxHash,
      gasTopupTxHash: job.gasTopupTxHash,
    };
    await this.afterTerminal(job, pool, wallet, "TRANSFER_FAILED", outcome, failure.message);
    return outcome;
  }

  /** Balance refresh (child, managed destination, master) and audit. Never throws. */
  private async afterTerminal(
    job: TransferJobRow,
    pool: PoolRow | null,
    wallet: WalletRow | null,
    action: ManagedAuditAction,
    outcome: JobOutcome,
    error: string | null
  ): Promise<void> {
    if (pool && wallet) {
      try {
        const pairs: DirtyPair[] = [
          { walletId: wallet.id, address: wallet.address, asset: job.asset },
        ];
        if (!isNativeAsset(job.asset)) {
          pairs.push({ walletId: wallet.id, address: wallet.address, asset: NATIVE_ASSET });
        }
        const active = await this.deps.wallets.listActiveAddressesByNetwork(pool.network);
        const destination = active.find((w) => sameAddress(w.address, job.toAddress));
        if (destination) {
          pairs.push({ walletId: destination.walletId, address: destination.address, asset: job.asset });
        }
        await this.deps.balances.refreshPairs(pool.network, pairs);
        await this.deps.balances.refreshMaster(pool);
      } catch (err) {
        this.logger.error("post-job balance refresh failed", { jobId: job.id, error: errorMessage(err) });
      }
    }
    try {
      await this.deps.audits.create({
        userId: job.requestedBy,
        poolId: job.poolId,
        walletId: job.walletId,
        action,
        details: {
          jobId: job.id,
          batchId: job.batchId,
          asset: job.asset,
          toAddress: job.toAddress,
          amountWei: job.amountWei,
          sweepAll: job.sweepAll,
          attempts: job.attempts,
          transferTxHash: outcome.transferTxHash,
          gasTopupTxHash: outcome.gasTopupTxHash,
          errorCode: outcome.code,
          error,
        },
      });
    } catch (err) {
      this.logger.error("audit write failed", { jobId: job.id, error: errorMessage(err) });
    }
  }
}
