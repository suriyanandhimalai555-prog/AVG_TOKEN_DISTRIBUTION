/**
 * Gas price resolution and env helpers for the managed-wallets chain layer.
 *
 * resolveGasPrice = clamp(feeData.gasPrice ?? feeData.maxFeePerGas,
 *                         MANAGED_MIN_GAS_PRICE_GWEI (default 0.1),
 *                         MANAGED_MAX_GAS_PRICE_GWEI (default 5))
 *
 * The 0.05 gwei hard-code in scripts/distribute.ts is untouched and unrelated.
 */

import { parseUnits } from "ethers";
import type { ChainProvider } from "./ports";

// ─── Env helpers (names from SPEC §6.8) ──────────────────────────────────────

export function readEnvInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`[managed] ${name} must be a non-negative number (got "${raw}")`);
  }
  return Math.floor(n);
}

export function readEnvBigint(name: string, fallback: bigint): bigint {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`[managed] ${name} must be a non-negative integer in wei (got "${raw}")`);
  }
  return BigInt(raw);
}

/** Reads a decimal gwei value (e.g. "0.1") and returns wei. */
export function readEnvGweiAsWei(name: string, fallbackGwei: string): bigint {
  const raw = process.env[name]?.trim() || fallbackGwei;
  try {
    const wei = parseUnits(raw, "gwei");
    if (wei < 0n) throw new Error("negative");
    return wei;
  } catch {
    throw new Error(`[managed] ${name} must be a decimal gwei amount (got "${raw}")`);
  }
}

export function readEnvBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "true" || raw === "1" || raw === "yes";
}

export function readEnvString(name: string, fallback: string): string {
  const raw = process.env[name]?.trim();
  return raw ? raw : fallback;
}

// ─── Defaults (SPEC §6.8) ────────────────────────────────────────────────────

export const DEFAULTS = {
  MANAGED_INDEXER_INTERVAL_MS: 30_000,
  MANAGED_INDEXER_CONFIRMATIONS: 15,
  MANAGED_INDEXER_BLOCK_CHUNK: 1_000,
  MANAGED_INDEXER_ADDRESS_CHUNK: 500,
  MANAGED_FULL_REFRESH_MS: 600_000,
  MANAGED_MIN_GAS_PRICE_GWEI: "0.1",
  MANAGED_MAX_GAS_PRICE_GWEI: "5",
  MANAGED_MAX_GAS_LIMIT: 300_000,
  MANAGED_TOPUP_BUFFER_WEI: 100_000_000_000_000n, // 0.0001 BNB
  MANAGED_MAX_ATTEMPTS: 3,
  MANAGED_TX_TIMEOUT_MS: 180_000,
  MANAGED_WORKER_INTERVAL_MS: 3_000,
  MULTICALL3_ADDRESS: "0xcA11bde05977b3631167028862bE2a173976CA11",
} as const;

export interface GasPriceBounds {
  minWei: bigint;
  maxWei: bigint;
}

/** Reads MANAGED_MIN_GAS_PRICE_GWEI / MANAGED_MAX_GAS_PRICE_GWEI from env. */
export function gasPriceBoundsFromEnv(): GasPriceBounds {
  const minWei = readEnvGweiAsWei("MANAGED_MIN_GAS_PRICE_GWEI", DEFAULTS.MANAGED_MIN_GAS_PRICE_GWEI);
  const maxWei = readEnvGweiAsWei("MANAGED_MAX_GAS_PRICE_GWEI", DEFAULTS.MANAGED_MAX_GAS_PRICE_GWEI);
  if (maxWei < minWei) {
    throw new Error("[managed] MANAGED_MAX_GAS_PRICE_GWEI must be >= MANAGED_MIN_GAS_PRICE_GWEI");
  }
  return { minWei, maxWei };
}

export function clampGasPrice(raw: bigint | null | undefined, bounds: GasPriceBounds): bigint {
  const base = raw ?? bounds.minWei;
  if (base < bounds.minWei) return bounds.minWei;
  if (base > bounds.maxWei) return bounds.maxWei;
  return base;
}

/**
 * Gas price in wei from `getFeeData()`, clamped to the configured bounds.
 * Uses `gasPrice`, falling back to `maxFeePerGas`, then to the floor.
 */
export async function resolveGasPrice(
  provider: Pick<ChainProvider, "getFeeData">,
  bounds: GasPriceBounds = gasPriceBoundsFromEnv()
): Promise<bigint> {
  const fee = await provider.getFeeData();
  return clampGasPrice(fee.gasPrice ?? fee.maxFeePerGas ?? null, bounds);
}
