import { describe, expect, it } from "vitest";
import {
  ACCOUNT_PATH,
  accountNode,
  addressesFor,
  childSigner,
  derivationPath,
  generateMnemonic,
  isValidMnemonic,
  masterSigner,
} from "../../src/managed/derive";

/** Hardhat's default mnemonic; account #0 and #1 are well known. */
const HARDHAT = "test test test test test test test test test test test junk";
const ACCOUNT_0 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const ACCOUNT_1 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

describe("derive", () => {
  it("uses the standard account path", () => {
    expect(ACCOUNT_PATH).toBe("m/44'/60'/0'/0");
    expect(accountNode(HARDHAT).path).toBe("m/44'/60'/0'/0");
  });

  it("derives the Hardhat master at index 0", () => {
    const master = masterSigner(HARDHAT);
    expect(master.address).toBe(ACCOUNT_0);
    expect(master.path).toBe("m/44'/60'/0'/0/0");
  });

  it("derives the Hardhat account #1 at index 1", () => {
    const child = childSigner(HARDHAT, 1);
    expect(child.address).toBe(ACCOUNT_1);
    expect(child.path).toBe(derivationPath(1));
  });

  it("refuses child index 0 and non-integers", () => {
    expect(() => childSigner(HARDHAT, 0)).toThrow();
    expect(() => childSigner(HARDHAT, -1)).toThrow();
    expect(() => childSigner(HARDHAT, 1.5)).toThrow();
  });

  it("formats derivation paths", () => {
    expect(derivationPath(5)).toBe("m/44'/60'/0'/0/5");
  });

  it("lists checksummed addresses for a half-open range", () => {
    const rows = addressesFor(HARDHAT, 1, 3);
    expect(rows).toEqual([
      { index: 1, address: ACCOUNT_1 },
      { index: 2, address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" },
    ]);
    expect(addressesFor(HARDHAT, 1, 1)).toEqual([]);
    expect(() => addressesFor(HARDHAT, 0, 2)).toThrow();
    expect(() => addressesFor(HARDHAT, 3, 2)).toThrow();
  });

  it("tolerates surrounding and repeated whitespace", () => {
    const messy = `  ${HARDHAT.replace(/ /g, "  ")}\n`;
    expect(isValidMnemonic(messy)).toBe(true);
    expect(masterSigner(messy).address).toBe(ACCOUNT_0);
  });

  it("validates and generates mnemonics", () => {
    expect(isValidMnemonic(HARDHAT)).toBe(true);
    expect(isValidMnemonic("test test test")).toBe(false);
    expect(isValidMnemonic("")).toBe(false);

    const fresh = generateMnemonic();
    expect(fresh.split(" ")).toHaveLength(12);
    expect(isValidMnemonic(fresh)).toBe(true);
    expect(generateMnemonic()).not.toBe(fresh);
  });
});
