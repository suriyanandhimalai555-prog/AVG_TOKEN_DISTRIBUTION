/**
 * Shared helpers for the managed-wallet models.
 *
 * Conventions (see docs/MANAGED_WALLETS_SPEC.md §6.2):
 *  - NUMERIC(78,0) wei columns are read and returned as decimal strings and
 *    accepted as bigint or string on input.
 *  - BIGINT columns (block numbers, gas limit) are returned as numbers.
 *  - Timestamps are returned as ISO-8601 strings, matching managed/types.ts.
 */
import { Pool } from "pg";
import { postgresPool } from "../../lib/postgres";

export const CHUNK_SIZE = 500;

export function requirePool(): Pool {
  if (!postgresPool) {
    throw new Error("[PostgreSQL] DATABASE_URL is not configured");
  }

  return postgresPool;
}

/** Builds "($1, $2, ...), ($n, ...)" for a multi-row VALUES list. */
export function valuesList(
  rowCount: number,
  columnCount: number,
  offset = 0
): string {
  const rows: string[] = [];

  for (let r = 0; r < rowCount; r++) {
    const params: string[] = [];
    for (let c = 1; c <= columnCount; c++) {
      params.push(`$${offset + r * columnCount + c}`);
    }
    rows.push(`(${params.join(", ")})`);
  }

  return rows.join(", ");
}

export type WeiInput = bigint | string;

const WEI_RE = /^[0-9]+$/;

/** Normalizes a wei amount to a decimal string suitable for NUMERIC(78,0). */
export function toWei(value: WeiInput): string {
  const str = typeof value === "bigint" ? value.toString() : value.trim();
  if (!WEI_RE.test(str)) {
    throw new Error(`invalid wei amount: ${JSON.stringify(str)}`);
  }
  return str;
}

export function toNullableWei(
  value: WeiInput | null | undefined
): string | null {
  return value === null || value === undefined ? null : toWei(value);
}

/** NUMERIC comes back from pg as a string; keep it that way. */
export function weiFromRow(value: unknown): string {
  if (value === null || value === undefined) return "0";
  return String(value);
}

export function nullableWeiFromRow(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

/** BIGINT comes back from pg as a string; block numbers fit in a JS number. */
export function intFromRow(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return Number(value);
}

export function isoFromRow(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

export function nullableIsoFromRow(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return isoFromRow(value);
}

/** Escapes LIKE wildcards so user input matches literally (ARCHITECTURE.md §5). */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export function clampLimit(limit: number | undefined, fallback: number, max = 500): number {
  if (limit === undefined || !Number.isFinite(limit)) return fallback;
  return Math.min(Math.max(Math.trunc(limit), 1), max);
}

export function clampSkip(skip: number | undefined): number {
  if (skip === undefined || !Number.isFinite(skip)) return 0;
  return Math.max(Math.trunc(skip), 0);
}
