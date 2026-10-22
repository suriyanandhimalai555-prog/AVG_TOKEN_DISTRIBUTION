/**
 * Reads output/wallets.csv written by scripts/generate-wallets.ts.
 *
 * The script writes one of two layouts:
 *   HD_SINGLE_SEED:    index,address,privateKey,derivationPath
 *   INDEPENDENT_SEEDS: index,address,privateKey,mnemonic,derivationPath
 * with the mnemonic in double quotes. Columns are found by header name, and
 * only index, address and derivationPath are copied out of a line: the
 * privateKey and mnemonic fields are stepped over and never kept.
 */

export interface WalletCsvRow {
  index: number;
  address: string;
  derivationPath: string;
}

const COLUMNS = ["index", "address", "derivationPath"] as const;

/**
 * "independent", a BIP-44 path such as m/44'/60'/0'/0/7, or a Managed Wallets
 * pool:<poolId>/<index> reference. Anything else could be a secret.
 */
const SAFE_DERIVATION_PATH = /^(independent|m(\/\d+'?)+|pool:[0-9a-f-]+\/\d+)$/;

export function isSafeDerivationPath(value: string): boolean {
  return SAFE_DERIVATION_PATH.test(value);
}

/**
 * Returns the fields at `positions` from one CSV line ("..." quoting, "" for a
 * literal quote). Characters of every other field are skipped, not copied.
 */
function pickFields(line: string, positions: readonly number[], lineNo: number): string[] {
  const keep = new Set(positions);
  const picked = new Map<number, string>();
  let col = 0;
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch !== '"') {
        if (keep.has(col)) value += ch;
      } else if (line[i + 1] === '"') {
        if (keep.has(col)) value += '"';
        i++;
      } else {
        inQuotes = false;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      if (keep.has(col)) picked.set(col, value);
      col++;
      value = "";
    } else if (keep.has(col)) {
      value += ch;
    }
  }

  if (inQuotes) throw new Error(`wallets.csv line ${lineNo}: unterminated quoted field`);
  if (keep.has(col)) picked.set(col, value);

  return positions.map((p) => (picked.get(p) ?? "").trim());
}

/**
 * Parses the whole file. Throws when a required column is missing or a row's
 * derivationPath is not a path; the message never includes the field's value.
 */
export function parseWalletsCsv(content: string): WalletCsvRow[] {
  const lines = content.replace(/^﻿/, "").split(/\r?\n/);
  const header = (lines[0] ?? "").split(",").map((name) => name.trim());

  const positions = COLUMNS.map((name) => header.indexOf(name));
  const missing = COLUMNS.filter((_, i) => positions[i] === -1);
  if (missing.length > 0) {
    throw new Error(`wallets.csv header is missing column(s): ${missing.join(", ")}`);
  }

  const rows: WalletCsvRow[] = [];

  for (let n = 1; n < lines.length; n++) {
    if (lines[n].trim() === "") continue;

    const lineNo = n + 1;
    const [rawIndex, address, derivationPath] = pickFields(lines[n], positions, lineNo);
    if (!address) continue;

    if (!/^\d+$/.test(rawIndex)) {
      throw new Error(`wallets.csv line ${lineNo}: index is not a whole number`);
    }
    if (!isSafeDerivationPath(derivationPath)) {
      throw new Error(`wallets.csv line ${lineNo}: derivationPath is not a derivation path`);
    }

    rows.push({ index: Number(rawIndex), address, derivationPath });
  }

  return rows;
}
