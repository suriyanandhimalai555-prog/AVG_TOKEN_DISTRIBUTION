/**
 * output/wallets.csv import (src/lib/walletsCsv.ts): columns are found by
 * header, the quoted mnemonic is stepped over, and no key or seed phrase ever
 * reaches a parsed row.
 */
import { describe, expect, it } from "vitest";
import { isSafeDerivationPath, parseWalletsCsv } from "../../src/lib/walletsCsv";

const PHRASE = "test test test test test test test test test test test junk";
const KEY_0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const KEY_1 = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const ADDR_0 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const ADDR_1 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const POOL_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

/** Same quoting as csvEscape in scripts/generate-wallets.ts. */
const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;

function expectNoSecrets(rows: unknown): void {
  const json = JSON.stringify(rows);
  expect(json).not.toContain("junk");
  expect(json).not.toContain(KEY_0.slice(2));
  expect(json).not.toContain(KEY_1.slice(2));
}

describe("parseWalletsCsv", () => {
  it("reads the HD_SINGLE_SEED layout", () => {
    const csv = [
      "index,address,privateKey,derivationPath",
      `0,${ADDR_0},${KEY_0},m/44'/60'/0'/0/0`,
      `1,${ADDR_1},${KEY_1},m/44'/60'/0'/0/1`,
    ].join("\n");

    const rows = parseWalletsCsv(csv);
    expect(rows).toEqual([
      { index: 0, address: ADDR_0, derivationPath: "m/44'/60'/0'/0/0" },
      { index: 1, address: ADDR_1, derivationPath: "m/44'/60'/0'/0/1" },
    ]);
    expectNoSecrets(rows);
  });

  it("reads the INDEPENDENT_SEEDS layout and skips the quoted mnemonic", () => {
    const csv =
      "index,address,privateKey,mnemonic,derivationPath\n" +
      `0,${ADDR_0},${KEY_0},${quote(PHRASE)},independent\n` +
      `1,${ADDR_1},${KEY_1},${quote(PHRASE)},independent\n`;

    const rows = parseWalletsCsv(csv);
    expect(rows).toEqual([
      { index: 0, address: ADDR_0, derivationPath: "independent" },
      { index: 1, address: ADDR_1, derivationPath: "independent" },
    ]);
    expectNoSecrets(rows);
  });

  it("reads the Managed Wallets pool layout (empty privateKey)", () => {
    const csv = `index,address,privateKey,derivationPath\n0,${ADDR_0},,pool:${POOL_ID}/1`;
    expect(parseWalletsCsv(csv)).toEqual([
      { index: 0, address: ADDR_0, derivationPath: `pool:${POOL_ID}/1` },
    ]);
  });

  it("finds columns by name, whatever their order", () => {
    const csv = [
      "derivationPath,mnemonic,address,privateKey,index",
      `independent,${quote(PHRASE)},${ADDR_0},${KEY_0},7`,
    ].join("\n");

    expect(parseWalletsCsv(csv)).toEqual([{ index: 7, address: ADDR_0, derivationPath: "independent" }]);
  });

  it("handles commas and escaped quotes inside a quoted field", () => {
    const csv = [
      "index,address,privateKey,mnemonic,derivationPath",
      `0,${ADDR_0},${KEY_0},${quote('word, "quoted", word')},independent`,
    ].join("\n");

    expect(parseWalletsCsv(csv)).toEqual([{ index: 0, address: ADDR_0, derivationPath: "independent" }]);
  });

  it("accepts CRLF line endings, a BOM and blank lines", () => {
    const csv =
      "﻿index,address,privateKey,mnemonic,derivationPath\r\n" +
      `0,${ADDR_0},${KEY_0},${quote(PHRASE)},independent\r\n` +
      "\r\n";

    expect(parseWalletsCsv(csv)).toEqual([{ index: 0, address: ADDR_0, derivationPath: "independent" }]);
  });

  it("skips rows without an address", () => {
    const csv = `index,address,privateKey,derivationPath\n0,,${KEY_0},m/44'/60'/0'/0/0`;
    expect(parseWalletsCsv(csv)).toEqual([]);
  });

  it("returns no rows for a header-only file", () => {
    expect(parseWalletsCsv("index,address,privateKey,mnemonic,derivationPath\n")).toEqual([]);
  });

  it("rejects a header without the required columns", () => {
    expect(() => parseWalletsCsv(`index,address,privateKey\n0,${ADDR_0},${KEY_0}`)).toThrow(
      "wallets.csv header is missing column(s): derivationPath"
    );
  });

  it("rejects a seed phrase in the derivationPath column without echoing it", () => {
    // The pre-fix misread: a 4-column header over 5-column independent rows.
    const csv = [
      "index,address,privateKey,derivationPath",
      `0,${ADDR_0},${KEY_0},${quote(PHRASE)},independent`,
    ].join("\n");

    let message = "";
    try {
      parseWalletsCsv(csv);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toBe("wallets.csv line 2: derivationPath is not a derivation path");
  });

  it("rejects a private key in the derivationPath column", () => {
    const csv = `index,address,derivationPath\n0,${ADDR_0},${KEY_0}`;
    expect(() => parseWalletsCsv(csv)).toThrow("line 2: derivationPath is not a derivation path");
  });

  it("rejects an unterminated quoted field", () => {
    const csv = `index,address,privateKey,mnemonic,derivationPath\n0,${ADDR_0},${KEY_0},"${PHRASE},independent`;
    expect(() => parseWalletsCsv(csv)).toThrow("wallets.csv line 2: unterminated quoted field");
  });

  it("rejects an index that is not a whole number", () => {
    const csv = `index,address,privateKey,derivationPath\nx,${ADDR_0},${KEY_0},m/44'/60'/0'/0/0`;
    expect(() => parseWalletsCsv(csv)).toThrow("wallets.csv line 2: index is not a whole number");
  });
});

describe("isSafeDerivationPath", () => {
  it.each(["independent", "m/44'/60'/0'/0/0", "m/44'/60'/0'/0/12345", `pool:${POOL_ID}/3`])("accepts %s", (value) => {
    expect(isSafeDerivationPath(value)).toBe(true);
  });

  it.each([
    ["a seed phrase", PHRASE],
    ["a quoted seed phrase", quote(PHRASE)],
    ["a private key", KEY_0],
    ["an empty string", ""],
    ["a bare m/", "m/"],
    ["independent with a suffix", "independent extra"],
  ])("rejects %s", (_label, value) => {
    expect(isSafeDerivationPath(value)).toBe(false);
  });
});
