/**
 * Deposit indexer — self-hosted Transfer-log scanner (SPEC §6.4).
 *
 * Per network with at least one ACTIVE pool:
 *   head = latestBlock − MANAGED_INDEXER_CONFIRMATIONS (default 15)
 *   from = last_scanned_block + 1; a fresh network (last_scanned_block = 0)
 *   starts AT head: fresh pools do not backfill history (recorded decision).
 *   Scan [from, head] in chunks of MANAGED_INDEXER_BLOCK_CHUNK (default 1000),
 *   addresses OR-listed in topic[2] in groups of MANAGED_INDEXER_ADDRESS_CHUNK
 *   (default 500), filter topics = [TRANSFER_SIG, null, paddedAddresses[]].
 *   Decode token = log.address (lowercase), from = topic1, to = topic2,
 *   amount = BigInt(log.data). Upsert token metadata on first sight, insert
 *   deposits (unique on tx_hash + log_index), collect dirty (wallet, asset)
 *   pairs, advance indexer state after every block chunk. On error: record
 *   last_error, back off, stop the cycle without advancing past the failed chunk.
 *
 * Native BNB deposits have no log; they surface through refreshAll as balance
 * changes only.
 */

import { getAddress, zeroPadValue } from "ethers";
import type { Network } from "../types";
import type { BalanceRefresher, DirtyPair } from "./balances";
import { DEFAULTS, readEnvInt } from "./fees";
import { fetchTokenMetadata } from "./multicall";
import type {
  ChainReader,
  ClockPort,
  DepositInsert,
  DepositsPort,
  IndexerStatePort,
  LoggerPort,
  LogLike,
  PoolsPort,
  TokensPort,
  WalletsPort,
} from "./ports";
import { consoleLogger, systemClock } from "./ports";
import { resilientProvider } from "./rpc";

export const TRANSFER_SIG =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export interface IndexerDeps {
  pools: PoolsPort;
  wallets: WalletsPort;
  tokens: TokensPort;
  deposits: DepositsPort;
  indexerState: IndexerStatePort;
  balances: BalanceRefresher;
  providerFor?: (network: Network) => ChainReader;
  clock?: ClockPort;
  logger?: LoggerPort;
}

export interface IndexerOptions {
  intervalMs: number;
  confirmations: number;
  blockChunk: number;
  addressChunk: number;
  /** Base backoff after an error, doubled per consecutive error (ms). */
  backoffBaseMs: number;
  backoffMaxMs: number;
}

export function indexerOptionsFromEnv(): IndexerOptions {
  return {
    intervalMs: readEnvInt("MANAGED_INDEXER_INTERVAL_MS", DEFAULTS.MANAGED_INDEXER_INTERVAL_MS),
    confirmations: readEnvInt(
      "MANAGED_INDEXER_CONFIRMATIONS",
      DEFAULTS.MANAGED_INDEXER_CONFIRMATIONS
    ),
    blockChunk: Math.max(
      1,
      readEnvInt("MANAGED_INDEXER_BLOCK_CHUNK", DEFAULTS.MANAGED_INDEXER_BLOCK_CHUNK)
    ),
    addressChunk: Math.max(
      1,
      readEnvInt("MANAGED_INDEXER_ADDRESS_CHUNK", DEFAULTS.MANAGED_INDEXER_ADDRESS_CHUNK)
    ),
    backoffBaseMs: 5_000,
    backoffMaxMs: 300_000,
  };
}

export interface IndexerRunResult {
  network: Network;
  /** false when skipped (backoff window, overlapping run, nothing to scan). */
  ran: boolean;
  skippedReason?: "backoff" | "in_flight" | "up_to_date";
  latestBlock: number | null;
  head: number | null;
  fromBlock: number | null;
  /** Last block whose chunk completed (= new last_scanned_block). */
  scannedTo: number | null;
  logs: number;
  depositsInserted: number;
  tokensDiscovered: number;
  dirtyPairs: number;
  error: string | null;
}

