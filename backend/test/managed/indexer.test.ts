import { describe, expect, it } from "vitest";
import { Interface, getAddress, zeroPadValue } from "ethers";
import {
  ManagedIndexer,
  TRANSFER_SIG,
  decodeTransferLog,
  isTransientStoreError,
  padAddressTopic,
  shrinkSpanOnRangeError,
  MIN_LOG_BLOCK_SPAN,
} from "../../src/managed/chain/indexer";
import type { IndexerOptions } from "../../src/managed/chain/indexer";
import type { BalanceRefresher, DirtyPair } from "../../src/managed/chain/balances";
import type {
  ActiveWalletAddress,
  ChainReader,
  DepositInsert,
  DepositsPort,
  DiscoveredTokenInput,
  IndexerStatePort,
  IndexerStateRow,
  IndexerStateUpsert,
  LogFilter,
  LogLike,
  LoggerPort,
  PoolRow,
  PoolsPort,
  TokenRow,
  TokensPort,
  WalletsPort,
} from "../../src/managed/chain/ports";
import type { Network } from "../../src/managed/types";
import fixture from "./fixtures/transferLogs.json";
import malformedFixture from "./fixtures/malformedTransferLogs.json";

// ─── Fixture → ethers-shaped logs ────────────────────────────────────────────

interface RawLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
}

function toLogLike(raw: RawLog): LogLike {
  return {
    address: raw.address,
    topics: raw.topics,
    data: raw.data,
    blockNumber: Number(BigInt(raw.blockNumber)),
    transactionHash: raw.transactionHash,
    index: Number(BigInt(raw.logIndex)),
  };
}

const FIXTURE_LOGS: LogLike[] = (fixture.logs as RawLog[]).map(toLogLike);
/** Transfer-signature logs to W1 that must be rejected (SR-02). */
const MALFORMED_LOGS: LogLike[] = (malformedFixture.logs as RawLog[]).map(toLogLike);
const ZERO_WORD = "0x" + "00".repeat(32);

const NETWORK: Network = "bscTestnet";
const W1 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const W2 = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const SENDER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const TOKEN_A = "0x1111111111111111111111111111111111111111";
const TOKEN_B = "0x2222222222222222222222222222222222222222";

const erc20 = new Interface([
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
]);

// ─── Fakes ───────────────────────────────────────────────────────────────────

class FakeProvider implements ChainReader {
  latest = 1016; // head = 1001 with 15 confirmations
  getLogsCalls: LogFilter[] = [];
  failOnBlock: number | null = null;
  /** Extra logs the node returns on top of the fixture (malformed cases). */
  extraLogs: LogLike[] = [];

  async getBlockNumber(): Promise<number> {
    return this.latest;
  }
  async getLogs(filter: LogFilter): Promise<LogLike[]> {
    this.getLogsCalls.push(filter);
    if (this.failOnBlock !== null && filter.fromBlock <= this.failOnBlock && filter.toBlock >= this.failOnBlock) {
      throw Object.assign(new Error("429 Too Many Requests"), { code: "SERVER_ERROR" });
    }
    // Like a node: respect the block range (topic filtering is left to the indexer on purpose).
    return [...FIXTURE_LOGS, ...this.extraLogs].filter(
      (l) => l.blockNumber >= filter.fromBlock && l.blockNumber <= filter.toBlock
    );
  }
  async getBlock(blockNumber: number): Promise<{ timestamp: number } | null> {
    return { timestamp: 1_700_000_000 + blockNumber };
  }
  async call(tx: { to: string; data: string }): Promise<string> {
    if (tx.to.toLowerCase() === TOKEN_A) {
      const selector = tx.data.slice(0, 10);
      if (selector === erc20.getFunction("symbol")!.selector) return erc20.encodeFunctionResult("symbol", ["AAA"]);
      if (selector === erc20.getFunction("name")!.selector) return erc20.encodeFunctionResult("name", ["Token A"]);
      if (selector === erc20.getFunction("decimals")!.selector) return erc20.encodeFunctionResult("decimals", [6]);
    }
    throw new Error("execution reverted");
  }
  async getBalance(): Promise<bigint> {
    return 0n;
  }
}

