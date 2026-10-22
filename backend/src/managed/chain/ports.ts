/**
 * Managed Wallets — chain layer ports.
 *
 * The chain layer (indexer, balances, transfer worker) depends ONLY on the
 * interfaces in this file. It never imports `../models/**` or `../keyVault`.
 * N5 (API wiring) injects the concrete N2 implementations; unit tests pass
 * fakes. Method names mirror the N2 model methods so the wiring is mostly a
 * pass-through.
 *
 * Row shapes reuse `../types` where a matching API object exists. Wei values
 * are decimal strings on rows (as on the API) and bigint inside the chain code.
 *
 * Logger implementations MUST run every argument through `redact()` (N2's
 * `managed/redact.ts`); the chain layer never logs a mnemonic, private key, or
 * raw signed transaction, but the port contract requires redaction anyway.
 */

import type {
  Asset,
  ManagedAuditAction,
  ManagedToken,
  ManagedWallet,
  Network,
  Pool,
  TransferFailureCode,
  TransferJob,
  TransferStatus,
} from "../types";

// ─── Row shapes ──────────────────────────────────────────────────────────────

/** Subset of a `managed_pools` row the chain layer needs. */
export type PoolRow = Pick<
  Pool,
  "id" | "name" | "network" | "masterAddress" | "status" | "accountPath"
> & {
  /** What the encrypted secret is; absent means MNEMONIC (pools before migration 0002). */
  seedType?: Pool["seedType"];
};

/** Subset of a `managed_wallets` row the chain layer needs. */
export type WalletRow = Pick<
  ManagedWallet,
  "id" | "poolId" | "derivationIndex" | "address" | "status"
>;

/** One ACTIVE wallet address, as returned by `listActiveAddressesByNetwork`. */
export interface ActiveWalletAddress {
  walletId: string;
  poolId: string;
  /** Checksummed or lowercase; the chain layer lowercases before comparing. */
  address: string;
}

/** Subset of a `managed_tokens` row the chain layer needs. */
export type TokenRow = Pick<
  ManagedToken,
  "tokenAddress" | "symbol" | "name" | "decimals" | "hidden" | "source"
>;

/** Input for `TokensPort.upsertDiscovered` (first sight of a token in a log). */
export interface DiscoveredTokenInput {
  network: Network;
  /** lowercase */
  tokenAddress: string;
  symbol: string;
  name: string;
  decimals: number;
  firstSeenBlock: number;
}

/** One row for `managed_balances`. */
export interface BalanceUpsert {
  walletId: string;
  asset: Asset;
  /** decimal wei string */
  balanceWei: string;
  blockNumber: number | null;
}

/** One row for `managed_master_balances`. */
export interface MasterBalanceUpsert {
  poolId: string;
  asset: Asset;
  /** decimal wei string */
  balanceWei: string;
  blockNumber: number | null;
}

/** One row for `managed_deposits`; unique on (txHash, logIndex). */
export interface DepositInsert {
  walletId: string;
  /** lowercase token address (native deposits are not itemized in v1) */
  asset: Asset;
  /** checksummed sender */
  fromAddress: string;
  /** decimal wei string */
  amountWei: string;
  txHash: string;
  logIndex: number;
  blockNumber: number;
  blockTime: Date | null;
}

/** Subset of a `managed_transfers` row the worker needs. */
export type TransferJobRow = Pick<
  TransferJob,
  | "id"
  | "poolId"
  | "walletId"
  | "batchId"
  | "toAddress"
  | "asset"
  | "amountWei"
  | "sweepAll"
  | "status"
  | "gasTopupTxHash"
  | "transferTxHash"
  | "attempts"
  | "requestedBy"
  | "updatedAt"
>;

/** Fields the worker writes back. Undefined = untouched. */
export interface TransferJobPatch {
  status?: TransferStatus;
  gasTopupTxHash?: string | null;
  transferTxHash?: string | null;
  /** decimal wei string */
  gasPriceWei?: string | null;
  gasLimit?: number | null;
  /** Human-readable error text (non-secret). */
  error?: string | null;
  /**
   * Typed failure code. The table has only an `error TEXT` column; the model
   * decides how to persist the code (for example `error = "<code>: <text>"`).
   */
  errorCode?: TransferFailureCode | null;
  confirmedAt?: Date | null;
}

/**
 * Result of `pickNextPending`. The model locks the oldest PENDING row with
 * `FOR UPDATE SKIP LOCKED` inside a client transaction and bumps `attempts`.
 * The worker calls `commit()` right after the pick (before any chain I/O) so
 * later `update()` calls are durable immediately and never block on the lock.
 */
