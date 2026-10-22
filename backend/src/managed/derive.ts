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
