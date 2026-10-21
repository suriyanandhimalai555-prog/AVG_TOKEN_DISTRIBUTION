/**
 * Multicall3 balance reads.
 *
 * Multicall3 lives at the same address on BSC mainnet (56) and testnet (97):
 * 0xcA11bde05977b3631167028862bE2a173976CA11 (override: MULTICALL3_ADDRESS).
 *
 * - getEthBalances: aggregate3 of Multicall3.getEthBalance(addr), chunks of 500
 * - getTokenBalances: aggregate3 of ERC20.balanceOf(addr) with allowFailure,
 *   failed calls read as 0n
 * - When the aggregate3 call itself throws, fall back to one RPC call per
 *   address (provider.getBalance / eth_call balanceOf).
 *
 * All maps are keyed by lowercase address.
 */

import { Interface, getAddress } from "ethers";
import { DEFAULTS, readEnvString } from "./fees";
import type { ChainReader } from "./ports";

export const MULTICALL3_ABI = [
  "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)",
  "function getEthBalance(address addr) view returns (uint256 balance)",
];

export const ERC20_READ_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
];

export const multicallInterface = new Interface(MULTICALL3_ABI);
export const erc20Interface = new Interface(ERC20_READ_ABI);

export const MULTICALL_CHUNK = 500;

export function multicallAddress(): string {
  return readEnvString("MULTICALL3_ADDRESS", DEFAULTS.MULTICALL3_ADDRESS);
}

interface Aggregate3Call {
  target: string;
  allowFailure: boolean;
  callData: string;
}

interface Aggregate3Result {
  success: boolean;
  returnData: string;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function decodeUint256(data: string): bigint {
  if (!data || data === "0x") return 0n;
  try {
    const [value] = multicallInterface.decodeFunctionResult("getEthBalance", data);
    return BigInt(value);
  } catch {
    return 0n;
  }
}

async function aggregate3(
  provider: ChainReader,
  calls: Aggregate3Call[],
  mcAddress: string
): Promise<Aggregate3Result[]> {
  const data = multicallInterface.encodeFunctionData("aggregate3", [calls]);
  const raw = await provider.call({ to: mcAddress, data });
  const [results] = multicallInterface.decodeFunctionResult("aggregate3", raw);
  return (results as Array<{ success: boolean; returnData: string }>).map((r) => ({
    success: Boolean(r.success),
    returnData: String(r.returnData),
  }));
}

export interface MulticallOptions {
  multicallAddress?: string;
  chunkSize?: number;
}

/** Native balances for many addresses. Keys are lowercase addresses. */
export async function getEthBalances(
  provider: ChainReader,
  addresses: string[],
  options: MulticallOptions = {}
): Promise<Map<string, bigint>> {
  const out = new Map<string, bigint>();
  const unique = dedupeLower(addresses);
  if (unique.length === 0) return out;
  const mc = options.multicallAddress ?? multicallAddress();
  const size = options.chunkSize ?? MULTICALL_CHUNK;

  for (const group of chunk(unique, size)) {
    const calls: Aggregate3Call[] = group.map((addr) => ({
      target: mc,
      allowFailure: true,
      callData: multicallInterface.encodeFunctionData("getEthBalance", [addr]),
    }));
    let results: Aggregate3Result[] | null = null;
    try {
      results = await aggregate3(provider, calls, mc);
    } catch {
      results = null;
    }
    if (results && results.length === group.length) {
      group.forEach((addr, i) => {
        const r = results![i];
        out.set(addr, r.success ? decodeUint256(r.returnData) : 0n);
      });
      continue;
    }
    // Per-call fallback.
    for (const addr of group) {
      try {
        out.set(addr, await provider.getBalance(addr));
      } catch {
        out.set(addr, 0n);
      }
    }
  }
  return out;
}

/** ERC-20 balances of one token for many addresses. Keys are lowercase addresses. */
export async function getTokenBalances(
  provider: ChainReader,
  token: string,
  addresses: string[],
  options: MulticallOptions = {}
): Promise<Map<string, bigint>> {
  const out = new Map<string, bigint>();
  const unique = dedupeLower(addresses);
  if (unique.length === 0) return out;
  const tokenAddress = getAddress(token);
  const mc = options.multicallAddress ?? multicallAddress();
  const size = options.chunkSize ?? MULTICALL_CHUNK;

  for (const group of chunk(unique, size)) {
    const calls: Aggregate3Call[] = group.map((addr) => ({
      target: tokenAddress,
      allowFailure: true,
      callData: erc20Interface.encodeFunctionData("balanceOf", [addr]),
    }));
    let results: Aggregate3Result[] | null = null;
    try {
      results = await aggregate3(provider, calls, mc);
    } catch {
      results = null;
    }
    if (results && results.length === group.length) {
      group.forEach((addr, i) => {
        const r = results![i];
        out.set(addr, r.success ? decodeUint256(r.returnData) : 0n);
      });
      continue;
    }
    // Per-call fallback via eth_call balanceOf.
    for (const addr of group) {
      try {
        const raw = await provider.call({
          to: tokenAddress,
          data: erc20Interface.encodeFunctionData("balanceOf", [addr]),
        });
        out.set(addr, decodeUint256(raw));
      } catch {
        out.set(addr, 0n);
      }
    }
  }
  return out;
}

/** Single ERC-20 balance read (used by the worker for fresh child balances). */
export async function getTokenBalance(
  provider: ChainReader,
  token: string,
  address: string
): Promise<bigint> {
  const raw = await provider.call({
    to: getAddress(token),
    data: erc20Interface.encodeFunctionData("balanceOf", [address]),
  });
  return decodeUint256(raw);
}

export interface TokenMetadata {
  symbol: string;
  name: string;
  decimals: number;
}

/**
 * symbol / name / decimals, each in its own try/catch with fallbacks
 * UNKNOWN / "Unknown token" / 18 (SPEC §6.4).
 */
export async function fetchTokenMetadata(
  provider: ChainReader,
  token: string
): Promise<TokenMetadata> {
  const to = getAddress(token);
  let symbol = "UNKNOWN";
  let name = "Unknown token";
  let decimals = 18;
  try {
    const raw = await provider.call({ to, data: erc20Interface.encodeFunctionData("symbol", []) });
    const [s] = erc20Interface.decodeFunctionResult("symbol", raw);
    if (typeof s === "string" && s.trim()) symbol = s.trim().slice(0, 32);
  } catch {
    /* fallback */
  }
  try {
    const raw = await provider.call({ to, data: erc20Interface.encodeFunctionData("name", []) });
    const [n] = erc20Interface.decodeFunctionResult("name", raw);
    if (typeof n === "string" && n.trim()) name = n.trim().slice(0, 128);
  } catch {
    /* fallback */
  }
  try {
    const raw = await provider.call({ to, data: erc20Interface.encodeFunctionData("decimals", []) });
    const [d] = erc20Interface.decodeFunctionResult("decimals", raw);
    const n = Number(d);
    if (Number.isInteger(n) && n >= 0 && n <= 255) decimals = n;
  } catch {
    /* fallback */
  }
  return { symbol, name, decimals };
}

function dedupeLower(addresses: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of addresses) {
    const l = a.toLowerCase();
    if (!seen.has(l)) {
      seen.add(l);
      out.push(l);
    }
  }
  return out;
}