class FakeTokens implements TokensPort {
  discovered: DiscoveredTokenInput[] = [];
  async upsertDiscovered(input: DiscoveredTokenInput): Promise<void> {
    this.discovered.push(input);
  }
  async listByNetwork(): Promise<TokenRow[]> {
    return this.discovered.map((d) => ({
      tokenAddress: d.tokenAddress,
      symbol: d.symbol,
      name: d.name,
      decimals: d.decimals,
      hidden: false,
      source: "DISCOVERED",
    }));
  }
}

class FakeDeposits implements DepositsPort {
  rows = new Map<string, DepositInsert>();
  calls = 0;
  /** Like Postgres: any batch containing a poisoned row fails as a whole. */
  poison = new Map<string, Error>();
  async insertManyIgnoreDuplicates(rows: DepositInsert[]): Promise<number> {
    this.calls += 1;
    for (const r of rows) {
      const bad = this.poison.get(`${r.txHash}:${r.logIndex}`);
      if (bad) throw bad;
    }
    let inserted = 0;
    for (const r of rows) {
      const key = `${r.txHash}:${r.logIndex}`;
      if (!this.rows.has(key)) {
        this.rows.set(key, r);
        inserted += 1;
      }
    }
    return inserted;
  }
}

class FakeIndexerState implements IndexerStatePort {
  state: IndexerStateRow | null;
  history: IndexerStateUpsert[] = [];
  constructor(lastScannedBlock: number) {
    this.state = { network: NETWORK, lastScannedBlock, lastRunAt: null, lastError: null };
  }
  async get(): Promise<IndexerStateRow | null> {
    return this.state;
  }
  async upsert(row: IndexerStateUpsert): Promise<void> {
    this.history.push(row);
    const prev = this.state ?? { network: NETWORK, lastScannedBlock: 0, lastRunAt: null, lastError: null };
    this.state = {
      network: row.network,
      lastScannedBlock: row.lastScannedBlock ?? prev.lastScannedBlock,
      lastRunAt: row.lastRunAt === undefined ? prev.lastRunAt : row.lastRunAt,
      lastError: row.lastError === undefined ? prev.lastError : row.lastError,
    };
  }
}

class FakeBalances implements BalanceRefresher {
  refreshed: DirtyPair[][] = [];
  fullRuns = 0;
  masterRuns = 0;
  async refreshPairs(_network: Network, pairs: DirtyPair[]): Promise<void> {
    this.refreshed.push(pairs);
  }
  async refreshAll(): Promise<boolean> {
    this.fullRuns += 1;
    return false;
  }
  async refreshMaster(): Promise<void> {
    this.masterRuns += 1;
  }
}

const wallets: WalletsPort = {
  async findById() {
    return null;
  },
  async listActiveAddressesByNetwork(): Promise<ActiveWalletAddress[]> {
    return [
      { walletId: "w1", poolId: "p1", address: W1 },
      { walletId: "w2", poolId: "p1", address: W2 },
    ];
  },
};

const pools: PoolsPort = {
  async findById() {
    return null;
  },
  async listActive(): Promise<PoolRow[]> {
    return [
      {
        id: "p1",
        name: "Pool",
        network: NETWORK,
        masterAddress: SENDER,
        status: "ACTIVE",
        accountPath: "m/44'/60'/0'/0",
      },
    ];
  },
};

const silent: LoggerPort = { info: () => undefined, warn: () => undefined, error: () => undefined };

const options: IndexerOptions = {
  intervalMs: 30_000,
  confirmations: 15,
  blockChunk: 1000,
  addressChunk: 500,
  backoffBaseMs: 5_000,
  backoffMaxMs: 300_000,
};

