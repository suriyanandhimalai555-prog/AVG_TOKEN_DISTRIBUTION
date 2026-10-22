/**
 * Managed Wallets — MOCK API client (N4).
 *
 * There is no backend for the feature yet. This module implements every
 * endpoint of docs/managed-wallets/API.md as an async method returning typed
 * fixtures from managedTypes.ts, with small artificial delays and a
 * module-level in-memory state so create / generate / assign / transfer show
 * up in later list calls.
 *
 * Errors are thrown with the same shape axios produces
 * (`err.response.status`, `err.response.data.{error,code}`) so pages can use
 * one error helper for both the mock and the real client.
 *
 * N6 replaces this module with frontend/src/lib/managedApi.ts (real client over
 * the axios instance) by changing ONE import in
 * frontend/src/components/managed/client.ts. Keep the method names and
 * signatures below identical to that file.
 */
import type {
  Asset,
  BalanceEntry,
  CreatePoolRequest,
  CreatePoolResponse,
  CreateTransferRequest,
  CreateTransferResponse,
  Deposit,
  GenerateWalletsRequest,
  GenerateWalletsResponse,
  GetPoolResponse,
  GetTransferResponse,
  GetWalletResponse,
  GlobalTreasuryResponse,
  HealthResponse,
  IndexerNetworkStatus,
  IndexerRunResponse,
  IndexerStatusResponse,
  ListDepositsQuery,
  ListDepositsResponse,
  ListPoolsResponse,
  ListTokensQuery,
  ListTokensResponse,
  ListTransfersQuery,
  ListTransfersResponse,
  ListWalletsQuery,
  ListWalletsResponse,
  ManagedToken,
  ManagedWallet,
  ManagedWalletWithBalances,
  Network,
  PlanTransferRequest,
  PlanTransferResponse,
  Pool,
  PoolSummary,
  PoolTreasuryResponse,
  ReauthResponse,
  RevealMnemonicResponse,
  RotateViewTokenResponse,
  SweepRequest,
  SweepResponse,
  TrackTokenRequest,
  TrackTokenResponse,
  TransferJob,
  TransferPlan,
  TransferStatus,
  TransferTxIntent,
  TreasuryMasterBalance,
  TreasuryTotal,
  UpdatePoolRequest,
  UpdatePoolResponse,
  UpdateTokenRequest,
  UpdateTokenResponse,
  UpdateWalletRequest,
  UpdateWalletResponse,
} from "@/lib/managedTypes";
import { NATIVE_ASSET } from "@/lib/managedTypes";

// ─── Error shape (axios-compatible) ──────────────────────────────────────────

export class MockApiError extends Error {
  response: { status: number; data: { error: string; code?: string } };
  constructor(status: number, error: string, code?: string) {
    super(error);
    this.name = "MockApiError";
    this.response = { status, data: { error, code } };
  }
}

// ─── Small deterministic helpers ─────────────────────────────────────────────

