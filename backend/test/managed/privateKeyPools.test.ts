/**
 * PRIVATE_KEY pools: the imported key is the master and managed wallets derive
 * from HMAC-SHA512("HolderForge managed wallets v1", key) used as a BIP-32 seed.
 * The vectors below are pinned: changing the derivation would strand funds.
 */
import { HDNodeWallet, Wallet, computeHmac, toUtf8Bytes } from "ethers";
import { describe, expect, it } from "vitest";
import {
  PRIVATE_KEY_SEED_DOMAIN,
  addressesForSecret,
  childSignerFor,
  masterSignerFor,
  normalizePrivateKey,
} from "../../src/managed/derive";
import { signersFromSecret } from "../../src/managed/chain/transferWorker";

// Hardhat account #0: public test key, never funded on BSC.
const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const MASTER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const CHILDREN = [
  "0x36E28F4B04d04822247EF90066Bea939a8e88cB8",
  "0x8151Fc415ad7FB61918C3ebAaB9172785a5ecFE2",
  "0x2f8436d0Ce7e245719a5A7c2a669F42c2A0A9b5A",
];
const PHRASE_CHILD_1 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

describe("normalizePrivateKey", () => {
  it("accepts 64 hex with or without 0x, any case, and normalizes to 0x lowercase", () => {
    expect(normalizePrivateKey(KEY)).toBe(KEY);
    expect(normalizePrivateKey(KEY.slice(2))).toBe(KEY);
    expect(normalizePrivateKey(`  0X${KEY.slice(2).toUpperCase()}  `)).toBe(KEY);
  });
  it("rejects wrong length, non-hex, zero, and values at or above the curve order", () => {
    expect(normalizePrivateKey("0x1234")).toBeNull();
    expect(normalizePrivateKey("0x" + "g".repeat(64))).toBeNull();
    expect(normalizePrivateKey("0x" + "0".repeat(64))).toBeNull();
    expect(normalizePrivateKey("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141")).toBeNull();
    expect(normalizePrivateKey("test test test test test test test test test test test junk")).toBeNull();
  });
});

describe("private-key derivation (pinned vectors)", () => {
  it("master is the key's own wallet", () => {
    expect(masterSignerFor(KEY, "PRIVATE_KEY").address).toBe(MASTER);
    expect(masterSignerFor(KEY, "PRIVATE_KEY").address).toBe(new Wallet(KEY).address);
  });

  it("children match the pinned addresses", () => {
    expect(addressesForSecret(KEY, "PRIVATE_KEY", 1, 4).map((r) => r.address)).toEqual(CHILDREN);
    CHILDREN.forEach((addr, i) => expect(childSignerFor(KEY, "PRIVATE_KEY", i + 1).address).toBe(addr));
  });

  it("an independent re-implementation of the documented formula gives the same children", () => {
    const seed = computeHmac("sha512", toUtf8Bytes("HolderForge managed wallets v1"), KEY);
    const account = HDNodeWallet.fromSeed(seed).derivePath("m/44'/60'/0'/0");
    expect([1, 2, 3].map((i) => account.deriveChild(i).address)).toEqual(CHILDREN);
    expect(PRIVATE_KEY_SEED_DOMAIN).toBe("HolderForge managed wallets v1");
  });

  it("is a different tree from phrase pools and never yields the master as a child", () => {
    expect(CHILDREN).not.toContain(PHRASE_CHILD_1);
    expect(CHILDREN).not.toContain(MASTER);
  });

  it("refuses child index 0 and invalid keys", () => {
    expect(() => childSignerFor(KEY, "PRIVATE_KEY", 0)).toThrow();
    expect(() => masterSignerFor("0x1234", "PRIVATE_KEY")).toThrow();
  });
});

describe("worker signers for private-key pools", () => {
  it("signersFromSecret returns plain Wallets for the key master and the derived child", () => {
    const s = signersFromSecret(KEY, "PRIVATE_KEY", "m/44'/60'/0'/0", 2);
    expect(s.master.address).toBe(MASTER);
    expect(s.child.address).toBe(CHILDREN[1]);
    expect(s.master).toBeInstanceOf(Wallet);
    expect(s.child).toBeInstanceOf(Wallet);
    expect(JSON.stringify(s)).not.toContain(KEY.slice(2));
  });

  it("MNEMONIC pools are unchanged", () => {
    const s = signersFromSecret("test test test test test test test test test test test junk", "MNEMONIC", "m/44'/60'/0'/0", 1);
    expect(s.master.address).toBe(MASTER);
    expect(s.child.address).toBe(PHRASE_CHILD_1);
  });
});