function build(lastScannedBlock: number, overrides: Partial<IndexerOptions> = {}) {
  const provider = new FakeProvider();
  const tokens = new FakeTokens();
  const deposits = new FakeDeposits();
  const state = new FakeIndexerState(lastScannedBlock);
  const balances = new FakeBalances();
  let now = 1_700_000_000_000;
  const clock = { now: () => now, sleep: async (ms: number) => void (now += ms) };
  const indexer = new ManagedIndexer(
    { pools, wallets, tokens, deposits, indexerState: state, balances, providerFor: () => provider, clock, logger: silent },
    { ...options, ...overrides }
  );
  return { indexer, provider, tokens, deposits, state, balances, advance: (ms: number) => void (now += ms) };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("decodeTransferLog", () => {
  it("decodes token, from, to, amount, tx hash, log index", () => {
    const d = decodeTransferLog(FIXTURE_LOGS[0]);
    expect(d).toEqual({
      token: TOKEN_A,
      from: SENDER,
      to: W1,
      amountWei: 100n * 10n ** 18n,
      txHash: FIXTURE_LOGS[0].transactionHash,
      logIndex: 0,
      blockNumber: 1000,
    });
  });

  it("rejects malformed logs", () => {
    expect(decodeTransferLog({ ...FIXTURE_LOGS[0], topics: [TRANSFER_SIG] })).toBeNull();
    expect(decodeTransferLog({ ...FIXTURE_LOGS[0], topics: ["0x" + "11".repeat(32), ...FIXTURE_LOGS[0].topics.slice(1)] })).toBeNull();
    expect(decodeTransferLog({ ...FIXTURE_LOGS[0], data: "0xzz" })).toBeNull();
  });

  it("SR-02: requires exactly 3 topics (ERC-721 Transfer with 4 topics is rejected)", () => {
    const erc721 = MALFORMED_LOGS[1];
    expect(erc721.topics).toHaveLength(4);
    expect(decodeTransferLog(erc721)).toBeNull();
    // A 4th topic with otherwise valid 32-byte data is rejected too.
    expect(decodeTransferLog({ ...FIXTURE_LOGS[0], topics: [...FIXTURE_LOGS[0].topics, ZERO_WORD] })).toBeNull();
  });

  it("SR-02: requires data to be exactly one 32-byte word", () => {
    const tooLong = MALFORMED_LOGS[0];
    expect(tooLong.data).toHaveLength(2 + 66); // 33 bytes
    expect(decodeTransferLog(tooLong)).toBeNull();
    const tooShort = MALFORMED_LOGS[3];
    expect(tooShort.data).toHaveLength(2 + 62); // 31 bytes
    expect(decodeTransferLog(tooShort)).toBeNull();
    expect(decodeTransferLog({ ...FIXTURE_LOGS[0], data: "0x" })).toBeNull();
    expect(decodeTransferLog({ ...FIXTURE_LOGS[0], data: "" })).toBeNull();
    expect(decodeTransferLog({ ...FIXTURE_LOGS[0], data: "0x" + "ff".repeat(64) })).toBeNull(); // two words
    expect(decodeTransferLog({ ...FIXTURE_LOGS[0], data: "0x" + "0g".repeat(32) })).toBeNull(); // non-hex
    expect(decodeTransferLog({ ...FIXTURE_LOGS[0], data: undefined as unknown as string })).toBeNull();
    // A full 32-byte word of 0xff (2^256 − 1) is accepted: it fits NUMERIC(78,0).
    expect(decodeTransferLog({ ...FIXTURE_LOGS[0], data: "0x" + "ff".repeat(32) })?.amountWei).toBe(2n ** 256n - 1n);
  });

  it("SR-02: skips zero amounts", () => {
    expect(decodeTransferLog(MALFORMED_LOGS[2])).toBeNull();
    expect(decodeTransferLog({ ...FIXTURE_LOGS[0], data: ZERO_WORD })).toBeNull();
  });

  it("pads addresses to 32 bytes like ethers.zeroPadValue", () => {
    expect(padAddressTopic(W1)).toBe(zeroPadValue(getAddress(W1), 32));
    expect(padAddressTopic(W1)).toBe(FIXTURE_LOGS[0].topics[2]);
  });
});

describe("isTransientStoreError", () => {
  it("classifies pg SQLSTATE classes and socket errors", () => {
    expect(isTransientStoreError(Object.assign(new Error("x"), { code: "08006" }))).toBe(true);
    expect(isTransientStoreError(Object.assign(new Error("x"), { code: "40P01" }))).toBe(true);
    expect(isTransientStoreError(Object.assign(new Error("x"), { code: "53300" }))).toBe(true);
    expect(isTransientStoreError(Object.assign(new Error("x"), { code: "57P01" }))).toBe(true);
    expect(isTransientStoreError(Object.assign(new Error("x"), { code: "ECONNRESET" }))).toBe(true);
    expect(isTransientStoreError(new Error("Connection terminated unexpectedly"))).toBe(true);
    expect(isTransientStoreError(Object.assign(new Error("numeric field overflow"), { code: "22003" }))).toBe(false);
    expect(isTransientStoreError(Object.assign(new Error("duplicate key"), { code: "23505" }))).toBe(false);
    expect(isTransientStoreError(new Error("value too long"))).toBe(false);
    expect(isTransientStoreError(null)).toBe(false);
  });
});

describe("ManagedIndexer.runOnce", () => {
  it("decodes fixture logs into deposits and discovered tokens for managed wallets only", async () => {
    const t = build(999);
    const result = await t.indexer.runOnce(NETWORK);

    expect(result.error).toBeNull();
    expect(result.ran).toBe(true);
    expect(result.latestBlock).toBe(1016);
    expect(result.head).toBe(1001);
    expect(result.fromBlock).toBe(1000);
    expect(result.scannedTo).toBe(1001);
    expect(result.logs).toBe(4);
    expect(result.depositsInserted).toBe(3);
    expect(result.tokensDiscovered).toBe(2);
    expect(result.dirtyPairs).toBe(3);

    // getLogs filter shape: [TRANSFER_SIG, null, [padded managed addresses]]
    expect(t.provider.getLogsCalls).toHaveLength(1);
    const filter = t.provider.getLogsCalls[0];
    expect(filter.fromBlock).toBe(1000);
    expect(filter.toBlock).toBe(1001);
    expect(filter.topics[0]).toBe(TRANSFER_SIG);
    expect(filter.topics[1]).toBeNull();
    expect(filter.topics[2]).toEqual([padAddressTopic(W1), padAddressTopic(W2)]);

    // Deposits: the log to the non-managed address is skipped.
    const rows = [...t.deposits.rows.values()];
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.walletId).sort()).toEqual(["w1", "w1", "w2"]);
    const w1A = rows.find((r) => r.walletId === "w1" && r.asset === TOKEN_A)!;
    expect(w1A.amountWei).toBe((100n * 10n ** 18n).toString());
    expect(w1A.fromAddress).toBe(SENDER);
    expect(w1A.txHash).toBe(FIXTURE_LOGS[0].transactionHash);
    expect(w1A.logIndex).toBe(0);
    expect(w1A.blockNumber).toBe(1000);
    expect(w1A.blockTime).toEqual(new Date((1_700_000_000 + 1000) * 1000));
    const w2A = rows.find((r) => r.walletId === "w2")!;
    expect(w2A.logIndex).toBe(3);
    expect(w2A.amountWei).toBe((5n * 10n ** 18n).toString());
    const w1B = rows.find((r) => r.walletId === "w1" && r.asset === TOKEN_B)!;
    expect(w1B.amountWei).toBe("1000000");

    // Tokens: metadata for A, fallbacks for B (every call reverts).
    expect(t.tokens.discovered).toHaveLength(2);
    const a = t.tokens.discovered.find((d) => d.tokenAddress === TOKEN_A)!;
    expect(a).toEqual({ network: NETWORK, tokenAddress: TOKEN_A, symbol: "AAA", name: "Token A", decimals: 6, firstSeenBlock: 1000 });
    const b = t.tokens.discovered.find((d) => d.tokenAddress === TOKEN_B)!;
    expect(b).toEqual({ network: NETWORK, tokenAddress: TOKEN_B, symbol: "UNKNOWN", name: "Unknown token", decimals: 18, firstSeenBlock: 1001 });

    // Dirty pairs handed to balances.refreshPairs.
    expect(t.balances.refreshed).toHaveLength(1);
    expect(t.balances.refreshed[0].map((p) => `${p.walletId}:${p.asset}`).sort()).toEqual([
      `w1:${TOKEN_A}`,
      `w1:${TOKEN_B}`,
      `w2:${TOKEN_A}`,
    ]);

    // State advanced to head, lastRunAt stamped, no error.
    expect(t.state.state?.lastScannedBlock).toBe(1001);
    expect(t.state.state?.lastRunAt).not.toBeNull();
    expect(t.state.state?.lastError).toBeNull();
  });

  it("SR-02: malformed logs to a managed wallet are counted, skipped, and never stall the scan", async () => {
    const t = build(999);
    t.provider.extraLogs = MALFORMED_LOGS;
    const result = await t.indexer.runOnce(NETWORK);

    expect(result.error).toBeNull();
    expect(result.logs).toBe(4 + MALFORMED_LOGS.length);
    expect(result.skippedMalformed).toBe(MALFORMED_LOGS.length);
    expect(result.depositsInserted).toBe(3);
    expect(result.skippedRows).toBe(0);
    // Nothing from the malformed token reached the store or token discovery.
    expect([...t.deposits.rows.values()].some((r) => r.asset === "0x3333333333333333333333333333333333333333")).toBe(false);
    expect(t.tokens.discovered.map((d) => d.tokenAddress)).not.toContain("0x3333333333333333333333333333333333333333");
    expect(t.state.state?.lastScannedBlock).toBe(1001);
    expect(t.state.state?.lastError).toBeNull();
  });

  it("SR-02: one poisoned row among good rows is skipped row-by-row and the state still advances", async () => {
    const t = build(999);
    const poisoned = FIXTURE_LOGS[1]; // W1 ← token A, block 1000, log index 3
    t.deposits.poison.set(
      `${poisoned.transactionHash}:${poisoned.index}`,
      Object.assign(new Error("numeric field overflow"), { code: "22003" })
    );
    const result = await t.indexer.runOnce(NETWORK);

    expect(result.error).toBeNull();
    expect(result.depositsInserted).toBe(2);
    expect(result.skippedRows).toBe(1);
    expect(t.deposits.rows.size).toBe(2);
    expect(t.deposits.rows.has(`${poisoned.transactionHash}:${poisoned.index}`)).toBe(false);
    // One failed chunk insert, then one call per row.
    expect(t.deposits.calls).toBe(1 + 3);
    expect(t.state.state?.lastScannedBlock).toBe(1001);
    expect(t.state.state?.lastError).toBeNull();
    // The good rows' dirty pairs are still refreshed.
    expect(t.balances.refreshed).toHaveLength(1);

    // The next run is not stuck behind the bad row.
    const next = await t.indexer.runOnce(NETWORK);
    expect(next.skippedReason).toBe("up_to_date");
  });

  it("SR-02: a one-row chunk whose only row is rejected is skipped too, and the state still advances", async () => {
    const t = build(0); // fresh network: scans block 1001 only → exactly one managed row (W1 ← token B)
    const only = FIXTURE_LOGS[2];
    t.deposits.poison.set(
      `${only.transactionHash}:${only.index}`,
      Object.assign(new Error("numeric field overflow"), { code: "22003" })
    );
    const result = await t.indexer.runOnce(NETWORK);

    expect(result.error).toBeNull();
    expect(result.depositsInserted).toBe(0);
    expect(result.skippedRows).toBe(1);
    expect(t.deposits.calls).toBe(1); // no pointless row-by-row pass for a single row
    expect(t.deposits.rows.size).toBe(0);
    expect(t.state.state?.lastScannedBlock).toBe(1001);
    expect(t.state.state?.lastError).toBeNull();
    expect((await t.indexer.runOnce(NETWORK)).skippedReason).toBe("up_to_date");
  });

  it("SR-02: a transient store error still fails the chunk (retried after backoff), not row-by-row", async () => {
    const t = build(999);
    t.deposits.poison.set(
      `${FIXTURE_LOGS[0].transactionHash}:${FIXTURE_LOGS[0].index}`,
      Object.assign(new Error("connection terminated unexpectedly"), { code: "08006" })
    );
    const result = await t.indexer.runOnce(NETWORK);
    expect(result.error).toContain("08006");
    expect(t.deposits.calls).toBe(1);
    expect(t.state.state?.lastScannedBlock).toBe(999);
    expect(t.state.state?.lastError).toContain("connection terminated");
  });

  it("a duplicate run inserts nothing new", async () => {
    const t = build(999);
    await t.indexer.runOnce(NETWORK);
    expect(t.deposits.rows.size).toBe(3);

    // Second run: state is at head, nothing to scan.
    const second = await t.indexer.runOnce(NETWORK);
    expect(second.skippedReason).toBe("up_to_date");
    expect(second.depositsInserted).toBe(0);
    expect(t.deposits.rows.size).toBe(3);
    expect(t.provider.getLogsCalls).toHaveLength(1);

    // Re-scan of the same range (state rewound): unique (tx_hash, log_index) absorbs it.
    t.state.state = { network: NETWORK, lastScannedBlock: 999, lastRunAt: null, lastError: null };
    const rescan = await t.indexer.runOnce(NETWORK);
    expect(rescan.logs).toBe(4);
    expect(rescan.depositsInserted).toBe(0);
    expect(t.deposits.rows.size).toBe(3);
    // Tokens already known → not re-upserted.
    expect(t.tokens.discovered).toHaveLength(2);
  });

  it("a fresh network starts at head and does not backfill", async () => {
    const t = build(0);
    const result = await t.indexer.runOnce(NETWORK);
    expect(result.fromBlock).toBe(1001);
    expect(result.scannedTo).toBe(1001);
    expect(t.provider.getLogsCalls[0]).toMatchObject({ fromBlock: 1001, toBlock: 1001 });
    // Only the block-1001 logs: W1 ← token B (the other 1001 log is to a non-managed address).
    expect(result.depositsInserted).toBe(1);
    expect(t.state.state?.lastScannedBlock).toBe(1001);
  });

  it("scans in block chunks and advances state after each chunk", async () => {
    const t = build(999, { blockChunk: 1 });
    const result = await t.indexer.runOnce(NETWORK);
    expect(t.provider.getLogsCalls.map((f) => [f.fromBlock, f.toBlock])).toEqual([
      [1000, 1000],
      [1001, 1001],
    ]);
    const advances = t.state.history.filter((h) => h.lastScannedBlock !== undefined).map((h) => h.lastScannedBlock);
    expect(advances).toEqual([1000, 1001]);
    expect(result.depositsInserted).toBe(3);
  });

  it("on an RPC error records last_error, keeps state at the last good chunk, and backs off", async () => {
    const t = build(999, { blockChunk: 1 });
    t.provider.failOnBlock = 1001;
    const result = await t.indexer.runOnce(NETWORK);
    expect(result.error).toContain("429");
    expect(result.scannedTo).toBe(1000);
    expect(t.state.state?.lastScannedBlock).toBe(1000);
    expect(t.state.state?.lastError).toContain("429");
    // Dirty pairs from the good chunk are still refreshed.
    expect(t.balances.refreshed).toHaveLength(1);

    // Backoff window: the next run is skipped until it elapses.
    const skipped = await t.indexer.runOnce(NETWORK);
    expect(skipped.ran).toBe(false);
    expect(skipped.skippedReason).toBe("backoff");

    t.provider.failOnBlock = null;
    t.advance(5_001);
    const resumed = await t.indexer.runOnce(NETWORK);
    expect(resumed.error).toBeNull();
    expect(resumed.fromBlock).toBe(1001);
    expect(t.state.state?.lastScannedBlock).toBe(1001);
    expect(t.state.state?.lastError).toBeNull();
    expect(t.deposits.rows.size).toBe(3);
  });

  it("chunks addresses by addressChunk", async () => {
    const t = build(999, { addressChunk: 1 });
    await t.indexer.runOnce(NETWORK);
    expect(t.provider.getLogsCalls).toHaveLength(2);
    expect(t.provider.getLogsCalls[0].topics[2]).toEqual([padAddressTopic(W1)]);
    expect(t.provider.getLogsCalls[1].topics[2]).toEqual([padAddressTopic(W2)]);
    // Each address chunk returns the same unfiltered fixture; dedupe is by (tx, logIndex).
    expect(t.deposits.rows.size).toBe(3);
  });

  it("concurrent runOnce calls for the same network share one scan", async () => {
    const t = build(999);
    const [a, b] = await Promise.all([t.indexer.runOnce(NETWORK), t.indexer.runOnce(NETWORK)]);
    expect(a).toBe(b);
    expect(t.provider.getLogsCalls).toHaveLength(1);
  });
});

