/**
 * Managed Wallets — manual end-to-end check on BSC testnet.
 *
 * Covers SPEC §9 criteria 1 (pool + master), 2 (generation), 3 (token deposit
 * reaches the indexer, the wallet row and the holder view) and 5 (transfer
 * from a wallet with zero BNB: FUNDING_GAS → SENDING → CONFIRMED with both
 * hashes stored). It drives a RUNNING backend over HTTP and the chain over
 * ethers directly. Nothing here is wired into package.json on purpose.
 *
 * Usage (from backend/):
 *   E2E_NETWORK=bscTestnet \
 *   E2E_FUNDER_PRIVATE_KEY=0x… \
 *   E2E_API_URL=http://localhost:4000 \
 *   E2E_ADMIN_EMAIL=admin@example.com E2E_ADMIN_PASSWORD=… \
 *   E2E_TOKEN_ADDRESS=0x… \
 *   npx ts-node scripts/managed/testnet-e2e.ts
 *
 * Environment (this script does NOT load .env; export the variables explicitly):
 *   E2E_NETWORK             must be exactly "bscTestnet" — anything else is refused
 *   E2E_FUNDER_PRIVATE_KEY  0x + 64 hex; a throwaway testnet key holding tBNB and the
 *                           test token. Never committed, never printed.
 *   E2E_RPC_URL             optional, default https://data-seed-prebsc-1-s1.binance.org:8545.
 *                           The script refuses to continue unless eth_chainId answers 97.
 *   E2E_API_URL             base URL of the running backend with MANAGED_WALLETS_ENABLED=true
 *   E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD  an ADMIN user with a password (re-auth needs it)
 *   E2E_TOKEN_ADDRESS       BEP-20 on testnet owned by the funder. To obtain one:
 *                             cd backend && PRIVATE_KEY=<funder key> npm run deploy:token
 *                           (the existing hardhat script; it prints "ABCToken deployed to: 0x…"
 *                           and mints the supply to the deployer), then re-run this script
 *                           with E2E_TOKEN_ADDRESS set to that address.
 *   E2E_FUND_BNB            tBNB sent to wallet 1, default "0.001"
 *   E2E_FUND_TOKENS         tokens sent to wallet 1 (human units), default "5"
 *   E2E_AUTO_FUND_MASTER    optional tBNB amount the funder sends to the pool master
 *                           (e.g. "0.01"). When unset, the script prints the master
 *                           address and waits for the operator to fund it from a faucet.
 *   E2E_POOL_NAME           optional pool name
 *
 * Secrets: the funder key, the admin password and the pool mnemonic are never
 * printed. The pool is created with a server-generated seed; this script never
 * calls the reveal endpoint.
 */
import { randomUUID } from "crypto";
import axios from "axios";
import type { AxiosResponse, Method } from "axios";
import { Contract, JsonRpcProvider, Wallet, formatEther, formatUnits, parseEther, parseUnits } from "ethers";

const REQUIRED_CHAIN_ID = 97n;
const DEFAULT_RPC = "https://data-seed-prebsc-1-s1.binance.org:8545";
const EXPLORER = "https://testnet.bscscan.com";
const POLL_MS = 10_000;
const FUND_TIMEOUT_MS = 15 * 60_000;
const DEPOSIT_TIMEOUT_MS = 5 * 60_000;
const JOB_TIMEOUT_MS = 10 * 60_000;

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function transfer(address to, uint256 amount) returns (bool)",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(message: string): void {
  console.log(`[e2e] ${message}`);
}

function fail(message: string, code = 2): never {
  console.error(`[e2e] REFUSED: ${message}`);
  process.exit(code);
}

function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

function requireEnv(name: string, hint: string): string {
  const v = env(name);
  if (!v) fail(`${name} is not set. ${hint}`);
  return v;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollUntil<T>(
  label: string,
  timeoutMs: number,
  probe: () => Promise<T | null>
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await probe();
    if (result !== null) return result;
    if (Date.now() >= deadline) fail(`${label}: timed out after ${Math.round(timeoutMs / 1000)}s`, 1);
    await sleep(POLL_MS);
  }
}

