/**
 * Managed Wallets — ethers-free formatting and small shared helpers.
 * All wei values are decimal strings; math is done with BigInt.
 */
import type { Network, TransferStatus } from "@/lib/managedTypes";

/** Groups the integer part with thousands separators (BigInt safe). */
function groupInt(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * wei string → human string divided by 10^decimals, truncated (not rounded) to
 * `maxFraction` fractional digits, trailing zeros removed.
 */
export function formatUnits(wei: string | bigint | null | undefined, decimals: number, maxFraction = 6): string {
  if (wei === null || wei === undefined || wei === "") return "0";
  let v: bigint;
  try {
    v = typeof wei === "bigint" ? wei : BigInt(wei);
  } catch {
    return "0";
  }
  const neg = v < 0n;
  if (neg) v = -v;
  const d = Math.max(0, Math.floor(decimals));
  const base = 10n ** BigInt(d);
  const int = groupInt((v / base).toString());
  let frac = d === 0 ? "" : (v % base).toString().padStart(d, "0");
  frac = frac.slice(0, Math.max(0, maxFraction)).replace(/0+$/, "");
  return `${neg ? "-" : ""}${int}${frac ? `.${frac}` : ""}`;
}

/** Formats a wei string as BNB with up to 8 fraction digits. */
export function formatBnb(wei: string | bigint | null | undefined): string {
  return formatUnits(wei, 18, 8);
}

/** Formats a wei gas price as gwei. */
export function formatGwei(wei: string | bigint | null | undefined): string {
  return formatUnits(wei, 9, 4);
}

/** Thousands-grouped integer (gas limits, block numbers). */
export function formatInt(n: number | string | bigint | null | undefined): string {
  if (n === null || n === undefined || n === "") return "—";
  return groupInt(String(n));
}

export function isZeroWei(wei: string | null | undefined): boolean {
  if (!wei) return true;
  try {
    return BigInt(wei) === 0n;
  } catch {
    return true;
  }
}

/** Is a human amount string a valid, positive decimal within `decimals` places? */
export function isValidAmount(amount: string, decimals: number): boolean {
  const t = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(t) && !/^\.\d+$/.test(t)) return false;
  const frac = t.split(".")[1] ?? "";
  if (frac.length > decimals) return false;
  return /[1-9]/.test(t);
}

export function isMainnet(network: Network): boolean {
  return network === "bscMainnet";
}

export function nativeSymbol(network: Network): "BNB" | "tBNB" {
  return network === "bscMainnet" ? "BNB" : "tBNB";
}

export function networkLabel(network: Network): string {
  return network === "bscMainnet" ? "BNB Mainnet" : "BNB Testnet";
}

export const TERMINAL_STATUSES: ReadonlySet<TransferStatus> = new Set<TransferStatus>(["CONFIRMED", "FAILED", "CANCELLED"]);

export function isTerminalStatus(status: TransferStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function hasActiveJob(jobs: ReadonlyArray<{ status: TransferStatus }> | undefined): boolean {
  return Boolean(jobs?.some((j) => !isTerminalStatus(j.status)));
}

/** Maps a job status to the existing StatusBadge vocabulary. */
export function badgeStatus(status: TransferStatus): "pending" | "confirmed" | "failed" {
  if (status === "CONFIRMED") return "confirmed";
  if (status === "FAILED" || status === "CANCELLED") return "failed";
  return "pending";
}

/** Polling interval: 5 s while any job on screen is active, else 30 s. */
export function pollingInterval(active: boolean): number {
  return active ? 5000 : 30000;
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "—";
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function isValidAddress(v: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(v.trim());
}

/** Validates a BIP-39 looking phrase: 12 or 24 lowercase words. */
export function mnemonicWordCount(phrase: string): number {
  const t = phrase.trim();
  return t ? t.split(/\s+/).length : 0;
}
export function isValidMnemonicShape(phrase: string): boolean {
  const words = phrase.trim().split(/\s+/).filter(Boolean);
  return (words.length === 12 || words.length === 24) && words.every((w) => /^[a-z]+$/.test(w));
}

/** Extracts a user-facing message from an axios-shaped (or plain) error. */
export function apiErrorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (typeof err === "object" && err !== null) {
    const e = err as { response?: { status?: number; data?: { error?: string; code?: string } }; message?: string };
    const data = e.response?.data;
    if (data?.error) return data.code ? `${data.error} (${data.code})` : data.error;
    if (e.response?.status === 401) return "Re-authentication required";
    if (e.response?.status === 403) return "Forbidden";
    if (e.response?.status === 404) return "Not found";
    if (e.message) return e.message;
  }
  return fallback;
}

export function apiErrorCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null) {
    const e = err as { response?: { data?: { code?: string } } };
    return e.response?.data?.code;
  }
  return undefined;
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Fallback for very old browsers: RFC4122-ish from Math.random.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