// ─── Provider block-range limits (Alchemy Free tier: 10 blocks) ──────────────

const ALCHEMY_RANGE_ERROR = () =>
  Object.assign(new Error("could not coalesce error"), {
    code: "UNKNOWN_ERROR",
    shortMessage: "could not coalesce error",
    error: {
      code: -32600,
      message:
        "Under the Free tier plan, you can make eth_getLogs requests with up to a 10 block range. Upgrade to PAYG for expanded block range.",
    },
  });

describe("shrinkSpanOnRangeError", () => {
  it("shrinks by 10x down to the minimum on range-limit errors", () => {
    expect(shrinkSpanOnRangeError(ALCHEMY_RANGE_ERROR(), 1000)).toBe(100);
    expect(shrinkSpanOnRangeError(ALCHEMY_RANGE_ERROR(), 100)).toBe(MIN_LOG_BLOCK_SPAN);
    expect(shrinkSpanOnRangeError(new Error("query returned more than 10000 results"), 50)).toBe(MIN_LOG_BLOCK_SPAN);
    expect(shrinkSpanOnRangeError(new Error("limit exceeded"), 1000)).toBe(100);
  });
  it("returns null at the minimum span and for unrelated errors", () => {
    expect(shrinkSpanOnRangeError(ALCHEMY_RANGE_ERROR(), MIN_LOG_BLOCK_SPAN)).toBeNull();
    expect(shrinkSpanOnRangeError(new Error("429 Too Many Requests"), 1000)).toBeNull();
    expect(shrinkSpanOnRangeError(new Error("connection reset"), 1000)).toBeNull();
  });
});

