/**
 * RPC provider resolution for the managed-wallets chain layer.
 *
 * Env resolution reproduces backend/src/routes/estimate.ts:
 *   bscTestnet: BSC_TESTNET_RPC_URL, then ALCHEMY_RPC_URL, then FALLBACK_RPC_1
 *   bscMainnet: ALCHEMY_RPC_URL, then FALLBACK_RPC_1, then FALLBACK_RPC_2
 *
 * `withFallback` rotates across the configured providers on transient errors
 * (429, timeout, SERVER_ERROR, NETWORK_ERROR), the same idea as RpcManager in
 * scripts/distribute.ts (which stays untouched).
 */

import { JsonRpcProvider, Network as EthersNetwork } from "ethers";
import type { Network } from "../types";
import type { ChainProvider } from "./ports";

export const CHAIN_IDS: Record<Network, number> = {
  bscMainnet: 56,
  bscTestnet: 97,
};

export const EXPLORER_BASE: Record<Network, string> = {
  bscMainnet: "https://bscscan.com",
  bscTestnet: "https://testnet.bscscan.com",
};

export function chainIdFor(network: Network): number {
  return CHAIN_IDS[network];
}

export function explorerTxUrl(network: Network, hash: string): string {
  return `${EXPLORER_BASE[network]}/tx/${hash}`;
}

export function explorerAddressUrl(network: Network, address: string): string {
  return `${EXPLORER_BASE[network]}/address/${address}`;
}

function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

/** Ordered, de-duplicated list of RPC URLs for the network (primary first). */
export function rpcUrlsFor(network: Network): string[] {
  const candidates =
    network === "bscTestnet"
      ? [env("BSC_TESTNET_RPC_URL"), env("ALCHEMY_RPC_URL"), env("FALLBACK_RPC_1")]
      : [env("ALCHEMY_RPC_URL"), env("FALLBACK_RPC_1"), env("FALLBACK_RPC_2")];
  const out: string[] = [];
  for (const url of candidates) {
    if (url && !out.includes(url)) out.push(url);
  }
  return out;
}

const providerCache = new Map<string, JsonRpcProvider>();

function providerForUrl(network: Network, url: string): JsonRpcProvider {
  const key = `${network}|${url}`;
  let p = providerCache.get(key);
  if (!p) {
    const staticNetwork = EthersNetwork.from(CHAIN_IDS[network]);
    p = new JsonRpcProvider(url, staticNetwork, { staticNetwork });
    providerCache.set(key, p);
  }
  return p;
}

/** Primary provider for the network. Throws when no RPC URL is configured. */
export function providerFor(network: Network): JsonRpcProvider {
  const urls = rpcUrlsFor(network);
  if (urls.length === 0) {
    throw new Error(`[managed] no RPC URL configured for ${network}`);
  }
  return providerForUrl(network, urls[0]);
}

/** All providers for the network, primary first. */
export function fallbackProvidersFor(network: Network): JsonRpcProvider[] {
  return rpcUrlsFor(network).map((url) => providerForUrl(network, url));
}

/** Clears the provider cache (tests, or after env changes). */
export function resetProviderCache(): void {
  providerCache.clear();
}

const RETRYABLE_CODES = new Set(["SERVER_ERROR", "NETWORK_ERROR", "TIMEOUT"]);
const RETRYABLE_PATTERNS = [
  /\b429\b/,
  /too many requests/i,
  /rate ?limit/i,
  /timeout/i,
  /timed out/i,
  /SERVER_ERROR/,
  /NETWORK_ERROR/,
  /ECONNRESET/,
  /ECONNREFUSED/,
  /ETIMEDOUT/,
  /EAI_AGAIN/,
  /socket hang up/i,
  /bad gateway/i,
  /service unavailable/i,
];

/** True for transient RPC errors worth retrying on another provider. */
export function isRetryableRpcError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && RETRYABLE_CODES.has(code)) return true;
  const message = String((err as { message?: unknown }).message ?? "");
  return RETRYABLE_PATTERNS.some((re) => re.test(message));
}

export interface WithFallbackOptions {
  /** Attempts per provider before moving on (default 2). */
  attemptsPerProvider?: number;
  /** Base backoff in ms, doubled per retry (default 300). */
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Runs `fn` against the primary provider, retrying across the fallbacks on
 * transient errors with a short backoff. Non-transient errors are thrown
 * immediately (a revert is not a reason to try another RPC).
 */
export async function withFallback<T>(
  network: Network,
  fn: (provider: JsonRpcProvider) => Promise<T>,
  providers: JsonRpcProvider[] = fallbackProvidersFor(network),
  options: WithFallbackOptions = {}
): Promise<T> {
  if (providers.length === 0) {
    throw new Error(`[managed] no RPC URL configured for ${network}`);
  }
  const attemptsPerProvider = Math.max(1, options.attemptsPerProvider ?? 2);
  const backoffMs = options.backoffMs ?? 300;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;
  let retry = 0;
  for (const provider of providers) {
    for (let attempt = 0; attempt < attemptsPerProvider; attempt++) {
      try {
        return await fn(provider);
      } catch (err) {
        if (!isRetryableRpcError(err)) throw err;
        lastError = err;
        retry += 1;
        await sleep(Math.min(backoffMs * 2 ** (retry - 1), 5_000));
      }
    }
  }
  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`[managed] all RPC providers for ${network} failed: ${msg}`);
}

/**
 * A `ChainProvider` whose every call goes through `withFallback`. This is the
 * default provider factory for the indexer, balances and worker; tests inject
 * fakes instead.
 */
export function resilientProvider(network: Network): ChainProvider {
  const run = <T>(fn: (p: JsonRpcProvider) => Promise<T>) => withFallback(network, fn);
  return {
    getBlockNumber: () => run((p) => p.getBlockNumber()),
    getLogs: (filter) => run((p) => p.getLogs(filter)),
    getBlock: (blockNumber) => run((p) => p.getBlock(blockNumber)),
    call: (tx) => run((p) => p.call(tx)),
    getBalance: (address) => run((p) => p.getBalance(address)),
    getTransactionReceipt: (hash) => run((p) => p.getTransactionReceipt(hash)),
    getTransactionCount: (address, blockTag) =>
      run((p) => p.getTransactionCount(address, blockTag)),
    estimateGas: (tx) => run((p) => p.estimateGas(tx)),
    getFeeData: () => run((p) => p.getFeeData()),
    broadcastTransaction: (signedTx) => run((p) => p.broadcastTransaction(signedTx)),
  };
}