/** A decoded Transfer log addressed to a managed wallet. */
export interface DecodedTransfer {
  token: string;
  from: string;
  to: string;
  amountWei: bigint;
  txHash: string;
  logIndex: number;
  blockNumber: number;
}

export function padAddressTopic(address: string): string {
  return zeroPadValue(getAddress(address), 32);
}

function topicToAddress(topic: string): string | null {
  if (typeof topic !== "string" || topic.length !== 66) return null;
  try {
    return getAddress("0x" + topic.slice(26));
  } catch {
    return null;
  }
}

/** Decodes one eth_getLogs entry; null when it is not a well-formed Transfer. */
export function decodeTransferLog(log: LogLike): DecodedTransfer | null {
  if (!log.topics || log.topics.length < 3) return null;
  if (log.topics[0].toLowerCase() !== TRANSFER_SIG) return null;
  const from = topicToAddress(log.topics[1]);
  const to = topicToAddress(log.topics[2]);
  if (!from || !to) return null;
  let amountWei: bigint;
  try {
    amountWei = !log.data || log.data === "0x" ? 0n : BigInt(log.data);
  } catch {
    return null;
  }
  let token: string;
  try {
    token = getAddress(log.address).toLowerCase();
  } catch {
    return null;
  }
  return {
    token,
    from,
    to,
    amountWei,
    txHash: log.transactionHash,
    logIndex: Number(log.index),
    blockNumber: Number(log.blockNumber),
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function errorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.slice(0, 500);
}

export class ManagedIndexer {
  private readonly clock: ClockPort;
  private readonly logger: LoggerPort;
  private readonly providerFor: (network: Network) => ChainReader;
  private timer: NodeJS.Timeout | null = null;
  private cycle: Promise<void> | null = null;
  private readonly inFlight = new Map<Network, Promise<IndexerRunResult>>();
  private readonly backoffUntil = new Map<Network, number>();
  private readonly consecutiveErrors = new Map<Network, number>();
  private stopped = true;

  constructor(
    private readonly deps: IndexerDeps,
    private readonly options: IndexerOptions = indexerOptionsFromEnv()
  ) {
    this.clock = deps.clock ?? systemClock;
    this.logger = deps.logger ?? consoleLogger;
    this.providerFor = deps.providerFor ?? resilientProvider;
  }

  get running(): boolean {
    return !this.stopped;
  }

  /** Starts the timer. Cycles never overlap; a slow cycle simply delays the next. */
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    const tick = () => {
      if (this.stopped) return;
      this.cycle = this.runAll()
        .then(() => undefined)
        .catch((err) => this.logger.error("indexer cycle failed", { error: errorMessage(err) }))
        .finally(() => {
          this.cycle = null;
          if (!this.stopped) this.timer = setTimeout(tick, this.options.intervalMs);
        });
    };
    this.timer = setTimeout(tick, 0);
    this.logger.info("indexer started", { intervalMs: this.options.intervalMs });
  }

  /** Clears the timer and waits for the in-flight cycle. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.cycle) await this.cycle;
    await Promise.allSettled([...this.inFlight.values()]);
    this.logger.info("indexer stopped");
  }

  /** Networks that currently have at least one ACTIVE pool. */
  async activeNetworks(): Promise<Network[]> {
    const pools = await this.deps.pools.listActive();
    const networks = new Set<Network>();
    for (const p of pools) if (p.status === "ACTIVE") networks.add(p.network);
    return [...networks];
  }

  /** One cycle: runOnce for every active network, sequentially. */
  async runAll(): Promise<IndexerRunResult[]> {
    const results: IndexerRunResult[] = [];
    for (const network of await this.activeNetworks()) {
      results.push(await this.runOnce(network));
    }
    return results;
  }

  /**
   * One scan of a network. Concurrent calls for the same network share the
   * in-flight run (the admin "run now" endpoint can call this at any time).
   */
  runOnce(network: Network, opts: { ignoreBackoff?: boolean } = {}): Promise<IndexerRunResult> {
    const existing = this.inFlight.get(network);
    if (existing) return existing;
    const run = this.scan(network, opts.ignoreBackoff === true).finally(() =>
      this.inFlight.delete(network)
    );
    this.inFlight.set(network, run);
    return run;
  }

  private async scan(network: Network, ignoreBackoff: boolean): Promise<IndexerRunResult> {
    const result: IndexerRunResult = {
      network,
      ran: false,
      latestBlock: null,
      head: null,
      fromBlock: null,
      scannedTo: null,
      logs: 0,
      depositsInserted: 0,
      tokensDiscovered: 0,
      dirtyPairs: 0,
      error: null,
    };

    const now = this.clock.now();
    const until = this.backoffUntil.get(network) ?? 0;
    if (!ignoreBackoff && now < until) {
      result.skippedReason = "backoff";
      return result;
    }

    const provider = this.providerFor(network);
    const dirty = new Map<string, DirtyPair>();

    try {
      const latest = await provider.getBlockNumber();
      const head = latest - this.options.confirmations;
      result.latestBlock = latest;
      result.head = head;
      if (head < 0) {
        result.skippedReason = "up_to_date";
        return result;
      }

      const state = await this.deps.indexerState.get(network);
      const last = state?.lastScannedBlock ?? 0;
      // Fresh network: start at head, no backfill.
      const from = last <= 0 ? head : last + 1;
      result.fromBlock = from;
      result.scannedTo = last > 0 ? last : null;
      result.ran = true;

      if (from > head) {
        result.skippedReason = "up_to_date";
        await this.deps.indexerState.upsert({
          network,
          lastRunAt: new Date(this.clock.now()),
          lastError: null,
        });
        this.consecutiveErrors.set(network, 0);
        await this.afterScan(network, dirty);
        return result;
      }

      const active = await this.deps.wallets.listActiveAddressesByNetwork(network);
      const walletByAddress = new Map<string, { walletId: string; address: string }>();
      for (const w of active) {
        walletByAddress.set(w.address.toLowerCase(), { walletId: w.walletId, address: w.address });
      }
      const paddedChunks = chunk(
        [...walletByAddress.values()].map((w) => padAddressTopic(w.address)),
        this.options.addressChunk
      );

      const knownTokens = new Set<string>();
      try {
        for (const t of await this.deps.tokens.listByNetwork(network, true)) {
          knownTokens.add(t.tokenAddress.toLowerCase());
        }
      } catch (err) {
        this.logger.warn("could not preload known tokens; metadata will be re-fetched", {
          network,
          error: errorMessage(err),
        });
      }
      const blockTimes = new Map<number, Date | null>();

      for (let chunkFrom = from; chunkFrom <= head; chunkFrom += this.options.blockChunk) {
        const chunkTo = Math.min(chunkFrom + this.options.blockChunk - 1, head);
        const rows: DepositInsert[] = [];

        if (paddedChunks.length > 0) {
          for (const padded of paddedChunks) {
            const logs = await provider.getLogs({
              fromBlock: chunkFrom,
              toBlock: chunkTo,
              topics: [TRANSFER_SIG, null, padded],
            });
            result.logs += logs.length;

            for (const log of logs) {
              const decoded = decodeTransferLog(log);
              if (!decoded) continue;
              const wallet = walletByAddress.get(decoded.to.toLowerCase());
              if (!wallet) continue;

              if (!knownTokens.has(decoded.token)) {
                const meta = await fetchTokenMetadata(provider, decoded.token);
                await this.deps.tokens.upsertDiscovered({
                  network,
                  tokenAddress: decoded.token,
                  symbol: meta.symbol,
                  name: meta.name,
                  decimals: meta.decimals,
                  firstSeenBlock: decoded.blockNumber,
                });
                knownTokens.add(decoded.token);
                result.tokensDiscovered += 1;
                this.logger.info("token discovered", {
                  network,
                  token: decoded.token,
                  symbol: meta.symbol,
                  decimals: meta.decimals,
                });
              }

              rows.push({
                walletId: wallet.walletId,
                asset: decoded.token,
                fromAddress: decoded.from,
                amountWei: decoded.amountWei.toString(),
                txHash: decoded.txHash,
                logIndex: decoded.logIndex,
                blockNumber: decoded.blockNumber,
                blockTime: await this.blockTime(provider, decoded.blockNumber, blockTimes),
              });
              const key = `${wallet.walletId}:${decoded.token}`;
              if (!dirty.has(key)) {
                dirty.set(key, { walletId: wallet.walletId, address: wallet.address, asset: decoded.token });
              }
            }
          }
        }

        if (rows.length > 0) {
          const inserted = await this.deps.deposits.insertManyIgnoreDuplicates(rows);
          result.depositsInserted += Number(inserted) || 0;
        }
        await this.deps.indexerState.upsert({ network, lastScannedBlock: chunkTo });
        result.scannedTo = chunkTo;
      }

      await this.deps.indexerState.upsert({
        network,
        lastRunAt: new Date(this.clock.now()),
        lastError: null,
      });
      this.consecutiveErrors.set(network, 0);
      this.backoffUntil.delete(network);
      this.logger.info("indexer scan done", {
        network,
        from,
        head,
        logs: result.logs,
        deposits: result.depositsInserted,
        tokens: result.tokensDiscovered,
      });
    } catch (err) {
      const message = errorMessage(err);
      result.error = message;
      const n = (this.consecutiveErrors.get(network) ?? 0) + 1;
      this.consecutiveErrors.set(network, n);
      const backoff = Math.min(
        this.options.backoffBaseMs * 2 ** (n - 1),
        this.options.backoffMaxMs
      );
      this.backoffUntil.set(network, this.clock.now() + backoff);
      this.logger.error("indexer scan failed", { network, error: message, backoffMs: backoff });
      try {
        await this.deps.indexerState.upsert({
          network,
          lastRunAt: new Date(this.clock.now()),
          lastError: message,
        });
      } catch (stateErr) {
        this.logger.error("could not record indexer error", { network, error: errorMessage(stateErr) });
      }
    }

    result.dirtyPairs = dirty.size;
    await this.afterScan(network, dirty);
    return result;
  }

  /** Dirty refresh, then the throttled full refresh and master refresh. */
  private async afterScan(network: Network, dirty: Map<string, DirtyPair>): Promise<void> {
    if (dirty.size > 0) {
      try {
        await this.deps.balances.refreshPairs(network, [...dirty.values()]);
      } catch (err) {
        this.logger.error("dirty balance refresh failed", { network, error: errorMessage(err) });
      }
    }
    try {
      const didFull = await this.deps.balances.refreshAll(network);
      if (didFull) {
        for (const pool of await this.deps.pools.listActive()) {
          if (pool.network !== network) continue;
          try {
            await this.deps.balances.refreshMaster(pool);
          } catch (err) {
            this.logger.error("master balance refresh failed", {
              poolId: pool.id,
              error: errorMessage(err),
            });
          }
        }
      }
    } catch (err) {
      this.logger.error("full balance refresh failed", { network, error: errorMessage(err) });
    }
  }

  private async blockTime(
    provider: ChainReader,
    blockNumber: number,
    cache: Map<number, Date | null>
  ): Promise<Date | null> {
    if (cache.has(blockNumber)) return cache.get(blockNumber) ?? null;
    let value: Date | null = null;
    try {
      const block = await provider.getBlock(blockNumber);
      if (block && Number.isFinite(block.timestamp)) value = new Date(block.timestamp * 1000);
    } catch {
      value = null;
    }
    // Keep the cache small: it only needs to cover one chunk's distinct blocks.
    if (cache.size > 5_000) cache.clear();
    cache.set(blockNumber, value);
    return value;
  }
}