describe("indexer on a provider that caps eth_getLogs at 10 blocks", () => {
  it("shrinks the span, finishes the scan, and keeps the smaller span for later runs", async () => {
    const t = build(900); // scan 901..1001: 101 blocks, above the 10-block cap
    const original = t.provider.getLogs.bind(t.provider);
    t.provider.getLogs = async (filter: LogFilter) => {
      if (filter.toBlock - filter.fromBlock + 1 > 10) {
        t.provider.getLogsCalls.push(filter);
        throw ALCHEMY_RANGE_ERROR();
      }
      return original(filter);
    };
    const result = await t.indexer.runOnce(NETWORK);
    expect(result.error).toBeNull();
    expect(result.depositsInserted).toBe(3);
    expect(result.scannedTo).toBe(1001);
    const rejected = t.provider.getLogsCalls.filter((f) => f.toBlock - f.fromBlock + 1 > 10);
    const accepted = t.provider.getLogsCalls.filter((f) => f.toBlock - f.fromBlock + 1 <= 10);
    expect(rejected.length).toBeGreaterThan(0); // the limit was really hit
    expect(accepted.length).toBeGreaterThan(0);

    // Next run starts directly at the small span: no rejected calls.
    t.provider.latest += 20;
    t.advance(60_000);
    const before = t.provider.getLogsCalls.length;
    await t.indexer.runOnce(NETWORK);
    const later = t.provider.getLogsCalls.slice(before);
    expect(later.length).toBeGreaterThan(0);
    expect(later.every((f) => f.toBlock - f.fromBlock + 1 <= 10)).toBe(true);
  });
});
