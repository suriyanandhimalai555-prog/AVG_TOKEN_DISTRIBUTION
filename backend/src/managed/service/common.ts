/**
 * Helpers shared by the managed-wallet services: input validation, amount
 * formatting, token metadata lookups and record-to-API mapping.
 */
import { formatUnits, getAddress, isAddress } from "ethers";
import { tokens } from "../models/tokens";
import type { PoolRecord } from "../models/pools";
import { DEFAULTS, readEnvBigint, readEnvInt } from "../chain/fees";
import { NATIVE_ASSET } from "../types";
import type { Asset, ManagedToken, Network, Pool, PoolSummary } from "../types";
import { validation } from "./errors";

export const NETWORKS: readonly Network[] = ["bscMainnet", "bscTestnet"];

export function isNetwork(value: unknown): value is Network {
  return typeof value === "string" && (NETWORKS as readonly string[]).includes(value);
}

export function parseNetwork(value: unknown): Network {
  if (!isNetwork(value)) {
    throw validation(`network must be one of ${NETWORKS.join(", ")}`);
  }
  return value;
}

export function nativeSymbol(network: Network): "BNB" | "tBNB" {
  return network === "bscMainnet" ? "BNB" : "tBNB";
}

/** Checksummed address or 400 VALIDATION. */
export function requireAddress(value: unknown, field: string): string {
  if (typeof value !== "string" || !isAddress(value)) {
    throw validation(`${field} must be a valid address`);
  }
  return getAddress(value);
}

/** 'native' or a lowercase token address, or 400 VALIDATION. */
export function normalizeAsset(value: unknown): Asset {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw validation("asset is required");
  }
  const trimmed = value.trim();
  if (trimmed.toLowerCase() === NATIVE_ASSET) return NATIVE_ASSET;
  if (!isAddress(trimmed)) {
    throw validation("asset must be 'native' or a token address");
  }
  return trimmed.toLowerCase();
}

