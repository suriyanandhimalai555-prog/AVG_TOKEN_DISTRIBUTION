import { describe, expect, it } from "vitest";
import { HDNodeWallet, Interface, Transaction, Wallet, parseUnits } from "ethers";
import { TransferWorker, signersFromMnemonic } from "../../src/managed/chain/transferWorker";
import type { WorkerDeps, WorkerOptions } from "../../src/managed/chain/transferWorker";
import type { LogMeta } from "../../src/managed/chain/ports";
import type { BalanceRefresher, DirtyPair } from "../../src/managed/chain/balances";
import type {
  AuditInput,
  ChainProvider,
  LogFilter,
  LogLike,
  LoggerPort,
  PickedJob,
  PoolRow,
  ReceiptLike,
  TransferJobPatch,
  TransferJobRow,
  WalletRow,
} from "../../src/managed/chain/ports";
import { NATIVE_ASSET } from "../../src/managed/types";

// Hardhat test mnemonic: index 0 = 0xf39F…, index 1 = 0x7099…
const MNEMONIC = "test test test test test test test test test test test junk";
const MASTER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const CHILD = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const DEST = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const TOKEN = "0x1111111111111111111111111111111111111111";
const STORED_HASH = "0x" + "ab".repeat(32);

const erc20 = new Interface([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

// ─── Fakes ───────────────────────────────────────────────────────────────────

class FakeProvider implements ChainProvider {
  receipts = new Map<string, ReceiptLike>();
  broadcasts: string[] = [];
  nonces = new Map<string, number>();
  balances = new Map<string, bigint>();
  tokenBalances = new Map<string, bigint>();
  gasEstimate = 50_000n;
  gasPrice = parseUnits("0.1", "gwei");
  /** When true, every broadcast is mined with status 1 immediately. */
  autoMine = true;
  /** Thrown by broadcastTransaction. Cleared after one throw when `broadcastErrorOnce`. */
  broadcastError: Error | null = null;
  broadcastErrorOnce = false;
  /**
   * When true the node accepts (records, mines) the transaction BEFORE the RPC
   * error is thrown: the "node got it, the response never arrived" case.
   */
  acceptBeforeError = false;
  /** Pending nonce per address when it differs from the latest one (mempool). */
  pendingNonces = new Map<string, number>();

  async getBlockNumber(): Promise<number> {
    return 5_000;
  }
  async getLogs(_filter: LogFilter): Promise<LogLike[]> {
    return [];
  }
  async getBlock(): Promise<{ timestamp: number } | null> {
    return { timestamp: 1_700_000_000 };
  }
  async call(tx: { to: string; data: string }): Promise<string> {
    const selector = tx.data.slice(0, 10);
    if (selector === erc20.getFunction("balanceOf")!.selector) {
      const [addr] = erc20.decodeFunctionData("balanceOf", tx.data);
      const key = `${tx.to.toLowerCase()}:${String(addr).toLowerCase()}`;
      return erc20.encodeFunctionResult("balanceOf", [this.tokenBalances.get(key) ?? 0n]);
    }
    throw new Error("execution reverted");
  }
  async getBalance(address: string): Promise<bigint> {
    return this.balances.get(address.toLowerCase()) ?? 0n;
  }
  async getTransactionReceipt(hash: string): Promise<ReceiptLike | null> {
    return this.receipts.get(hash.toLowerCase()) ?? null;
  }
  async getTransactionCount(address: string, blockTag?: string): Promise<number> {
    const key = address.toLowerCase();
    if (blockTag === "pending" && this.pendingNonces.has(key)) return this.pendingNonces.get(key)!;
    return this.nonces.get(key) ?? 0;
  }
  async estimateGas(): Promise<bigint> {
    return this.gasEstimate;
  }
  async getFeeData(): Promise<{ gasPrice: bigint | null; maxFeePerGas: bigint | null }> {
    return { gasPrice: this.gasPrice, maxFeePerGas: null };
  }
  private takeBroadcastError(): Error | null {
    const err = this.broadcastError;
    if (err && this.broadcastErrorOnce) this.broadcastError = null;
    return err;
  }
  async broadcastTransaction(signed: string): Promise<{ hash: string }> {
    if (this.broadcastError && !this.acceptBeforeError) throw this.takeBroadcastError()!;
    const tx = Transaction.from(signed);
    const hash = tx.hash!;
    this.broadcasts.push(signed);
    const from = tx.from!.toLowerCase();
    this.nonces.set(from, (this.nonces.get(from) ?? 0) + 1);
    if (this.autoMine) {
      this.receipts.set(hash.toLowerCase(), { hash, blockNumber: 5_001, status: 1 });
      // Move value so the next balance read reflects the top-up.
      if (tx.to && tx.value > 0n) {
        const to = tx.to.toLowerCase();
        this.balances.set(to, (this.balances.get(to) ?? 0n) + tx.value);
        this.balances.set(from, (this.balances.get(from) ?? 0n) - tx.value);
      }
    }
    const late = this.takeBroadcastError();
    if (late) throw late;
    return { hash };
  }
}

class FakeTransfers {
  patches: Array<{ id: string; patch: TransferJobPatch }> = [];
  queue: TransferJobRow[] = [];
  commits = 0;
  rollbacks = 0;
  interrupted: TransferJobRow[] = [];
  async pickNextPending(): Promise<PickedJob | null> {
    const job = this.queue.shift();
    if (!job) return null;
    return {
      job: { ...job, attempts: job.attempts + 1 },
      commit: async () => void (this.commits += 1),
      rollback: async () => void (this.rollbacks += 1),
    };
  }
  async update(id: string, patch: TransferJobPatch): Promise<void> {
    this.patches.push({ id, patch });
  }
  async findById(): Promise<TransferJobRow | null> {
    return null;
  }
  async listInterrupted(): Promise<TransferJobRow[]> {
    return this.interrupted;
  }
  statuses(): string[] {
    return this.patches.map((p) => p.patch.status).filter((s): s is NonNullable<typeof s> => !!s);
  }
  last(): TransferJobPatch {
    return this.patches[this.patches.length - 1]?.patch ?? {};
  }
}

class FakeBalances implements BalanceRefresher {
  pairs: DirtyPair[][] = [];
  masters: string[] = [];
  async refreshPairs(_n: unknown, pairs: DirtyPair[]): Promise<void> {
    this.pairs.push(pairs);
  }
  async refreshAll(): Promise<boolean> {
    return false;
  }
  async refreshMaster(pool: PoolRow): Promise<void> {
    this.masters.push(pool.id);
  }
}

const silent: LoggerPort = { info: () => undefined, warn: () => undefined, error: () => undefined };

/** Captures every log line so tests can assert what never reaches a sink. */
class CapturingLogger implements LoggerPort {
  lines: Array<{ level: string; message: string; meta: LogMeta | undefined }> = [];
  info = (message: string, meta?: LogMeta) => void this.lines.push({ level: "info", message, meta });
  warn = (message: string, meta?: LogMeta) => void this.lines.push({ level: "warn", message, meta });
  error = (message: string, meta?: LogMeta) => void this.lines.push({ level: "error", message, meta });
  text(): string {
    return this.lines.map((l) => `${l.message} ${JSON.stringify(l.meta ?? {}, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`).join("\n");
  }
}

function ethersLikeError(code: string, shortMessage: string, signedTx: string): Error {
  // ethers v6 makeError: every `info` field (including the raw signed tx and the
  // RPC payload) is serialised into err.message.
  const message = `${shortMessage} (transaction="${signedTx}", info={ "payload": { "method": "eth_sendRawTransaction", "params": [ "${signedTx}" ] } }, code=${code}, version=6.13.0)`;
  return Object.assign(new Error(message), { code, shortMessage });
}
const RAW_SIGNED_TX = "0xf86c" + "ab".repeat(110);

const pool: PoolRow = {
  id: "pool-1",
  name: "Pool",
  network: "bscTestnet",
  masterAddress: MASTER,
  status: "ACTIVE",
  accountPath: "m/44'/60'/0'/0",
};
const wallet: WalletRow = { id: "w-1", poolId: "pool-1", derivationIndex: 1, address: CHILD, status: "ACTIVE" };

function job(overrides: Partial<TransferJobRow> = {}): TransferJobRow {
  return {
    id: "job-1",
    poolId: "pool-1",
    walletId: "w-1",
    batchId: null,
    toAddress: DEST,
    asset: TOKEN,
    amountWei: parseUnits("10", 18).toString(),
    sweepAll: false,
    status: "PENDING",
    gasTopupTxHash: null,
    transferTxHash: null,
    attempts: 1,
    requestedBy: "admin-1",
    updatedAt: new Date(1_700_000_000_000).toISOString(),
    ...overrides,
  };
}

function build(
  opts: { pool?: PoolRow; wallet?: WalletRow; vaultFails?: boolean; realSleep?: boolean; logger?: LoggerPort } = {}
) {
  const provider = new FakeProvider();
  const transfers = new FakeTransfers();
  const balances = new FakeBalances();
  const audits: AuditInput[] = [];
  let now = 1_700_000_000_000;
  const clock = {
    now: () => now,
    sleep: opts.realSleep
      ? (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
      : async (ms: number) => void (now += ms),
  };
  const deps: WorkerDeps = {
    pools: { findById: async () => opts.pool ?? pool, listActive: async () => [opts.pool ?? pool] },
    wallets: {
      findById: async () => opts.wallet ?? wallet,
      listActiveAddressesByNetwork: async () => [
        { walletId: "w-1", poolId: "pool-1", address: CHILD },
        { walletId: "w-2", poolId: "pool-1", address: DEST },
      ],
    },
    transfers,
    vault: {
      decryptMnemonic: async () => {
        if (opts.vaultFails) throw new Error("key vault unavailable");
        return MNEMONIC;
      },
    },
    audits: { create: async (a) => void audits.push(a) },
    balances,
    providerFor: () => provider,
    clock,
    logger: opts.logger ?? silent,
  };
  const options: WorkerOptions = {
    pollIntervalMs: 10,
    txTimeoutMs: 30_000,
    maxAttempts: 3,
    maxGasLimit: 300_000n,
    topUpBufferWei: 100_000_000_000_000n,
    receiptPollMs: 1_000,
    gasPriceBounds: { minWei: parseUnits("0.1", "gwei"), maxWei: parseUnits("5", "gwei") },
    chainIdFor: () => 97,
  };
  const worker = new TransferWorker(deps, options);
  return { worker, provider, transfers, balances, audits };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("TransferWorker restart safety", () => {
  it("a job with a stored transfer hash whose receipt is mined becomes CONFIRMED without any broadcast", async () => {
    const t = build();
    t.provider.receipts.set(STORED_HASH, { hash: STORED_HASH, blockNumber: 4_990, status: 1 });

    const outcome = await t.worker.processJob(job({ status: "SENDING", transferTxHash: STORED_HASH }));

    expect(outcome.status).toBe("CONFIRMED");
    expect(outcome.transferTxHash).toBe(STORED_HASH);
    expect(t.provider.broadcasts).toHaveLength(0);
    expect(t.transfers.statuses()).toEqual(["CONFIRMED"]);
    expect(t.transfers.last()).toMatchObject({ status: "CONFIRMED", transferTxHash: STORED_HASH, errorCode: null });
    expect(t.transfers.last().confirmedAt).toBeInstanceOf(Date);
    // Balances: child asset + native, managed destination asset, master.
    expect(t.balances.pairs).toHaveLength(1);
    expect(t.balances.pairs[0].map((p) => `${p.walletId}:${p.asset}`)).toEqual([
      `w-1:${TOKEN}`,
      `w-1:${NATIVE_ASSET}`,
      `w-2:${TOKEN}`,
    ]);
    expect(t.balances.masters).toEqual(["pool-1"]);
    expect(t.audits).toHaveLength(1);
    expect(t.audits[0]).toMatchObject({
      userId: "admin-1",
      poolId: "pool-1",
      walletId: "w-1",
      action: "TRANSFER_CONFIRMED",
    });
    expect(t.audits[0].details.transferTxHash).toBe(STORED_HASH);
  });

  it("a stored transfer hash with a reverted receipt becomes FAILED REVERTED", async () => {
    const t = build();
    t.provider.receipts.set(STORED_HASH, { hash: STORED_HASH, blockNumber: 4_990, status: 0 });
    const outcome = await t.worker.processJob(job({ status: "SENDING", transferTxHash: STORED_HASH }));
    expect(outcome).toMatchObject({ status: "FAILED", code: "REVERTED", transferTxHash: STORED_HASH });
    expect(t.provider.broadcasts).toHaveLength(0);
    expect(t.audits[0].action).toBe("TRANSFER_FAILED");
  });

  it("a stored transfer hash that never mines but is still in the mempool becomes FAILED TIMEOUT and keeps the hash", async () => {
    const t = build();
    t.provider.nonces.set(CHILD.toLowerCase(), 4);
    t.provider.pendingNonces.set(CHILD.toLowerCase(), 5); // one tx still pending for the child
    const outcome = await t.worker.processJob(job({ status: "SENDING", transferTxHash: STORED_HASH }));
    expect(outcome).toMatchObject({ status: "FAILED", code: "TIMEOUT", transferTxHash: STORED_HASH });
    expect(t.provider.broadcasts).toHaveLength(0);
    const failed = t.transfers.patches.find((p) => p.patch.status === "FAILED")!;
    expect(failed.patch.transferTxHash).toBeUndefined(); // hash untouched
    expect(t.transfers.patches.some((p) => p.patch.transferTxHash === null)).toBe(false);
  });

  it("a stored transfer hash that never mines and is gone from the mempool is cleared and the job is re-signed with the same nonce", async () => {
    const t = build();
    t.provider.balances.set(MASTER.toLowerCase(), parseUnits("1", 18));
    t.provider.balances.set(CHILD.toLowerCase(), parseUnits("0.01", 18));
    t.provider.tokenBalances.set(`${TOKEN}:${CHILD.toLowerCase()}`, parseUnits("100", 18));
    t.provider.nonces.set(CHILD.toLowerCase(), 4); // latest === pending → nothing in the mempool

    const outcome = await t.worker.processJob(job({ status: "SENDING", transferTxHash: STORED_HASH }));

    expect(outcome.status).toBe("CONFIRMED");
    expect(t.provider.broadcasts).toHaveLength(1);
    expect(Transaction.from(t.provider.broadcasts[0]).nonce).toBe(4);
    const i = t.transfers.patches.findIndex((p) => p.patch.transferTxHash === null);
    expect(i).toBeGreaterThanOrEqual(0); // the dead hash was cleared first…
    expect(t.transfers.patches.slice(i + 1).some((p) => typeof p.patch.transferTxHash === "string")).toBe(true); // …then the new one stored
    expect(outcome.transferTxHash).toBe(Transaction.from(t.provider.broadcasts[0]).hash);
  });

  it("a nonce check failure after a timeout keeps the hash (never re-sign on doubt)", async () => {
    const t = build();
    t.provider.getTransactionCount = async () => {
      throw Object.assign(new Error("timeout"), { code: "TIMEOUT" });
    };
    const outcome = await t.worker.processJob(job({ status: "SENDING", transferTxHash: STORED_HASH }));
    expect(outcome).toMatchObject({ status: "FAILED", code: "TIMEOUT", transferTxHash: STORED_HASH });
    expect(t.provider.broadcasts).toHaveLength(0);
  });

  it("a mined top-up hash is not re-sent; the worker continues at SENDING", async () => {
    const t = build();
    t.provider.receipts.set(STORED_HASH, { hash: STORED_HASH, blockNumber: 4_990, status: 1 });
    t.provider.balances.set(CHILD.toLowerCase(), parseUnits("0.01", 18)); // already funded by the top-up
    t.provider.balances.set(MASTER.toLowerCase(), parseUnits("1", 18));
    t.provider.tokenBalances.set(`${TOKEN}:${CHILD.toLowerCase()}`, parseUnits("100", 18));

    const outcome = await t.worker.processJob(job({ status: "FUNDING_GAS", gasTopupTxHash: STORED_HASH }));

    expect(outcome.status).toBe("CONFIRMED");
    expect(t.provider.broadcasts).toHaveLength(1); // only the transfer
    expect(t.transfers.statuses()).toEqual(["SENDING", "CONFIRMED"]);
  });
});

describe("TransferWorker planner rejections and refusals", () => {
  it("marks FAILED with the planner code and never broadcasts", async () => {
    const t = build();
    t.provider.balances.set(MASTER.toLowerCase(), parseUnits("1", 18));
    t.provider.tokenBalances.set(`${TOKEN}:${CHILD.toLowerCase()}`, parseUnits("5", 18)); // < 10 requested

    const outcome = await t.worker.processJob(job());

    expect(outcome).toMatchObject({ status: "FAILED", code: "INSUFFICIENT_TOKEN_BALANCE" });
    expect(t.provider.broadcasts).toHaveLength(0);
    expect(t.transfers.last()).toMatchObject({ status: "FAILED", errorCode: "INSUFFICIENT_TOKEN_BALANCE" });
    expect(typeof t.transfers.last().error).toBe("string");
    expect(t.audits[0]).toMatchObject({ action: "TRANSFER_FAILED" });
    expect(t.audits[0].details.errorCode).toBe("INSUFFICIENT_TOKEN_BALANCE");
  });

  it("master short of BNB → MASTER_INSUFFICIENT_BNB", async () => {
    const t = build();
    t.provider.balances.set(MASTER.toLowerCase(), 0n);
    t.provider.tokenBalances.set(`${TOKEN}:${CHILD.toLowerCase()}`, parseUnits("100", 18));
    const outcome = await t.worker.processJob(job());
    expect(outcome.code).toBe("MASTER_INSUFFICIENT_BNB");
    expect(t.provider.broadcasts).toHaveLength(0);
  });

  it("archived pool → POOL_ARCHIVED, disabled wallet → WALLET_DISABLED", async () => {
    const archived = build({ pool: { ...pool, status: "ARCHIVED" } });
    expect((await archived.worker.processJob(job())).code).toBe("POOL_ARCHIVED");
    const disabled = build({ wallet: { ...wallet, status: "DISABLED" } });
    expect((await disabled.worker.processJob(job())).code).toBe("WALLET_DISABLED");
  });

  it("too many attempts → MAX_ATTEMPTS without touching the vault or chain", async () => {
    const t = build({ vaultFails: true });
    const outcome = await t.worker.processJob(job({ attempts: 4 }));
    expect(outcome.code).toBe("MAX_ATTEMPTS");
    expect(t.provider.broadcasts).toHaveLength(0);
  });

  it("vault failure → KEY_VAULT_UNAVAILABLE", async () => {
    const t = build({ vaultFails: true });
    const outcome = await t.worker.processJob(job());
    expect(outcome.code).toBe("KEY_VAULT_UNAVAILABLE");
  });

  it("broadcast rejection → BROADCAST_FAILED and the pre-stored hash is cleared", async () => {
    const t = build();
    t.provider.balances.set(MASTER.toLowerCase(), parseUnits("1", 18));
    t.provider.balances.set(CHILD.toLowerCase(), parseUnits("0.01", 18));
    t.provider.tokenBalances.set(`${TOKEN}:${CHILD.toLowerCase()}`, parseUnits("100", 18));
    t.provider.broadcastError = new Error("insufficient funds for gas * price + value");
    const outcome = await t.worker.processJob(job());
    expect(outcome.code).toBe("BROADCAST_FAILED");
    expect(outcome.transferTxHash).toBeNull();
    expect(t.transfers.statuses()).toEqual(["SENDING", "FAILED"]);
    const hashPatches = t.transfers.patches.map((p) => p.patch.transferTxHash).filter((h) => h !== undefined);
    expect(hashPatches).toHaveLength(2);
    expect(hashPatches[0]).toMatch(/^0x[0-9a-f]{64}$/); // stored before the broadcast
    expect(hashPatches[1]).toBeNull(); // cleared on the definite rejection
    expect(t.transfers.last().error).toBe("insufficient funds for gas * price + value");
  });
});

describe("TransferWorker broadcast ambiguity (SR-03)", () => {
  function funded(opts: Parameters<typeof build>[0] = {}) {
    const t = build(opts);
    t.provider.balances.set(MASTER.toLowerCase(), parseUnits("1", 18));
    t.provider.balances.set(CHILD.toLowerCase(), parseUnits("0.01", 18));
    t.provider.tokenBalances.set(`${TOKEN}:${CHILD.toLowerCase()}`, parseUnits("100", 18));
    return t;
  }

  it("persists the deterministic hash BEFORE broadcastTransaction, for the top-up and the transfer", async () => {
    const t = build();
    t.provider.balances.set(MASTER.toLowerCase(), parseUnits("1", 18));
    t.provider.balances.set(CHILD.toLowerCase(), 0n); // needs a top-up
    t.provider.tokenBalances.set(`${TOKEN}:${CHILD.toLowerCase()}`, parseUnits("100", 18));
    const storedAtBroadcast: Array<{ hash: string; stored: boolean }> = [];
    const original = t.provider.broadcastTransaction.bind(t.provider);
    t.provider.broadcastTransaction = async (signed: string) => {
      const hash = Transaction.from(signed).hash!;
      const stored = t.transfers.patches.some(
        (p) => p.patch.gasTopupTxHash === hash || p.patch.transferTxHash === hash
      );
      storedAtBroadcast.push({ hash, stored });
      return original(signed);
    };

    const outcome = await t.worker.processJob(job());

    expect(outcome.status).toBe("CONFIRMED");
    expect(storedAtBroadcast).toHaveLength(2);
    expect(storedAtBroadcast.every((s) => s.stored)).toBe(true);
    expect(outcome.gasTopupTxHash).toBe(storedAtBroadcast[0].hash);
    expect(outcome.transferTxHash).toBe(storedAtBroadcast[1].hash);
  });

  it("broadcast timeout then retry: exactly one broadcast; the stored hash equals the precomputed one", async () => {
    const t = funded();
    // The node accepted the transaction, but every RPC timed out before answering.
    t.provider.acceptBeforeError = true;
    t.provider.broadcastErrorOnce = true;
    t.provider.broadcastError = ethersLikeError("TIMEOUT", "timeout", RAW_SIGNED_TX);

    const first = await t.worker.processJob(job());

    expect(t.provider.broadcasts).toHaveLength(1);
    const signed = Transaction.from(t.provider.broadcasts[0]);
    const precomputed = signed.hash!;
    expect(first).toMatchObject({ status: "FAILED", code: "TIMEOUT", transferTxHash: precomputed });
    expect(t.transfers.statuses()).toEqual(["SENDING", "FAILED"]);
    const stored = t.transfers.patches.filter((p) => p.patch.transferTxHash !== undefined);
    expect(stored).toHaveLength(1);
    expect(stored[0].patch.transferTxHash).toBe(precomputed);
    expect(t.transfers.last()).toMatchObject({ status: "FAILED", errorCode: "TIMEOUT" });
    expect(t.transfers.last().error).toMatch(/^Broadcast outcome unknown \(TIMEOUT: timeout\); hash kept$/);
    expect(t.transfers.last().error).not.toContain(RAW_SIGNED_TX);
    expect(t.transfers.last().error).not.toContain("payload");

    // Admin retry keeps the hash for TIMEOUT: the worker observes the chain and never re-signs.
    const retry = await t.worker.processJob(job({ status: "SENDING", transferTxHash: precomputed, attempts: 2 }));
    expect(retry).toMatchObject({ status: "CONFIRMED", transferTxHash: precomputed });
    expect(t.provider.broadcasts).toHaveLength(1);
    expect(t.transfers.patches.some((p) => p.patch.transferTxHash === null)).toBe(false);
  });

  it("broadcast timeout where the node never got the tx: the retry re-signs once, with the same nonce", async () => {
    const t = funded();
    t.provider.nonces.set(CHILD.toLowerCase(), 9);
    t.provider.broadcastErrorOnce = true;
    t.provider.broadcastError = new Error("[managed] all RPC providers for bscTestnet failed: timeout");

    const first = await t.worker.processJob(job());
    expect(first).toMatchObject({ status: "FAILED", code: "TIMEOUT" });
    expect(first.transferTxHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(t.provider.broadcasts).toHaveLength(0);

    // Retry: receipt never appears, latest === pending → the tx is gone → re-sign.
    const retry = await t.worker.processJob(job({ status: "SENDING", transferTxHash: first.transferTxHash, attempts: 2 }));
    expect(retry.status).toBe("CONFIRMED");
    expect(t.provider.broadcasts).toHaveLength(1);
    const tx = Transaction.from(t.provider.broadcasts[0]);
    expect(tx.nonce).toBe(9);
    // Same fields + same nonce → same deterministic hash as the one stored the first time.
    expect(tx.hash).toBe(first.transferTxHash);
    expect(retry.transferTxHash).toBe(first.transferTxHash);
  });

  it("'already known' from the node counts as broadcast", async () => {
    const t = funded();
    t.provider.acceptBeforeError = true;
    t.provider.broadcastErrorOnce = true;
    t.provider.broadcastError = Object.assign(new Error("already known"), { code: "UNKNOWN_ERROR", shortMessage: "already known" });
    const outcome = await t.worker.processJob(job());
    expect(outcome.status).toBe("CONFIRMED");
    expect(outcome.transferTxHash).toBe(Transaction.from(t.provider.broadcasts[0]).hash);
  });

  it("a gas top-up with an ambiguous broadcast keeps its hash and is confirmed on retry without a second top-up", async () => {
    const t = build();
    t.provider.balances.set(MASTER.toLowerCase(), parseUnits("1", 18));
    t.provider.balances.set(CHILD.toLowerCase(), 0n); // needs a top-up
    t.provider.tokenBalances.set(`${TOKEN}:${CHILD.toLowerCase()}`, parseUnits("100", 18));
    t.provider.acceptBeforeError = true;
    t.provider.broadcastErrorOnce = true;
    t.provider.broadcastError = ethersLikeError("NETWORK_ERROR", "could not detect network", RAW_SIGNED_TX);

    const first = await t.worker.processJob(job());
    expect(first).toMatchObject({ status: "FAILED", code: "TIMEOUT", transferTxHash: null });
    expect(t.provider.broadcasts).toHaveLength(1);
    const topupHash = Transaction.from(t.provider.broadcasts[0]).hash!;
    expect(first.gasTopupTxHash).toBe(topupHash);
    expect(t.transfers.statuses()).toEqual(["FUNDING_GAS", "FAILED"]);

    const retry = await t.worker.processJob(job({ status: "FUNDING_GAS", gasTopupTxHash: topupHash, attempts: 2 }));
    expect(retry.status).toBe("CONFIRMED");
    expect(t.provider.broadcasts).toHaveLength(2); // the first top-up + the transfer, never a second top-up
    expect(Transaction.from(t.provider.broadcasts[1]).from).toBe(CHILD);
  });
});

describe("TransferWorker error text (SR-05)", () => {
  it("persists and logs only code + shortMessage of an ethers error, never the raw signed transaction", async () => {
    const logger = new CapturingLogger();
    const t = build({ logger });
    t.provider.balances.set(MASTER.toLowerCase(), parseUnits("1", 18));
    t.provider.balances.set(CHILD.toLowerCase(), parseUnits("0.01", 18));
    t.provider.tokenBalances.set(`${TOKEN}:${CHILD.toLowerCase()}`, parseUnits("100", 18));
    t.provider.broadcastError = ethersLikeError("INSUFFICIENT_FUNDS", "insufficient funds for intrinsic transaction cost", RAW_SIGNED_TX);

    const outcome = await t.worker.processJob(job());

    expect(outcome.code).toBe("BROADCAST_FAILED");
    expect(t.transfers.last().error).toBe("INSUFFICIENT_FUNDS: insufficient funds for intrinsic transaction cost");
    expect(t.audits[0].details.error).toBe("INSUFFICIENT_FUNDS: insufficient funds for intrinsic transaction cost");
    const everything = logger.text() + JSON.stringify(t.transfers.patches) + JSON.stringify(t.audits);
    expect(everything).not.toContain(RAW_SIGNED_TX);
    expect(everything).not.toContain("eth_sendRawTransaction");
    expect(everything).not.toMatch(/0x[0-9a-fA-F]{130,}/);
  });

  it("a plain Error without shortMessage is truncated to 300 chars with long hex runs removed", async () => {
    const t = build();
    t.provider.balances.set(MASTER.toLowerCase(), parseUnits("1", 18));
    t.provider.balances.set(CHILD.toLowerCase(), parseUnits("0.01", 18));
    t.provider.tokenBalances.set(`${TOKEN}:${CHILD.toLowerCase()}`, parseUnits("100", 18));
    t.provider.broadcastError = new Error(`nonce too low: tx ${RAW_SIGNED_TX} ` + "x".repeat(1000));

    await t.worker.processJob(job());

    const stored = t.transfers.last().error!;
    expect(stored.length).toBeLessThanOrEqual(300);
    expect(stored.startsWith("nonce too low: tx 0x[hex-redacted]")).toBe(true);
    expect(stored).not.toContain(RAW_SIGNED_TX);
  });
});

describe("signersFromMnemonic (SR-06)", () => {
  it("returns provider-less Wallets that hold a private key only, with the expected addresses", () => {
    const signers = signersFromMnemonic(MNEMONIC, "m/44'/60'/0'/0", 1);
    expect(signers.master.address).toBe(MASTER);
    expect(signers.child.address).toBe(CHILD);
    for (const signer of [signers.master, signers.child]) {
      expect(signer).toBeInstanceOf(Wallet);
      expect(signer).not.toBeInstanceOf(HDNodeWallet);
      expect(signer.provider).toBeNull();
      expect("mnemonic" in signer).toBe(false);
      expect((signer as unknown as { mnemonic?: unknown }).mnemonic).toBeUndefined();
      expect(JSON.stringify(signer)).not.toContain("test test");
    }
  });

  it("an HDNodeWallet child would have carried the mnemonic (the reason for the Wallet conversion)", () => {
    const account = HDNodeWallet.fromPhrase(MNEMONIC, undefined, "m/44'/60'/0'/0");
    expect(account.deriveChild(1).mnemonic?.phrase).toBe(MNEMONIC);
  });

  it("the worker rejects a seed that does not match the stored addresses", async () => {
    const t = build({ wallet: { ...wallet, derivationIndex: 2 } }); // index 2 ≠ CHILD
    const outcome = await t.worker.processJob(job());
    expect(outcome.code).toBe("UNKNOWN");
    expect(t.transfers.last().error).toContain("does not match the wallet");
  });
});

describe("TransferWorker happy path", () => {
  it("token transfer with zero BNB: FUNDING_GAS → top-up hash → SENDING → transfer hash → CONFIRMED", async () => {
    const t = build();
    t.provider.balances.set(MASTER.toLowerCase(), parseUnits("1", 18));
    t.provider.balances.set(CHILD.toLowerCase(), 0n);
    t.provider.tokenBalances.set(`${TOKEN}:${CHILD.toLowerCase()}`, parseUnits("100", 18));
    t.provider.nonces.set(MASTER.toLowerCase(), 7);

    const outcome = await t.worker.processJob(job());

    expect(outcome.status).toBe("CONFIRMED");
    expect(t.provider.broadcasts).toHaveLength(2);
    expect(t.transfers.statuses()).toEqual(["FUNDING_GAS", "SENDING", "CONFIRMED"]);

    const topup = Transaction.from(t.provider.broadcasts[0]);
    expect(topup.from).toBe(MASTER);
    expect(topup.to).toBe(CHILD);
    expect(topup.nonce).toBe(7);
    expect(topup.gasLimit).toBe(21_000n);
    expect(topup.chainId).toBe(97n);
    expect(topup.type).toBe(0);
    expect(topup.value).toBe(60_000n * parseUnits("0.1", "gwei") + 100_000_000_000_000n);

    const transfer = Transaction.from(t.provider.broadcasts[1]);
    expect(transfer.from).toBe(CHILD);
    expect(transfer.to).toBe(TOKEN);
    expect(transfer.value).toBe(0n);
    expect(transfer.gasLimit).toBe(60_000n);
    expect(transfer.data).toBe(erc20.encodeFunctionData("transfer", [DEST, parseUnits("10", 18)]));

    // Hashes were stored before each broadcast (SR-03), before the status moved on.
    const order = t.transfers.patches.map((p) => Object.keys(p.patch).join(","));
    expect(order).toEqual([
      "gasPriceWei,gasLimit",
      "status",
      "gasTopupTxHash",
      "status",
      "transferTxHash",
      "status,transferTxHash,confirmedAt,error,errorCode",
    ]);
    expect(t.transfers.patches[2].patch.gasTopupTxHash).toBe(topup.hash);
    expect(t.transfers.patches[4].patch.transferTxHash).toBe(transfer.hash);
    expect(outcome.gasTopupTxHash).toBe(topup.hash);
    expect(outcome.transferTxHash).toBe(transfer.hash);
  });

  it("native sweep-all sends childNative − gasCost with no top-up", async () => {
    const t = build();
    const childNative = parseUnits("0.5", 18);
    t.provider.balances.set(CHILD.toLowerCase(), childNative);
    t.provider.gasEstimate = 21_000n;

    const outcome = await t.worker.processJob(job({ asset: NATIVE_ASSET, sweepAll: true, amountWei: "0" }));

    expect(outcome.status).toBe("CONFIRMED");
    expect(t.provider.broadcasts).toHaveLength(1);
    const tx = Transaction.from(t.provider.broadcasts[0]);
    expect(tx.to).toBe(DEST);
    expect(tx.value).toBe(childNative - 25_200n * parseUnits("0.1", "gwei"));
    expect(t.transfers.statuses()).toEqual(["SENDING", "CONFIRMED"]);
  });

  it("tick() picks, commits, processes one job; returns false when idle", async () => {
    const t = build();
    t.provider.balances.set(MASTER.toLowerCase(), parseUnits("1", 18));
    t.provider.balances.set(CHILD.toLowerCase(), parseUnits("0.01", 18));
    t.provider.tokenBalances.set(`${TOKEN}:${CHILD.toLowerCase()}`, parseUnits("100", 18));
    t.transfers.queue.push(job({ attempts: 0 }));

    expect(await t.worker.tick()).toBe(true);
    expect(t.transfers.commits).toBe(1);
    expect(t.transfers.statuses()).toEqual(["SENDING", "CONFIRMED"]);
    expect(await t.worker.tick()).toBe(false);
  });

  it("recoverInterrupted re-queues jobs without hashes and resolves those with hashes", async () => {
    const t = build();
    t.provider.receipts.set(STORED_HASH, { hash: STORED_HASH, blockNumber: 4_990, status: 1 });
    t.transfers.interrupted = [
      job({ id: "job-a", status: "FUNDING_GAS" }),
      job({ id: "job-b", status: "SENDING", transferTxHash: STORED_HASH }),
    ];
    await t.worker.recoverInterrupted();
    expect(t.transfers.patches.find((p) => p.id === "job-a")?.patch).toEqual({ status: "PENDING" });
    expect(t.transfers.patches.find((p) => p.id === "job-b")?.patch.status).toBe("CONFIRMED");
    expect(t.provider.broadcasts).toHaveLength(0);
  });

  it("start/stop runs the loop, drains a job, and stops cleanly", async () => {
    const t = build({ realSleep: true });
    t.provider.balances.set(MASTER.toLowerCase(), parseUnits("1", 18));
    t.provider.balances.set(CHILD.toLowerCase(), parseUnits("0.01", 18));
    t.provider.tokenBalances.set(`${TOKEN}:${CHILD.toLowerCase()}`, parseUnits("100", 18));
    t.transfers.queue.push(job({ attempts: 0 }));

    t.worker.start();
    t.worker.start(); // idempotent
    expect(t.worker.running).toBe(true);
    const deadline = Date.now() + 2_000;
    while (!t.transfers.statuses().includes("CONFIRMED") && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5));
    }
    await t.worker.stop();
    expect(t.worker.running).toBe(false);
    expect(t.transfers.commits).toBe(1);
    expect(t.transfers.statuses()).toEqual(["SENDING", "CONFIRMED"]);
  });

  it("stop() requested before the first pick processes nothing", async () => {
    const t = build({ realSleep: true });
    t.transfers.queue.push(job({ attempts: 0 }));
    t.worker.start();
    await t.worker.stop();
    expect(t.worker.running).toBe(false);
    expect(t.transfers.patches).toEqual([]);
  });
});