let seed = 0x9e3779b9;
function rnd(): number {
  // xorshift32 — deterministic fixtures across reloads
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) / 0xffffffff;
}
function hex(n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += Math.floor(rnd() * 16).toString(16);
  return s;
}
function fakeAddress(): string {
  return `0x${hex(40)}`;
}
function fakeHash(): string {
  return `0x${hex(64)}`;
}
function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${hex(4)}-${hex(12)}`;
}
function nowIso(): string {
  return new Date().toISOString();
}
function agoIso(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
async function delay(): Promise<void> {
  await sleep(120 + Math.floor(Math.random() * 230));
}

/** wei string → human string (truncating), BigInt based. */
function fmtUnits(wei: string, decimals: number): string {
  let v: bigint;
  try {
    v = BigInt(wei);
  } catch {
    return "0";
  }
  const neg = v < 0n;
  if (neg) v = -v;
  const base = 10n ** BigInt(decimals);
  const int = v / base;
  let frac = (v % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  if (frac.length > 6) frac = frac.slice(0, 6);
  return `${neg ? "-" : ""}${int.toString()}${frac ? `.${frac}` : ""}`;
}
/** human string → wei string. Throws on garbage. */
function parseUnits(amount: string, decimals: number): bigint {
  const t = amount.trim();
  if (!/^\d*\.?\d*$/.test(t) || t === "" || t === ".") throw new Error("bad amount");
  const [i = "0", f = ""] = t.split(".");
  const frac = (f + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(i || "0") * 10n ** BigInt(decimals) + BigInt(frac || "0");
}

const NATIVE_SYMBOL: Record<Network, "BNB" | "tBNB"> = { bscMainnet: "BNB", bscTestnet: "tBNB" };
const GAS_PRICE_WEI = 100_000_000n; // 0.1 gwei
const TOPUP_BUFFER_WEI = 100_000_000_000_000n; // 0.0001 BNB
const MAX_ATTEMPTS = 3;
const MOCK_CLIENT_URL = "https://holderforge.io";

// ─── In-memory state ─────────────────────────────────────────────────────────

interface PoolRow extends Pool {
  mnemonic: string;
}
interface WalletRow extends ManagedWallet {
  viewToken: string;
  /** asset → wei */
  balances: Map<Asset, string>;
}
interface MasterRow {
  poolId: string;
  balances: Map<Asset, string>;
}

const state = {
  pools: [] as PoolRow[],
  wallets: [] as WalletRow[],
  master: [] as MasterRow[],
  tokens: [] as ManagedToken[],
  deposits: [] as Deposit[],
  transfers: [] as TransferJob[],
  indexer: [] as IndexerNetworkStatus[],
  keyVault: "ok" as "ok" | "missing",
  indexerRunning: false,
};
const idempotency = new Map<string, string>();

const WORDS =
  "abandon ability able about above absent absorb abstract absurd abuse access accident account accuse achieve acid acoustic acquire across act action actor actress actual adapt add addict address adjust admit adult advance advice aerobic affair afford afraid again age agent agree ahead aim air airport aisle alarm album alcohol alert alien all alley allow almost alone alpha already also alter always amateur amazing among amount amused analyst anchor ancient anger angle angry animal ankle announce annual another answer antenna antique anxiety any apart apology appear apple approve april arch arctic area arena argue arm armed armor army around arrange arrest arrive arrow art artefact artist artwork ask aspect assault asset assist assume asthma athlete atom attack attend attitude attract auction audit august aunt author auto autumn average avocado avoid awake aware away awesome awful awkward axis".split(
    " "
  );
function fakeMnemonic(words: 12 | 24 = 12): string {
  const out: string[] = [];
  for (let i = 0; i < words; i++) out.push(WORDS[Math.floor(rnd() * WORDS.length)]);
  return out.join(" ");
}

function tokenFor(network: Network, asset: Asset): ManagedToken | undefined {
  return state.tokens.find((t) => t.network === network && t.tokenAddress === asset);
}
function assetMeta(network: Network, asset: Asset): { symbol: string; name: string; decimals: number; hidden: boolean } {
  if (asset === NATIVE_ASSET) return { symbol: NATIVE_SYMBOL[network], name: "BNB", decimals: 18, hidden: false };
  const t = tokenFor(network, asset);
  return t
    ? { symbol: t.symbol, name: t.name, decimals: t.decimals, hidden: t.hidden }
    : { symbol: "UNKNOWN", name: "Unknown token", decimals: 18, hidden: false };
}
function poolOf(w: WalletRow): PoolRow {
  const p = state.pools.find((x) => x.id === w.poolId);
  if (!p) throw new MockApiError(404, "Pool not found", "POOL_NOT_FOUND");
  return p;
}
function masterOf(poolId: string): MasterRow {
  let m = state.master.find((x) => x.poolId === poolId);
  if (!m) {
    m = { poolId, balances: new Map([[NATIVE_ASSET, "0"]]) };
    state.master.push(m);
  }
  return m;
}
function balanceEntries(w: WalletRow): BalanceEntry[] {
  const pool = poolOf(w);
  const out: BalanceEntry[] = [];
  for (const [asset, wei] of w.balances) {
    const meta = assetMeta(pool.network, asset);
    if (meta.hidden) continue;
    out.push({
      asset,
      symbol: meta.symbol,
      name: meta.name,
      decimals: meta.decimals,
      balanceWei: wei,
      balance: fmtUnits(wei, meta.decimals),
      blockNumber: 45_123_000,
      updatedAt: agoIso(60_000),
      hidden: false,
    });
  }
  // native always first
  out.sort((a, b) => (a.asset === NATIVE_ASSET ? -1 : b.asset === NATIVE_ASSET ? 1 : a.symbol.localeCompare(b.symbol)));
  return out;
}
function lastDepositAt(walletId: string): string | null {
  const d = state.deposits.filter((x) => x.walletId === walletId).sort((a, b) => b.blockNumber - a.blockNumber)[0];
  return d ? d.blockTime ?? d.createdAt : null;
}
function withBalances(w: WalletRow): ManagedWalletWithBalances {
  const { viewToken: _vt, balances: _b, ...plain } = w;
  void _vt;
  void _b;
  return { ...plain, balances: balanceEntries(w), lastDepositAt: lastDepositAt(w.id) };
}
function viewUrlFor(token: string): string {
  return `${MOCK_CLIENT_URL}/w/${token}`;
}
function summaryOf(p: PoolRow): PoolSummary {
  return {
    id: p.id,
    name: p.name,
    network: p.network,
    masterAddress: p.masterAddress,
    seedType: p.seedType,
    walletCount: state.wallets.filter((w) => w.poolId === p.id).length,
    status: p.status,
    createdAt: p.createdAt,
  };
}
function publicPool(p: PoolRow): Pool {
  const { mnemonic: _m, ...rest } = p;
  void _m;
  return { ...rest, walletCount: summaryOf(p).walletCount };
}
function findPool(id: string): PoolRow {
  const p = state.pools.find((x) => x.id === id);
  if (!p) throw new MockApiError(404, "Pool not found", "POOL_NOT_FOUND");
  return p;
}
function findWallet(id: string): WalletRow {
  const w = state.wallets.find((x) => x.id === id);
  if (!w) throw new MockApiError(404, "Wallet not found", "WALLET_NOT_FOUND");
  return w;
}
function findJob(id: string): TransferJob {
  const j = state.transfers.find((x) => x.id === id);
  if (!j) throw new MockApiError(404, "Transfer not found", "TRANSFER_NOT_FOUND");
  return j;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

function addPool(name: string, network: Network, createdAgoMs: number, masterNativeWei: string): PoolRow {
  const p: PoolRow = {
    id: uuid(),
    name,
    network,
    masterAddress: fakeAddress(),
    seedType: "MNEMONIC",
    walletCount: 0,
    status: "ACTIVE",
    createdAt: agoIso(createdAgoMs),
    accountPath: "m/44'/60'/0'/0",
    nextIndex: 1,
    keyVersion: 1,
    mnemonicRevealedAt: null,
    updatedAt: agoIso(createdAgoMs),
    mnemonic: fakeMnemonic(12),
  };
  state.pools.push(p);
  state.master.push({ poolId: p.id, balances: new Map([[NATIVE_ASSET, masterNativeWei]]) });
  return p;
}
function addWallets(pool: PoolRow, count: number, labelPrefix?: string): WalletRow[] {
  const created: WalletRow[] = [];
  for (let i = 0; i < count; i++) {
    const idx = pool.nextIndex++;
    const w: WalletRow = {
      id: uuid(),
      poolId: pool.id,
      derivationIndex: idx,
      address: fakeAddress(),
      label: labelPrefix ? `${labelPrefix}${idx}` : null,
      holderName: null,
      holderEmail: null,
      holderUserId: null,
      status: "ACTIVE",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      viewToken: hex(64),
      balances: new Map([[NATIVE_ASSET, "0"]]),
    };
    state.wallets.push(w);
    created.push(w);
  }
  pool.updatedAt = nowIso();
  return created;
}
function addToken(network: Network, symbol: string, name: string, decimals: number, source: ManagedToken["source"], hidden = false): ManagedToken {
  const t: ManagedToken = {
    id: uuid(),
    network,
    tokenAddress: fakeAddress().toLowerCase(),
    symbol,
    name,
    decimals,
    source,
    hidden,
    firstSeenBlock: source === "DISCOVERED" ? 45_100_000 + Math.floor(rnd() * 20_000) : null,
    createdAt: agoIso(86_400_000 * 3),
  };
  state.tokens.push(t);
  return t;
}
function addDeposit(w: WalletRow, asset: Asset, amountWei: string, agoMs: number): Deposit {
  const pool = poolOf(w);
  const meta = assetMeta(pool.network, asset);
  const d: Deposit = {
    id: uuid(),
    walletId: w.id,
    walletAddress: w.address,
    asset,
    symbol: meta.symbol,
    decimals: meta.decimals,
    fromAddress: fakeAddress(),
    amountWei,
    amount: fmtUnits(amountWei, meta.decimals),
    txHash: fakeHash(),
    logIndex: Math.floor(rnd() * 40),
    blockNumber: 45_123_456 - Math.floor(agoMs / 3000),
    blockTime: agoIso(agoMs),
    createdAt: agoIso(agoMs),
  };
  state.deposits.push(d);
  const prev = BigInt(w.balances.get(asset) ?? "0");
  w.balances.set(asset, (prev + BigInt(amountWei)).toString());
  return d;
}
function addJob(
  w: WalletRow,
  asset: Asset,
  amountWei: string,
  status: TransferStatus,
  opts: { batchId?: string | null; sweepAll?: boolean; agoMs?: number; error?: string; errorCode?: TransferJob["errorCode"]; topup?: boolean } = {}
): TransferJob {
  const pool = poolOf(w);
  const meta = assetMeta(pool.network, asset);
  const terminal = status === "CONFIRMED" || status === "FAILED" || status === "CANCELLED";
  const ago = opts.agoMs ?? 3_600_000;
  const j: TransferJob = {
    id: uuid(),
    poolId: pool.id,
    walletId: w.id,
    walletAddress: w.address,
    batchId: opts.batchId ?? null,
    toAddress: pool.masterAddress,
    asset,
    symbol: meta.symbol,
    decimals: meta.decimals,
    amountWei,
    amount: fmtUnits(amountWei, meta.decimals),
    sweepAll: opts.sweepAll ?? false,
    status,
    gasTopupTxHash: opts.topup && status !== "PENDING" ? fakeHash() : null,
    transferTxHash: status === "SENDING" || status === "CONFIRMED" ? fakeHash() : null,
    gasPriceWei: GAS_PRICE_WEI.toString(),
    gasLimit: asset === NATIVE_ASSET ? 21_000 : 65_000,
    error: opts.error ?? null,
    errorCode: opts.errorCode ?? null,
    attempts: status === "PENDING" ? 0 : 1,
    requestedBy: "admin-user",
    createdAt: agoIso(ago),
    updatedAt: agoIso(terminal ? ago - 60_000 : 5_000),
    confirmedAt: status === "CONFIRMED" ? agoIso(ago - 60_000) : null,
  };
  state.transfers.push(j);
  return j;
}

function seedFixtures(): void {
  const abc = addToken("bscTestnet", "ABC", "ABC Token", 18, "DISCOVERED");
  const usdtT = addToken("bscTestnet", "USDT", "Tether USD (test)", 18, "TRACKED");
  const spam = addToken("bscTestnet", "FREE$", "Claim rewards at scam.site", 18, "DISCOVERED", true);
  const usdt = addToken("bscMainnet", "USDT", "Tether USD", 18, "TRACKED");
  const cake = addToken("bscMainnet", "CAKE", "PancakeSwap Token", 18, "DISCOVERED");

  const community = addPool("Community A", "bscTestnet", 86_400_000 * 12, "420000000000000000"); // 0.42 tBNB
  const cw = addWallets(community, 12, "member-");
  cw[0].holderName = "Alice Rivera";
  cw[0].holderEmail = "alice@example.com";
  cw[1].holderName = "Ben Okafor";
  cw[1].holderEmail = "ben@example.com";
  cw[2].holderName = "Chen Wei";
  addDeposit(cw[0], abc.tokenAddress, "5000000000000000000", 3_600_000 * 2);
  addDeposit(cw[0], abc.tokenAddress, "12500000000000000000", 3_600_000 * 26);
  addDeposit(cw[1], abc.tokenAddress, "75000000000000000000", 3_600_000 * 5);
  addDeposit(cw[1], usdtT.tokenAddress, "40000000000000000000", 3_600_000 * 8);
  addDeposit(cw[2], usdtT.tokenAddress, "1500000000000000000", 600_000);
  addDeposit(cw[3], abc.tokenAddress, "3000000000000000000", 3_600_000 * 50);
  addDeposit(cw[4], spam.tokenAddress, "99999000000000000000000", 3_600_000 * 3);
  cw[0].balances.set(NATIVE_ASSET, "12000000000000000"); // 0.012 tBNB
  cw[5].balances.set(NATIVE_ASSET, "250000000000000000"); // 0.25 tBNB (no token)

  addJob(cw[0], abc.tokenAddress, "2000000000000000000", "CONFIRMED", { agoMs: 3_600_000 * 20, topup: true });
  addJob(cw[3], abc.tokenAddress, "1000000000000000000", "FAILED", {
    agoMs: 3_600_000 * 6,
    topup: true,
    error: "execution reverted: ERC20: transfer amount exceeds balance",
    errorCode: "REVERTED",
  });
  const batch = uuid();
  addJob(cw[1], abc.tokenAddress, "75000000000000000000", "CONFIRMED", { batchId: batch, sweepAll: true, agoMs: 3_600_000 * 2, topup: true });
  addJob(cw[1], usdtT.tokenAddress, "40000000000000000000", "SENDING", { batchId: batch, sweepAll: true, agoMs: 3_600_000 * 2, topup: true });
  addJob(cw[2], usdtT.tokenAddress, "1500000000000000000", "PENDING", { batchId: batch, sweepAll: true, agoMs: 3_600_000 * 2 });

  const treasury = addPool("Treasury partitions", "bscMainnet", 86_400_000 * 40, "3000000000000000"); // 0.003 BNB → lowGas
  const tw = addWallets(treasury, 4, "ops-");
  addDeposit(tw[0], usdt.tokenAddress, "1250000000000000000000", 86_400_000 * 2);
  addDeposit(tw[1], cake.tokenAddress, "310000000000000000000", 86_400_000);
  tw[1].balances.set(NATIVE_ASSET, "50000000000000000");

  const archived = addPool("Old pilot", "bscTestnet", 86_400_000 * 90, "0");
  archived.status = "ARCHIVED";
  addWallets(archived, 2);

  state.indexer = [
    {
      network: "bscTestnet",
      enabled: true,
      lastScannedBlock: 45_123_400,
      head: 45_123_456,
      lag: 56,
      lastRunAt: agoIso(25_000),
      lastError: null,
    },
    {
      network: "bscMainnet",
      enabled: true,
      lastScannedBlock: 43_880_120,
      head: 43_881_900,
      lag: 1_780,
      lastRunAt: agoIso(400_000),
      lastError: "429 Too Many Requests from primary RPC; rotated to FALLBACK_RPC_1",
    },
  ];
}
seedFixtures();

// ─── Job simulation (worker stand-in) ────────────────────────────────────────

function patchJob(id: string, patch: Partial<TransferJob>): void {
  const j = state.transfers.find((x) => x.id === id);
  if (!j) return;
  Object.assign(j, patch, { updatedAt: nowIso() });
}
function applyConfirmed(j: TransferJob): void {
  const w = state.wallets.find((x) => x.id === j.walletId);
  if (!w) return;
  const prev = BigInt(w.balances.get(j.asset) ?? "0");
  const amt = j.sweepAll ? prev : BigInt(j.amountWei);
  w.balances.set(j.asset, (prev - amt < 0n ? 0n : prev - amt).toString());
  const pool = poolOf(w);
  if (j.toAddress.toLowerCase() === pool.masterAddress.toLowerCase()) {
    const m = masterOf(pool.id);
    const mp = BigInt(m.balances.get(j.asset) ?? "0");
    m.balances.set(j.asset, (mp + amt).toString());
  }
}
let simCounter = 0;
function simulateJob(id: string, needsTopup: boolean, delayMs = 0): void {
  simCounter += 1;
  const failThisOne = simCounter % 7 === 0;
  const t0 = 1500 + delayMs;
  if (needsTopup) {
    setTimeout(() => patchJob(id, { status: "FUNDING_GAS", attempts: 1, gasTopupTxHash: fakeHash() }), t0);
  }
  setTimeout(() => patchJob(id, { status: "SENDING", attempts: 1, transferTxHash: fakeHash() }), t0 + 2500);
  setTimeout(() => {
    const j = state.transfers.find((x) => x.id === id);
    if (!j || j.status !== "SENDING") return;
    if (failThisOne) {
      patchJob(id, { status: "FAILED", error: "Transaction reverted on-chain", errorCode: "REVERTED" });
    } else {
      patchJob(id, { status: "CONFIRMED", confirmedAt: nowIso() });
      applyConfirmed(j);
    }
  }, t0 + 5500);
}

function planFor(req: PlanTransferRequest): TransferPlan {
  const w = findWallet(req.walletId);
  const pool = poolOf(w);
  if (!/^0x[0-9a-fA-F]{40}$/.test(req.toAddress)) {
    return { ok: false, code: "INVALID_DESTINATION", message: "Destination must be a 0x address (40 hex characters)." };
  }
  const meta = assetMeta(pool.network, req.asset);
  const childNative = BigInt(w.balances.get(NATIVE_ASSET) ?? "0");
  const masterNative = BigInt(masterOf(pool.id).balances.get(NATIVE_ASSET) ?? "0");
  const gasLimit = req.asset === NATIVE_ASSET ? 21_000n : 65_000n;
  const gasCost = gasLimit * GAS_PRICE_WEI;
  const base = {
    gasLimit: gasLimit.toString(),
    gasPriceWei: GAS_PRICE_WEI.toString(),
    gasCostWei: gasCost.toString(),
    childNativeWei: childNative.toString(),
    masterNativeWei: masterNative.toString(),
  };

  if (req.asset === NATIVE_ASSET) {
    let amount: bigint;
    if (req.sweepAll) {
      if (childNative <= gasCost) return { ok: false, code: "NOTHING_TO_SWEEP", message: "Wallet BNB does not cover gas; nothing to sweep." };
      amount = childNative - gasCost;
    } else {
      try {
        amount = parseUnits(req.amount ?? "", 18);
      } catch {
        return { ok: false, code: "INSUFFICIENT_NATIVE_FOR_AMOUNT", message: "Enter a valid amount." };
      }
      if (amount + gasCost > childNative)
        return { ok: false, code: "INSUFFICIENT_NATIVE_FOR_AMOUNT", message: `Amount plus gas (${fmtUnits(gasCost.toString(), 18)} BNB) exceeds the wallet balance.` };
    }
    return {
      ok: true,
      ...base,
      topUpWei: "0",
      amountWei: amount.toString(),
      txs: [{ kind: "transfer", from: w.address, to: req.toAddress, valueWei: amount.toString() }],
    };
  }

  const tokenBal = BigInt(w.balances.get(req.asset) ?? "0");
  let amount: bigint;
  if (req.sweepAll) {
    if (tokenBal === 0n) return { ok: false, code: "NOTHING_TO_SWEEP", message: "This wallet holds none of that token." };
    amount = tokenBal;
  } else {
    try {
      amount = parseUnits(req.amount ?? "", meta.decimals);
    } catch {
      return { ok: false, code: "INSUFFICIENT_TOKEN_BALANCE", message: "Enter a valid amount." };
    }
    if (amount === 0n || amount > tokenBal)
      return { ok: false, code: "INSUFFICIENT_TOKEN_BALANCE", message: `Wallet holds ${fmtUnits(tokenBal.toString(), meta.decimals)} ${meta.symbol}.` };
  }
  const topUp = childNative < gasCost ? gasCost - childNative + TOPUP_BUFFER_WEI : 0n;
  if (topUp > 0n && masterNative < topUp + TOPUP_BUFFER_WEI) {
    return {
      ok: false,
      code: "MASTER_INSUFFICIENT_BNB",
      message: `Master holds ${fmtUnits(masterNative.toString(), 18)} BNB but ${fmtUnits(topUp.toString(), 18)} BNB is needed for the gas top-up.`,
    };
  }
  const txs: TransferTxIntent[] = [];
  if (topUp > 0n) txs.push({ kind: "topup", from: pool.masterAddress, to: w.address, valueWei: topUp.toString() });
  txs.push({ kind: "transfer", from: w.address, to: req.asset, valueWei: "0", data: `0xa9059cbb${hex(128)}` });
  return { ok: true, ...base, topUpWei: topUp.toString(), amountWei: amount.toString(), txs };
}

function createJobFromPlan(w: WalletRow, req: PlanTransferRequest, plan: Extract<TransferPlan, { ok: true }>, batchId: string | null, stagger = 0): TransferJob {
  const pool = poolOf(w);
  const meta = assetMeta(pool.network, req.asset);
  const j: TransferJob = {
    id: uuid(),
    poolId: pool.id,
    walletId: w.id,
    walletAddress: w.address,
    batchId,
    toAddress: req.toAddress,
    asset: req.asset,
    symbol: meta.symbol,
    decimals: meta.decimals,
    amountWei: plan.amountWei,
    amount: fmtUnits(plan.amountWei, meta.decimals),
    sweepAll: Boolean(req.sweepAll),
    status: "PENDING",
    gasTopupTxHash: null,
    transferTxHash: null,
    gasPriceWei: plan.gasPriceWei,
    gasLimit: Number(plan.gasLimit),
    error: null,
    errorCode: null,
    attempts: 0,
    requestedBy: "admin-user",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    confirmedAt: null,
  };
  state.transfers.unshift(j);
  simulateJob(j.id, BigInt(plan.topUpWei) > 0n, stagger);
  return j;
}

function treasuryFor(p: PoolRow): PoolTreasuryResponse {
  const wallets = state.wallets.filter((w) => w.poolId === p.id);
  const agg = new Map<Asset, { total: bigint; holders: number }>();
  for (const w of wallets) {
    for (const [asset, wei] of w.balances) {
      const v = BigInt(wei);
      if (v === 0n) continue;
      if (assetMeta(p.network, asset).hidden) continue;
      const cur = agg.get(asset) ?? { total: 0n, holders: 0 };
      cur.total += v;
      cur.holders += 1;
      agg.set(asset, cur);
    }
  }
  const totals: TreasuryTotal[] = [...agg.entries()].map(([asset, a]) => {
    const meta = assetMeta(p.network, asset);
    return {
      asset,
      symbol: meta.symbol,
      name: meta.name,
      decimals: meta.decimals,
      totalWei: a.total.toString(),
      total: fmtUnits(a.total.toString(), meta.decimals),
      walletsWithBalance: a.holders,
    };
  });
  totals.sort((a, b) => (a.asset === NATIVE_ASSET ? -1 : b.asset === NATIVE_ASSET ? 1 : a.symbol.localeCompare(b.symbol)));
  const m = masterOf(p.id);
  const master: TreasuryMasterBalance[] = [...m.balances.entries()].map(([asset, wei]) => {
    const meta = assetMeta(p.network, asset);
    return { asset, symbol: meta.symbol, decimals: meta.decimals, balanceWei: wei, balance: fmtUnits(wei, meta.decimals) };
  });
  const masterNative = BigInt(m.balances.get(NATIVE_ASSET) ?? "0");
  return {
    poolId: p.id,
    network: p.network,
    masterAddress: p.masterAddress,
    totals,
    master,
    walletCount: wallets.length,
    lowGas: masterNative < TOPUP_BUFFER_WEI * 50n,
    updatedAt: agoIso(45_000),
  };
}

// ─── The client ──────────────────────────────────────────────────────────────

export const managedApi = {
  // Health and re-auth
  async health(): Promise<HealthResponse> {
    await delay();
    const lastBlockByNetwork: Partial<Record<Network, number>> = {};
    for (const s of state.indexer) lastBlockByNetwork[s.network] = s.lastScannedBlock;
    return { enabled: true, keyVault: state.keyVault, migrated: true, indexer: { enabled: true, lastBlockByNetwork } };
  },

  async reauth(password: string): Promise<ReauthResponse> {
    await delay();
    if (!password || password === "wrong") throw new MockApiError(401, "Invalid password", "INVALID_PASSWORD");
    return { ok: true, validUntil: new Date(Date.now() + 10 * 60_000).toISOString() };
  },

  // Pools
  async listPools(): Promise<ListPoolsResponse> {
    await delay();
    return { pools: state.pools.map(summaryOf) };
  },

  async createPool(req: CreatePoolRequest): Promise<CreatePoolResponse> {
    await delay();
    const name = req.name.trim();
    if (!name) throw new MockApiError(400, "Name is required", "VALIDATION");
    if (req.mnemonic !== undefined) {
      const words = req.mnemonic.trim().split(/\s+/);
      if (!(words.length === 12 || words.length === 24) || !words.every((w) => /^[a-z]+$/.test(w)))
        throw new MockApiError(400, "Mnemonic must be 12 or 24 lowercase words", "INVALID_MNEMONIC");
    }
    const p = addPool(name, req.network, 0, "0");
    if (req.mnemonic) p.mnemonic = req.mnemonic.trim().split(/\s+/).join(" ");
    return { pool: publicPool(p), masterAddress: p.masterAddress };
  },

  async getPool(id: string): Promise<GetPoolResponse> {
    await delay();
    const p = findPool(id);
    const wallets = state.wallets.filter((w) => w.poolId === p.id);
    const assets = new Set<Asset>();
    let last: string | null = null;
    for (const w of wallets) {
      for (const [a, wei] of w.balances) if (BigInt(wei) > 0n) assets.add(a);
      const l = lastDepositAt(w.id);
      if (l && (!last || l > last)) last = l;
    }
    return { pool: publicPool(p), stats: { wallets: wallets.length, assetsTracked: assets.size, lastDepositAt: last } };
  },

  async updatePool(id: string, req: UpdatePoolRequest): Promise<UpdatePoolResponse> {
    await delay();
    const p = findPool(id);
    if (req.name !== undefined) {
      if (!req.name.trim()) throw new MockApiError(400, "Name is required", "VALIDATION");
      p.name = req.name.trim();
    }
    if (req.status !== undefined) p.status = req.status;
    p.updatedAt = nowIso();
    return { pool: publicPool(p) };
  },

  async revealMnemonic(id: string): Promise<RevealMnemonicResponse> {
    await delay();
    const p = findPool(id);
    p.mnemonicRevealedAt = nowIso();
    return { seedType: p.seedType, mnemonic: p.mnemonic, masterAddress: p.masterAddress, accountPath: p.accountPath };
  },

  // Wallets
  async generateWallets(poolId: string, req: GenerateWalletsRequest): Promise<GenerateWalletsResponse> {
    await delay();
    const p = findPool(poolId);
    if (p.status === "ARCHIVED") throw new MockApiError(409, "Pool is archived", "POOL_ARCHIVED");
    const remaining = 10_000 - (p.nextIndex - 1);
    if (!Number.isInteger(req.count) || req.count < 1 || req.count > remaining)
      throw new MockApiError(400, `Count must be between 1 and ${remaining}`, req.count > remaining ? "POOL_LIMIT_REACHED" : "VALIDATION");
    const created = addWallets(p, req.count, req.labelPrefix?.trim() || undefined);
    return {
      created: created.map((w) => ({ id: w.id, derivationIndex: w.derivationIndex, address: w.address })),
      nextIndex: p.nextIndex,
    };
  },

  async listWallets(poolId: string, q: ListWalletsQuery = {}): Promise<ListWalletsResponse> {
    await delay();
    findPool(poolId);
    const search = (q.search ?? "").trim().toLowerCase();
    let rows = state.wallets.filter((w) => w.poolId === poolId);
    if (search) {
      rows = rows.filter(
        (w) =>
          w.address.toLowerCase().startsWith(search) ||
          (w.label ?? "").toLowerCase().includes(search) ||
          (w.holderName ?? "").toLowerCase().includes(search) ||
          (w.holderEmail ?? "").toLowerCase().includes(search)
      );
    }
    rows.sort((a, b) => a.derivationIndex - b.derivationIndex);
    const skip = Math.max(0, q.skip ?? 0);
    const limit = Math.min(500, Math.max(1, q.limit ?? 50));
    return { wallets: rows.slice(skip, skip + limit).map(withBalances), total: rows.length };
  },

  async getWallet(id: string): Promise<GetWalletResponse> {
    await delay();
    const w = findWallet(id);
    const deposits = state.deposits.filter((d) => d.walletId === id).sort((a, b) => b.blockNumber - a.blockNumber).slice(0, 50);
    const transfers = state.transfers.filter((t) => t.walletId === id).slice(0, 50);
    return {
      wallet: { ...withBalances(w), viewToken: w.viewToken, viewUrl: viewUrlFor(w.viewToken), deposits, transfers },
    };
  },

  async updateWallet(id: string, req: UpdateWalletRequest): Promise<UpdateWalletResponse> {
    await delay();
    const w = findWallet(id);
    if (req.label !== undefined) w.label = req.label?.trim() || null;
    if (req.holderName !== undefined) w.holderName = req.holderName?.trim() || null;
    if (req.holderEmail !== undefined) w.holderEmail = req.holderEmail?.trim() || null;
    if (req.holderUserEmail !== undefined) {
      if (req.holderUserEmail === null || req.holderUserEmail.trim() === "") w.holderUserId = null;
      else if (req.holderUserEmail.includes("@")) w.holderUserId = `user-${hex(8)}`;
      else throw new MockApiError(400, "No user with that email", "USER_NOT_FOUND");
    }
    if (req.status !== undefined) w.status = req.status;
    w.updatedAt = nowIso();
    const { viewToken: _vt, balances: _b, ...plain } = w;
    void _vt;
    void _b;
    return { wallet: plain };
  },

  async rotateViewToken(id: string): Promise<RotateViewTokenResponse> {
    await delay();
    const w = findWallet(id);
    w.viewToken = hex(64);
    w.updatedAt = nowIso();
    return { viewToken: w.viewToken, viewUrl: viewUrlFor(w.viewToken) };
  },

  // Deposits and treasury
  async listDeposits(poolId: string, q: ListDepositsQuery = {}): Promise<ListDepositsResponse> {
    await delay();
    findPool(poolId);
    const ids = new Set(state.wallets.filter((w) => w.poolId === poolId).map((w) => w.id));
    let rows = state.deposits.filter((d) => ids.has(d.walletId));
    if (q.asset) rows = rows.filter((d) => d.asset === q.asset);
    rows.sort((a, b) => b.blockNumber - a.blockNumber);
    const skip = Math.max(0, q.skip ?? 0);
    const limit = Math.min(500, Math.max(1, q.limit ?? 50));
    return { deposits: rows.slice(skip, skip + limit), total: rows.length };
  },

  async getPoolTreasury(poolId: string): Promise<PoolTreasuryResponse> {
    await delay();
    return treasuryFor(findPool(poolId));
  },

  async getTreasury(): Promise<GlobalTreasuryResponse> {
    await delay();
    const active = state.pools.filter((p) => p.status === "ACTIVE");
    const byPool = active.map(treasuryFor);
    const byNet = new Map<Network, Map<Asset, TreasuryTotal>>();
    for (const t of byPool) {
      const m = byNet.get(t.network) ?? new Map<Asset, TreasuryTotal>();
      for (const tot of t.totals) {
        const cur = m.get(tot.asset);
        if (cur) {
          const sum = BigInt(cur.totalWei) + BigInt(tot.totalWei);
          m.set(tot.asset, { ...cur, totalWei: sum.toString(), total: fmtUnits(sum.toString(), cur.decimals), walletsWithBalance: cur.walletsWithBalance + tot.walletsWithBalance });
        } else m.set(tot.asset, { ...tot });
      }
      byNet.set(t.network, m);
    }
    return {
      totalsByNetwork: [...byNet.entries()].map(([network, m]) => ({ network, totals: [...m.values()] })),
      byPool,
      poolCount: active.length,
      walletCount: byPool.reduce((n, p) => n + p.walletCount, 0),
    };
  },

  // Transfers
  async planTransfer(req: PlanTransferRequest): Promise<PlanTransferResponse> {
    await delay();
    return { plan: planFor(req) };
  },

  async createTransfer(req: CreateTransferRequest): Promise<CreateTransferResponse> {
    await delay();
    const existingId = idempotency.get(req.idempotencyKey);
    if (existingId) return { job: { ...findJob(existingId) } };
    const w = findWallet(req.walletId);
    const pool = poolOf(w);
    if (pool.status === "ARCHIVED") throw new MockApiError(409, "Pool is archived", "POOL_ARCHIVED");
    if (w.status === "DISABLED") throw new MockApiError(409, "Wallet is disabled", "WALLET_DISABLED");
    const plan = planFor(req);
    if (!plan.ok) throw new MockApiError(400, plan.message, plan.code);
    const job = createJobFromPlan(w, req, plan, null);
    idempotency.set(req.idempotencyKey, job.id);
    return { job };
  },

  async createSweep(req: SweepRequest): Promise<SweepResponse> {
    await delay();
    const pool = findPool(req.poolId);
    if (pool.status === "ARCHIVED") throw new MockApiError(409, "Pool is archived", "POOL_ARCHIVED");
    const to = req.toAddress ?? pool.masterAddress;
    if (!/^0x[0-9a-fA-F]{40}$/.test(to)) throw new MockApiError(400, "Invalid destination", "INVALID_DESTINATION");
    const wallets = state.wallets.filter((w) => w.poolId === pool.id && (req.walletIds === "ALL" || req.walletIds.includes(w.id)));
    const batchId = uuid();
    let jobs = 0;
    let skipped = 0;
    for (const w of wallets) {
      for (const [asset, wei] of w.balances) {
        if (req.assets !== "ALL" && !req.assets.includes(asset)) continue;
        if (BigInt(wei) === 0n || assetMeta(pool.network, asset).hidden) {
          skipped += 1;
          continue;
        }
        const planReq: PlanTransferRequest = { walletId: w.id, toAddress: to, asset, sweepAll: true };
        const plan = planFor(planReq);
        if (!plan.ok) {
          skipped += 1;
          continue;
        }
        createJobFromPlan(w, planReq, plan, batchId, jobs * 1200);
        jobs += 1;
      }
    }
    return { batchId, jobs, skipped };
  },

  async listTransfers(q: ListTransfersQuery = {}): Promise<ListTransfersResponse> {
    await delay();
    let rows = [...state.transfers];
    if (q.poolId) rows = rows.filter((t) => t.poolId === q.poolId);
    if (q.batchId) rows = rows.filter((t) => t.batchId === q.batchId);
    if (q.status) rows = rows.filter((t) => t.status === q.status);
    rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const byStatus: Partial<Record<TransferStatus, number>> = {};
    for (const t of rows) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
    const skip = Math.max(0, q.skip ?? 0);
    const limit = Math.min(500, Math.max(1, q.limit ?? 50));
    return { jobs: rows.slice(skip, skip + limit), total: rows.length, byStatus };
  },

  async getTransfer(id: string): Promise<GetTransferResponse> {
    await delay();
    return { job: { ...findJob(id) } };
  },

  async retryTransfer(id: string): Promise<GetTransferResponse> {
    await delay();
    const j = findJob(id);
    if (j.status !== "FAILED") throw new MockApiError(409, "Only FAILED jobs can be retried", "NOT_RETRYABLE");
    if (j.attempts >= MAX_ATTEMPTS) throw new MockApiError(409, "Maximum attempts reached", "MAX_ATTEMPTS");
    patchJob(id, { status: "PENDING", error: null, errorCode: null, transferTxHash: null });
    simulateJob(id, true);
    return { job: { ...findJob(id) } };
  },

  // Tokens and indexer
  async listTokens(q: ListTokensQuery = {}): Promise<ListTokensResponse> {
    await delay();
    let rows = [...state.tokens];
    if (q.network) rows = rows.filter((t) => t.network === q.network);
    if (!q.includeHidden) rows = rows.filter((t) => !t.hidden);
    rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
    return { tokens: rows };
  },

  async trackToken(req: TrackTokenRequest): Promise<TrackTokenResponse> {
    await delay();
    const addr = req.tokenAddress.trim().toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(addr)) throw new MockApiError(400, "Address is not a contract", "NOT_A_CONTRACT");
    const existing = state.tokens.find((t) => t.network === req.network && t.tokenAddress === addr);
    if (existing) {
      if (existing.source === "TRACKED") throw new MockApiError(409, "Token already tracked", "ALREADY_TRACKED");
      existing.source = "TRACKED";
      return { token: existing };
    }
    const t: ManagedToken = {
      id: uuid(),
      network: req.network,
      tokenAddress: addr,
      symbol: `TK${addr.slice(2, 5).toUpperCase()}`,
      name: `Token ${addr.slice(2, 8)}`,
      decimals: 18,
      source: "TRACKED",
      hidden: false,
      firstSeenBlock: null,
      createdAt: nowIso(),
    };
    state.tokens.push(t);
    return { token: t };
  },

  async setTokenHidden(id: string, req: UpdateTokenRequest): Promise<UpdateTokenResponse> {
    await delay();
    const t = state.tokens.find((x) => x.id === id);
    if (!t) throw new MockApiError(404, "Token not found", "TOKEN_NOT_FOUND");
    t.hidden = req.hidden;
    return { token: t };
  },

  async getIndexerStatus(): Promise<IndexerStatusResponse> {
    await delay();
    return { byNetwork: state.indexer.map((s) => ({ ...s })) };
  },

  async runIndexer(): Promise<IndexerRunResponse> {
    await delay();
    if (!state.indexerRunning) {
      state.indexerRunning = true;
      setTimeout(() => {
        for (const s of state.indexer) {
          s.head = (s.head ?? s.lastScannedBlock) + 20;
          s.lastScannedBlock = s.head - 15;
          s.lag = s.head - s.lastScannedBlock;
          s.lastRunAt = nowIso();
          s.lastError = null;
        }
        state.indexerRunning = false;
      }, 2500);
    }
    return { started: true };
  },

  /**
   * URL for the CSV export (synchronous URL builder, like exportApi.url).
   * The real client returns `${BASE_URL}/api/admin/managed/export/pools/${id}.csv`.
   */
  exportPoolCsvUrl(poolId: string): string {
    const p = state.pools.find((x) => x.id === poolId);
    const rows = state.wallets
      .filter((w) => w.poolId === poolId)
      .sort((a, b) => a.derivationIndex - b.derivationIndex)
      .map((w) => [w.derivationIndex, w.address, w.label ?? "", w.holderName ?? "", w.holderEmail ?? "", w.status].join(","));
    const csv = ["index,address,label,holder_name,holder_email,status", ...rows].join("\n");
    void p;
    return `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
  },
};

export type ManagedApi = typeof managedApi;