export function requireString(value: unknown, field: string, maxLength = 200): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw validation(`${field} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw validation(`${field} must be at most ${maxLength} characters`);
  }
  return trimmed;
}

/** Optional string field: undefined when absent, null when explicitly null. */
export function optionalString(
  value: unknown,
  field: string,
  maxLength = 200
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw validation(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw validation(`${field} must be at most ${maxLength} characters`);
  }
  return trimmed.length === 0 ? null : trimmed;
}

export function requireUuid(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw validation(`${field} must be a UUID`);
  }
  return value.toLowerCase();
}

export function optionalInt(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(String(value));
  if (!Number.isInteger(n) || n < 0) {
    throw validation(`${field} must be a non-negative integer`);
  }
  return n;
}

export function requirePositiveInt(value: unknown, field: string): number {
  const n = typeof value === "number" ? value : Number(String(value));
  if (!Number.isInteger(n) || n < 1) {
    throw validation(`${field} must be a positive integer`);
  }
  return n;
}

/** Human-readable amount: wei ÷ 10^decimals without trailing zeros ("5", "0.42", "0"). */
export function formatAmount(wei: string | bigint, decimals: number): string {
  let formatted: string;
  try {
    formatted = formatUnits(BigInt(wei), decimals);
  } catch {
    return String(wei);
  }
  if (!formatted.includes(".")) return formatted;
  const trimmed = formatted.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed.length === 0 || trimmed === "-" ? "0" : trimmed;
}

/** Base URL of the public holder page: `${base}/w/${viewToken}`. */
export function viewUrlBase(): string {
  const base =
    process.env.FRONTEND_URL?.trim() ||
    process.env.CLIENT_URL?.trim() ||
    "http://localhost:5173";
  return base.replace(/\/+$/, "");
}

export function viewUrlFor(viewToken: string): string {
  return `${viewUrlBase()}/w/${viewToken}`;
}

export interface AssetMeta {
  asset: Asset;
  symbol: string;
  name: string;
  decimals: number;
  hidden: boolean;
}

// ─── Untrusted token metadata (SR-07) ────────────────────────────────────────
//
// `symbol` and `name` come from arbitrary contracts. Before they reach any API
// response, CSV header or audit row: strip control characters (C0/C1), format
// characters (bidi overrides, zero-width joiners, ...), private-use and lone
// surrogates, line/paragraph separators; collapse whitespace; cap the length.

export const SYMBOL_MAX_LENGTH = 24;
export const NAME_MAX_LENGTH = 64;
export const UNKNOWN_SYMBOL = "UNKNOWN";
export const UNKNOWN_NAME = "Unknown token";

const DISPLAY_STRIP_RE = /[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Zl}\p{Zp}]/gu;

/**
 * Display-safe string: whitespace (incl. newlines, tabs, line separators)
 * collapsed to single spaces first, then the remaining control/format
 * characters stripped, trimmed and capped; `fallback` when nothing is left.
 */
export function cleanDisplay(value: unknown, maxLength: number, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/\s+/g, " ").replace(DISPLAY_STRIP_RE, "").trim().slice(0, maxLength).trim();
  return cleaned.length > 0 ? cleaned : fallback;
}

/** A ManagedToken whose symbol/name are safe to display or export. */
export function sanitizeToken(token: ManagedToken): ManagedToken {
  return {
    ...token,
    symbol: cleanDisplay(token.symbol, SYMBOL_MAX_LENGTH, UNKNOWN_SYMBOL),
    name: cleanDisplay(token.name, NAME_MAX_LENGTH, UNKNOWN_NAME),
  };
}

/** All tokens of a network (hidden included) keyed by lowercase address, sanitised. */
export async function tokenMetaForNetwork(network: Network): Promise<Map<string, ManagedToken>> {
  const map = new Map<string, ManagedToken>();
  for (const token of await tokens.listByNetwork(network, true)) {
    map.set(token.tokenAddress.toLowerCase(), sanitizeToken(token));
  }
  return map;
}

/** All tokens of every network keyed by `${network}:${address}`, sanitised. */
export async function tokenMetaForAllNetworks(): Promise<Map<string, ManagedToken>> {
  const map = new Map<string, ManagedToken>();
  for (const token of await tokens.listAll(true)) {
    map.set(`${token.network}:${token.tokenAddress.toLowerCase()}`, sanitizeToken(token));
  }
  return map;
}

/**
 * CSV column headers for a list of assets (native first). A symbol shared,
 * case-insensitively, by two or more assets is disambiguated with the short
 * token address: `USDT (0x12345678)`. The native column keeps its plain
 * symbol because its identity is never ambiguous.
 */
export function csvAssetHeaders(assets: ReadonlyArray<{ asset: Asset; symbol: string }>): string[] {
  const counts = new Map<string, number>();
  for (const a of assets) {
    const k = a.symbol.toLowerCase();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return assets.map((a) => {
    if (a.asset === NATIVE_ASSET) return a.symbol;
    if ((counts.get(a.symbol.toLowerCase()) ?? 0) <= 1) return a.symbol;
    return `${a.symbol} (${a.asset.slice(0, 10)})`;
  });
}

/** Display metadata for an asset; unknown tokens fall back to UNKNOWN / 18. */
export function assetMeta(
  network: Network,
  asset: Asset,
  meta: Map<string, ManagedToken>,
  key: (asset: string) => string = (a) => a
): AssetMeta {
  const lower = asset.toLowerCase();
  if (lower === NATIVE_ASSET) {
    return { asset: NATIVE_ASSET, symbol: nativeSymbol(network), name: "BNB", decimals: 18, hidden: false };
  }
  const token = meta.get(key(lower));
  return {
    asset: lower,
    symbol: token?.symbol ?? UNKNOWN_SYMBOL,
    name: token?.name ?? UNKNOWN_NAME,
    decimals: token?.decimals ?? 18,
    hidden: token?.hidden ?? false,
  };
}

export function maxAttempts(): number {
  return readEnvInt("MANAGED_MAX_ATTEMPTS", DEFAULTS.MANAGED_MAX_ATTEMPTS);
}

export function topUpBufferWei(): bigint {
  return readEnvBigint("MANAGED_TOPUP_BUFFER_WEI", DEFAULTS.MANAGED_TOPUP_BUFFER_WEI);
}

export function maxGasLimit(): bigint {
  return BigInt(readEnvInt("MANAGED_MAX_GAS_LIMIT", DEFAULTS.MANAGED_MAX_GAS_LIMIT));
}

/** API `Pool` without the owner column. */
export function toPool(record: PoolRecord): Pool {
  return {
    id: record.id,
    name: record.name,
    network: record.network,
    masterAddress: record.masterAddress,
    seedType: record.seedType,
    walletCount: record.walletCount,
    status: record.status,
    createdAt: record.createdAt,
    accountPath: record.accountPath,
    nextIndex: record.nextIndex,
    keyVersion: record.keyVersion,
    mnemonicRevealedAt: record.mnemonicRevealedAt,
    updatedAt: record.updatedAt,
  };
}

export function toPoolSummary(record: PoolRecord): PoolSummary {
  return {
    id: record.id,
    name: record.name,
    network: record.network,
    masterAddress: record.masterAddress,
    seedType: record.seedType,
    walletCount: record.walletCount,
    status: record.status,
    createdAt: record.createdAt,
  };
}

/** RFC 4180 cell escaping. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  // Neutralise spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