export interface PickedJob {
  job: TransferJobRow;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

/** Row of `managed_indexer_state`. */
export interface IndexerStateRow {
  network: Network;
  lastScannedBlock: number;
  lastRunAt: Date | null;
  lastError: string | null;
}

export interface IndexerStateUpsert {
  network: Network;
  lastScannedBlock?: number;
  lastRunAt?: Date | null;
  lastError?: string | null;
}

export interface AuditInput {
  userId: string;
  poolId?: string | null;
  walletId?: string | null;
  action: ManagedAuditAction;
  /** Non-secret details only. */
  details: Record<string, unknown>;
}

// ─── Ports ───────────────────────────────────────────────────────────────────

/** Decrypts a pool's mnemonic (N5 wires keyVault + models/pools). */
export interface VaultPort {
  /** Throws when the key vault is unavailable or the ciphertext is invalid. */
  decryptMnemonic(poolId: string): Promise<string>;
}

export interface PoolsPort {
  findById(id: string): Promise<PoolRow | null>;
  /** All pools with status ACTIVE (drives which networks the indexer scans). */
  listActive(): Promise<PoolRow[]>;
}

export interface WalletsPort {
  findById(id: string): Promise<WalletRow | null>;
  /** ACTIVE wallets of ACTIVE pools on the network. */
  listActiveAddressesByNetwork(network: Network): Promise<ActiveWalletAddress[]>;
}

export interface TokensPort {
  /** Insert on first sight; no-op (or metadata-preserving) when already known. */
  upsertDiscovered(input: DiscoveredTokenInput): Promise<void>;
  listByNetwork(network: Network, includeHidden: boolean): Promise<TokenRow[]>;
}

export interface BalancesPort {
  upsertMany(rows: BalanceUpsert[]): Promise<void>;
  upsertMaster(rows: MasterBalanceUpsert[]): Promise<void>;
}

export interface DepositsPort {
  /** Returns the number of rows actually inserted (duplicates skipped). */
  insertManyIgnoreDuplicates(rows: DepositInsert[]): Promise<number>;
}

export interface TransfersPort {
  pickNextPending(): Promise<PickedJob | null>;
  update(id: string, patch: TransferJobPatch): Promise<void>;
  findById(id: string): Promise<TransferJobRow | null>;
  /**
   * Jobs left in FUNDING_GAS or SENDING by a previous process (restart
   * recovery). Optional: when absent the worker skips recovery at start.
   */
  listInterrupted?(): Promise<TransferJobRow[]>;
}

export interface IndexerStatePort {
  get(network: Network): Promise<IndexerStateRow | null>;
  upsert(row: IndexerStateUpsert): Promise<void>;
}

export interface AuditPort {
  /** Must never throw (same contract as lib/sessionAudit.ts). */
  create(input: AuditInput): Promise<void>;
}

export interface ClockPort {
  /** Milliseconds since epoch. */
  now(): number;
  sleep(ms: number): Promise<void>;
}

export type LogMeta = Record<string, unknown>;

/**
 * Required by every chain-layer constructor. Implementations MUST redact
 * (see the file header); there is no console fallback.
 */
export interface LoggerPort {
  info(message: string, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  error(message: string, meta?: LogMeta): void;
}

// ─── Chain access (structural subset of ethers.JsonRpcProvider) ──────────────

export interface LogLike {
  address: string;
  topics: readonly string[];
  data: string;
  blockNumber: number;
  transactionHash: string;
  /** log index within the block (ethers v6 `Log.index`) */
  index: number;
}

export interface LogFilter {
  fromBlock: number;
  toBlock: number;
  topics: Array<string | null | string[]>;
}

export interface ReceiptLike {
  hash: string;
  blockNumber: number;
  /** 1 success, 0 reverted, null unknown (pre-Byzantium) */
  status: number | null;
}

/** Read-only chain access used by the indexer, balances and multicall. */
export interface ChainReader {
  getBlockNumber(): Promise<number>;
  getLogs(filter: LogFilter): Promise<LogLike[]>;
  getBlock(blockNumber: number): Promise<{ timestamp: number } | null>;
  call(tx: { to: string; data: string; from?: string }): Promise<string>;
  getBalance(address: string): Promise<bigint>;
}

/** Full access used by the transfer worker. */
export interface ChainProvider extends ChainReader {
  getTransactionReceipt(hash: string): Promise<ReceiptLike | null>;
  getTransactionCount(address: string, blockTag?: string): Promise<number>;
  estimateGas(tx: {
    from?: string;
    to: string;
    data?: string;
    value?: bigint;
  }): Promise<bigint>;
  getFeeData(): Promise<{ gasPrice: bigint | null; maxFeePerGas: bigint | null }>;
  broadcastTransaction(signedTx: string): Promise<{ hash: string }>;
}

/** Default clock: real time. */
export const systemClock: ClockPort = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

// There is deliberately no default logger here (SR-09): every chain-layer
// constructor requires a `LoggerPort`, and the only production implementation
// is the redacting `loggerPort` in `../adapters` (managedLog → redact()).