/** Minimal cookie-jar HTTP client over the existing axios dependency. */
class Api {
  private cookie = "";

  constructor(private readonly baseUrl: string) {}

  async call<T>(method: Method, path: string, body?: unknown, expect: number[] = [200, 201, 202]): Promise<T> {
    const res: AxiosResponse<T> = await axios.request<T>({
      method,
      url: `${this.baseUrl}${path}`,
      data: body,
      headers: { "content-type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}) },
      validateStatus: () => true,
      timeout: 30_000,
    });
    const setCookie = res.headers["set-cookie"];
    if (Array.isArray(setCookie) && setCookie.length > 0) {
      const pairs = new Map<string, string>();
      for (const existing of this.cookie.split("; ").filter(Boolean)) {
        const [k, ...v] = existing.split("=");
        pairs.set(k, v.join("="));
      }
      for (const raw of setCookie) {
        const [pair] = raw.split(";");
        const [k, ...v] = pair.split("=");
        pairs.set(k, v.join("="));
      }
      this.cookie = [...pairs.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    }
    if (!expect.includes(res.status)) {
      throw new Error(`${method} ${path} → HTTP ${res.status}: ${JSON.stringify(res.data)}`);
    }
    return res.data;
  }
}

// ─── Response shapes used here (subset of backend/src/managed/types.ts) ──────

interface HealthResponse {
  enabled: boolean;
  keyVault: "ok" | "missing";
  migrated: boolean;
  indexer: { enabled: boolean; lastBlockByNetwork: Record<string, number> };
}
interface CreatePoolResponse {
  pool: { id: string; name: string; network: string; masterAddress: string; status: string };
  masterAddress: string;
}
interface GenerateWalletsResponse {
  created: Array<{ id: string; derivationIndex: number; address: string }>;
  nextIndex: number;
}
interface WalletDetail {
  wallet: {
    id: string;
    address: string;
    viewUrl: string;
    balances: Array<{ asset: string; symbol: string; balance: string; balanceWei: string }>;
    deposits: Array<{ txHash: string; asset: string; symbol: string; amount: string; blockNumber: number }>;
  };
}
interface IndexerStatus {
  byNetwork: Array<{ network: string; enabled: boolean; lastScannedBlock: number; head: number | null; lag: number | null; lastError: string | null }>;
}
interface PlanResponse {
  plan:
    | { ok: true; gasLimit: string; gasPriceWei: string; gasCostWei: string; topUpWei: string; amountWei: string; childNativeWei: string; masterNativeWei: string }
    | { ok: false; code: string; message: string };
}
interface Job {
  id: string;
  status: string;
  gasTopupTxHash: string | null;
  transferTxHash: string | null;
  error: string | null;
  errorCode: string | null;
  attempts: number;
  amount: string;
  symbol: string;
}
interface TreasuryResponse {
  totals: Array<{ asset: string; symbol: string; total: string; walletsWithBalance: number }>;
  master: Array<{ asset: string; symbol: string; balance: string }>;
  lowGas: boolean;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // 0. Refusals first: wrong network, missing key, mainnet RPC.
  const network = env("E2E_NETWORK");
  if (network !== "bscTestnet") {
    fail(`E2E_NETWORK must be "bscTestnet" (got ${JSON.stringify(network ?? null)}). This script never runs against mainnet.`);
  }
  const funderKey = requireEnv("E2E_FUNDER_PRIVATE_KEY", "Export a throwaway testnet key (0x + 64 hex).");
  if (!/^0x[0-9a-fA-F]{64}$/.test(funderKey)) fail("E2E_FUNDER_PRIVATE_KEY must be 0x followed by 64 hex characters.");

  const tokenAddress = env("E2E_TOKEN_ADDRESS");
  if (!tokenAddress) {
    console.error(
      [
        "[e2e] E2E_TOKEN_ADDRESS is not set. Deploy the test BEP-20 with the existing script first:",
        "",
        "    cd backend && PRIVATE_KEY=<the same funder key> npm run deploy:token",
        "",
        '  It prints "ABCToken deployed to: 0x…" and mints the supply to the deployer.',
        "  Then re-run this script with E2E_TOKEN_ADDRESS=<that address>.",
      ].join("\n")
    );
    process.exit(2);
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(tokenAddress)) fail("E2E_TOKEN_ADDRESS must be a 0x address.");

  const apiUrl = requireEnv("E2E_API_URL", "e.g. http://localhost:4000 (a backend running with MANAGED_WALLETS_ENABLED=true).").replace(/\/+$/, "");
  const adminEmail = requireEnv("E2E_ADMIN_EMAIL", "An ADMIN user with a password.");
  const adminPassword = requireEnv("E2E_ADMIN_PASSWORD", "The admin password (used for login and re-auth; never printed).");
  const fundBnb = env("E2E_FUND_BNB") ?? "0.001";
  const fundTokens = env("E2E_FUND_TOKENS") ?? "5";
  const autoFundMaster = env("E2E_AUTO_FUND_MASTER");

  const rpcUrl = env("E2E_RPC_URL") ?? DEFAULT_RPC;
  const provider = new JsonRpcProvider(rpcUrl);
  const chain = await provider.getNetwork();
  if (chain.chainId !== REQUIRED_CHAIN_ID) {
    fail(`RPC ${rpcUrl} answers chain id ${chain.chainId}, not BSC testnet (97). Refusing to continue.`);
  }
  log(`RPC ${rpcUrl} is chain id 97 (BSC testnet)`);

  // 1. Funder and token sanity (all public values).
  const funder = new Wallet(funderKey, provider);
  const token = new Contract(tokenAddress, ERC20_ABI, funder);
  const [funderBnb, decimalsRaw, symbol] = await Promise.all([
    provider.getBalance(funder.address),
    token.decimals() as Promise<bigint>,
    token.symbol() as Promise<string>,
  ]);
  const decimals = Number(decimalsRaw);
  const funderTokens = (await token.balanceOf(funder.address)) as bigint;
  log(`funder ${funder.address}: ${formatEther(funderBnb)} tBNB, ${formatUnits(funderTokens, decimals)} ${symbol}`);
  const needBnb = parseEther(fundBnb) + (autoFundMaster ? parseEther(autoFundMaster) : 0n) + parseEther("0.002");
  if (funderBnb < needBnb) fail(`funder needs at least ${formatEther(needBnb)} tBNB (faucet: https://www.bnbchain.org/en/testnet-faucet)`, 1);
  const needTokens = parseUnits(fundTokens, decimals);
  if (funderTokens < needTokens) fail(`funder holds ${formatUnits(funderTokens, decimals)} ${symbol}, needs ${fundTokens}`, 1);

  // 2. Backend: login, health, re-auth.
  const api = new Api(apiUrl);
  const login = await api.call<{ user: { role: string; email: string } }>("POST", "/api/auth/login", {
    email: adminEmail,
    password: adminPassword,
  });
  if (login.user?.role !== "ADMIN") fail(`${adminEmail} is not an ADMIN (role ${login.user?.role})`, 1);
  log(`logged in as ${login.user.email} (ADMIN)`);

  const health = await api.call<HealthResponse>("GET", "/api/admin/managed/health");
  log(`health: ${JSON.stringify(health)}`);
  if (!health.enabled || health.keyVault !== "ok" || !health.migrated) {
    fail("backend is not ready: needs MANAGED_WALLETS_ENABLED=true, a valid WALLET_ENCRYPTION_KEY and migrations applied", 1);
  }
  if (!health.indexer.enabled) fail("MANAGED_INDEXER_ENABLED=false on the backend; the deposit would never be indexed", 1);

  const reauth = async (): Promise<void> => {
    await api.call("POST", "/api/admin/managed/reauth", { password: adminPassword });
    log("re-auth ok (10 minute window)");
  };
  await reauth();

  // 3. Pool with a server-generated seed; 3 wallets.
  const poolName = env("E2E_POOL_NAME") ?? `e2e ${new Date().toISOString().slice(0, 16)}`;
  const created = await api.call<CreatePoolResponse>("POST", "/api/admin/managed/pools", { name: poolName, network: "bscTestnet" });
  if (JSON.stringify(created).toLowerCase().includes("mnemonic")) fail("pool creation response mentions a mnemonic; aborting (R4)", 1);
  const poolId = created.pool.id;
  const master = created.masterAddress;
  log(`pool ${poolId} "${created.pool.name}" created; master ${master} (${EXPLORER}/address/${master})`);

  const gen = await api.call<GenerateWalletsResponse>("POST", `/api/admin/managed/pools/${poolId}/wallets/generate`, {
    count: 3,
    labelPrefix: "e2e-",
  });
  if (gen.created.length !== 3 || gen.nextIndex !== 4) fail(`expected 3 wallets with nextIndex 4, got ${JSON.stringify(gen)}`, 1);
  const wallet1 = gen.created[0];
  for (const w of gen.created) log(`wallet #${w.derivationIndex} ${w.address}`);
  const detail0 = await api.call<WalletDetail>("GET", `/api/admin/managed/wallets/${wallet1.id}`);
  log(`wallet 1 holder view: ${detail0.wallet.viewUrl}`);

  // 4. Master must hold tBNB for the gas top-up.
  if (autoFundMaster) {
    const tx = await funder.sendTransaction({ to: master, value: parseEther(autoFundMaster) });
    log(`funding master with ${autoFundMaster} tBNB: ${EXPLORER}/tx/${tx.hash}`);
    await tx.wait();
  } else {
    log(`ACTION REQUIRED: send some tBNB (≥ 0.005) to the master ${master}`);
    log("  faucet: https://www.bnbchain.org/en/testnet-faucet — polling every 10 s, up to 15 min");
  }
  const masterBnb = await pollUntil("master funding", FUND_TIMEOUT_MS, async () => {
    const b = await provider.getBalance(master);
    return b > 0n ? b : null;
  });
  log(`master balance ${formatEther(masterBnb)} tBNB`);

  // 5. Send tBNB and tokens to wallet 1 straight from the funder.
  const bnbTx = await funder.sendTransaction({ to: wallet1.address, value: parseEther(fundBnb) });
  log(`sent ${fundBnb} tBNB to wallet 1: ${EXPLORER}/tx/${bnbTx.hash}`);
  await bnbTx.wait();
  const tokenTx = await (token.transfer(wallet1.address, needTokens) as Promise<{ hash: string; wait: () => Promise<unknown> }>);
  log(`sent ${fundTokens} ${symbol} to wallet 1: ${EXPLORER}/tx/${tokenTx.hash}`);
  await tokenTx.wait();

  // 6. Wait for the indexer to show the token deposit (criterion 3).
  await api.call("POST", "/api/admin/managed/indexer/run", {}, [202]);
  log("indexer run requested; polling wallet detail for the token deposit (≤ 5 min)");
  const deposit = await pollUntil("token deposit indexing", DEPOSIT_TIMEOUT_MS, async () => {
    const status = await api.call<IndexerStatus>("GET", "/api/admin/managed/indexer/status");
    const t = status.byNetwork.find((n) => n.network === "bscTestnet");
    const detail = await api.call<WalletDetail>("GET", `/api/admin/managed/wallets/${wallet1.id}`);
    const hit = detail.wallet.deposits.find((d) => d.txHash.toLowerCase() === tokenTx.hash.toLowerCase());
    const tokenBal = detail.wallet.balances.find((b) => b.asset === tokenAddress.toLowerCase());
    log(
      `  indexer lastScanned=${t?.lastScannedBlock ?? "?"} head=${t?.head ?? "?"} lag=${t?.lag ?? "?"} ` +
        `lastError=${t?.lastError ?? "none"} | wallet1 ${symbol}=${tokenBal?.balance ?? "n/a"} deposits=${detail.wallet.deposits.length}`
    );
    return hit && tokenBal && tokenBal.balance !== "0" ? { hit, tokenBal } : null;
  });
  log(`deposit indexed: ${deposit.hit.amount} ${deposit.hit.symbol} at block ${deposit.hit.blockNumber}; balance ${deposit.tokenBal.balance} ${symbol}`);

  const view = await axios.get(detail0.wallet.viewUrl.replace(/^.*\/w\//, `${apiUrl}/api/view/`), { validateStatus: () => true });
  log(`public view HTTP ${view.status}: ${view.status === 200 ? `${(view.data as { tokens: unknown[] }).tokens.length} token(s) visible` : JSON.stringify(view.data)}`);

  // 7. Sweep all tokens from wallet 1 to the master (criterion 5).
  await reauth();
  const planReq = { walletId: wallet1.id, toAddress: master, asset: tokenAddress, sweepAll: true };
  const planned = await api.call<PlanResponse>("POST", "/api/admin/managed/transfers/plan", planReq);
  if (!planned.plan.ok) fail(`plan rejected: ${planned.plan.code} ${planned.plan.message}`, 1);
  log(
    `plan ok: gasLimit=${planned.plan.gasLimit} gasPriceWei=${planned.plan.gasPriceWei} topUpWei=${planned.plan.topUpWei} ` +
      `childNativeWei=${planned.plan.childNativeWei} masterNativeWei=${planned.plan.masterNativeWei}`
  );

  const { job } = await api.call<{ job: Job }>("POST", "/api/admin/managed/transfers", { ...planReq, idempotencyKey: randomUUID() }, [200, 201]);
  log(`job ${job.id} created (${job.status}); polling until terminal (≤ 10 min)`);

  let lastStatus = job.status;
  const final = await pollUntil("transfer job", JOB_TIMEOUT_MS, async () => {
    const { job: j } = await api.call<{ job: Job }>("GET", `/api/admin/managed/transfers/${job.id}`);
    if (j.status !== lastStatus) {
      log(`  ${lastStatus} → ${j.status}${j.gasTopupTxHash ? ` topup=${j.gasTopupTxHash}` : ""}${j.transferTxHash ? ` transfer=${j.transferTxHash}` : ""}`);
      lastStatus = j.status;
    }
    return ["CONFIRMED", "FAILED", "CANCELLED"].includes(j.status) ? j : null;
  });

  log("─".repeat(72));
  log(`job ${final.id}: ${final.status} after ${final.attempts} attempt(s)`);
  log(`  gas top-up tx : ${final.gasTopupTxHash ? `${EXPLORER}/tx/${final.gasTopupTxHash}` : "none"}`);
  log(`  transfer tx   : ${final.transferTxHash ? `${EXPLORER}/tx/${final.transferTxHash}` : "none"}`);
  if (final.error) log(`  error         : ${final.errorCode ?? ""} ${final.error}`);

  const treasury = await api.call<TreasuryResponse>("GET", `/api/admin/managed/pools/${poolId}/treasury`);
  const after = await api.call<WalletDetail>("GET", `/api/admin/managed/wallets/${wallet1.id}`);
  log(`wallet 1 after: ${after.wallet.balances.map((b) => `${b.balance} ${b.symbol}`).join(", ")}`);
  log(`treasury: ${treasury.totals.map((t) => `${t.total} ${t.symbol} (${t.walletsWithBalance} wallets)`).join(", ")} | master ${treasury.master.map((m) => `${m.balance} ${m.symbol}`).join(", ")} | lowGas=${treasury.lowGas}`);
  log("─".repeat(72));
  log(`verify audits: SELECT action, user_id, created_at FROM managed_audits WHERE pool_id = '${poolId}' ORDER BY created_at;`);

  process.exit(final.status === "CONFIRMED" ? 0 : 1);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  // Masks anything key-shaped that an RPC or HTTP error might echo.
  console.error(`[e2e] FAILED: ${message.replace(/(0x)?[0-9a-fA-F]{64}/g, "[REDACTED]")}`);
  process.exit(1);
});
