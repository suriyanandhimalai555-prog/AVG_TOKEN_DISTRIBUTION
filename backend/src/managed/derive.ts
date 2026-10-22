/**
 * HD derivation for managed pools (SPEC §6.3).
 *
 * Mirrors backend/scripts/generate-wallets.ts exactly: the account node is
 * m/44'/60'/0'/0 and every wallet is one deriveChild(i) below it, so a seed
 * imported into MetaMask shows the master (index 0) as its first account.
 * Child signers are derived in memory only and never persisted.
 */
import { ethers } from "ethers";

export const ACCOUNT_PATH = "m/44'/60'/0'/0";

function normalizePhrase(mnemonic: string): string {
  return mnemonic.trim().split(/\s+/).join(" ");
}

export function isValidMnemonic(mnemonic: string): boolean {
  if (typeof mnemonic !== "string") return false;
  const phrase = normalizePhrase(mnemonic);
  if (phrase.length === 0) return false;
  return ethers.Mnemonic.isValidMnemonic(phrase);
}

/** Fresh 12-word BIP-39 phrase. */
export function generateMnemonic(): string {
  const mnemonic = ethers.Wallet.createRandom().mnemonic;
  if (!mnemonic) {
    throw new Error("ethers did not return a mnemonic");
  }
  return mnemonic.phrase;
}

export function derivationPath(index: number): string {
  return `${ACCOUNT_PATH}/${index}`;
}

/** The node at m/44'/60'/0'/0; children are deriveChild(i). */
export function accountNode(mnemonic: string): ethers.HDNodeWallet {
  return ethers.HDNodeWallet.fromPhrase(normalizePhrase(mnemonic), undefined, ACCOUNT_PATH);
}

/** Index 0: the pool master (gas funder, default sweep destination). */
export function masterSigner(mnemonic: string): ethers.HDNodeWallet {
  return accountNode(mnemonic).deriveChild(0);
}

function assertChildIndex(index: number): void {
  if (!Number.isInteger(index) || index < 1) {
    throw new Error(`child index must be an integer >= 1, got ${String(index)}`);
  }
}

/** Index i >= 1: a managed deposit wallet. */
export function childSigner(mnemonic: string, index: number): ethers.HDNodeWallet {
  assertChildIndex(index);
  return accountNode(mnemonic).deriveChild(index);
}

/**
 * Checksummed addresses for the half-open index range [from, to), matching
 * pools.reserveIndexes. Only the account node is derived from the phrase;
 * each address is a single deriveChild.
 */
export function addressesFor(
  mnemonic: string,
  from: number,
  to: number
): Array<{ index: number; address: string }> {
  assertChildIndex(from);
  if (!Number.isInteger(to) || to < from) {
    throw new Error(`invalid index range [${String(from)}, ${String(to)})`);
  }

  const node = accountNode(mnemonic);
  const out: Array<{ index: number; address: string }> = [];

  for (let i = from; i < to; i++) {
    out.push({ index: i, address: node.deriveChild(i).address });
  }

  return out;
}

// ─── Private-key pools ────────────────────────────────────────────────────────
//
// A private key is a single wallet: it has no chain code, so BIP-32 children
// cannot be derived from it directly. For a PRIVATE_KEY pool:
//   - the master (gas funder, default sweep destination) IS the imported key;
//   - managed wallets i >= 1 come from a BIP-32 seed computed as
//       seed = HMAC-SHA512(key = "HolderForge managed wallets v1", data = privateKeyBytes)
//     then the same account path m/44'/60'/0'/0 and deriveChild(i).
// The key alone recovers every wallet (scripts/managed/derive-from-key.ts), but
// the children cannot be imported into MetaMask with a seed phrase.

export type PoolSecretKind = "MNEMONIC" | "PRIVATE_KEY";

export const PRIVATE_KEY_SEED_DOMAIN = "HolderForge managed wallets v1";

/** 0x-prefixed lowercase 64-hex, or null when the input is not a usable secp256k1 key. */
export function normalizePrivateKey(input: string): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  const hex = raw.startsWith("0x") || raw.startsWith("0X") ? raw.slice(2) : raw;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return null;
  const key = `0x${hex.toLowerCase()}`;
  try {
    // Rejects zero and values at or above the curve order.
    new ethers.Wallet(key);
  } catch {
    return null;
  }
  return key;
}

function privateKeyAccountNode(privateKey: string): ethers.HDNodeWallet {
  const seed = ethers.computeHmac("sha512", ethers.toUtf8Bytes(PRIVATE_KEY_SEED_DOMAIN), privateKey);
  return ethers.HDNodeWallet.fromSeed(seed).derivePath(ACCOUNT_PATH);
}

function requireKey(privateKey: string): string {
  const key = normalizePrivateKey(privateKey);
  if (!key) throw new Error("invalid private key");
  return key;
}

/** Master signer for either kind of pool secret. */
export function masterSignerFor(secret: string, kind: PoolSecretKind): ethers.Wallet | ethers.HDNodeWallet {
  return kind === "PRIVATE_KEY" ? new ethers.Wallet(requireKey(secret)) : masterSigner(secret);
}

/** Child signer i >= 1 for either kind of pool secret. */
export function childSignerFor(secret: string, kind: PoolSecretKind, index: number): ethers.HDNodeWallet {
  assertChildIndex(index);
  return kind === "PRIVATE_KEY" ? privateKeyAccountNode(requireKey(secret)).deriveChild(index) : childSigner(secret, index);
}

/** Like addressesFor, for either kind of pool secret. */
export function addressesForSecret(
  secret: string,
  kind: PoolSecretKind,
  from: number,
  to: number
): Array<{ index: number; address: string }> {
  if (kind === "MNEMONIC") return addressesFor(secret, from, to);
  assertChildIndex(from);
  if (!Number.isInteger(to) || to < from) {
    throw new Error(`invalid index range [${String(from)}, ${String(to)})`);
  }
  const node = privateKeyAccountNode(requireKey(secret));
  const out: Array<{ index: number; address: string }> = [];
  for (let i = from; i < to; i++) out.push({ index: i, address: node.deriveChild(i).address });
  return out;
}
