/**
 * Shared fixtures for the N8 QA tests (treasury, CSV, view shape, transfers).
 *
 * Every helper writes through the N2 models against the throwaway database
 * (FILE_OWNERSHIP.md "Throwaway test database"). Rows use random addresses
 * and random ids so they never collide with leftovers from earlier nodes
 * (the "N6 smoke pool" holds Hardhat accounts 1..3) or with api.test.ts,
 * which derives those same Hardhat accounts. Callers clean up with
 * `cleanupPools` / `cleanupTokens` / `cleanupUsers`.
 *
 * Importers MUST set DATABASE_URL inside `vi.hoisted` before importing this
 * module: src/lib/postgres.ts reads it at import time.
 */
import { randomBytes, randomUUID } from "crypto";
import { Wallet } from "ethers";
import { Client } from "pg";
import { hashPassword } from "../../../src/lib/password";
import { balances } from "../../../src/managed/models/balances";
import type { BalanceUpsert, MasterBalanceUpsert } from "../../../src/managed/models/balances";
import { deposits } from "../../../src/managed/models/deposits";
import type { NewDeposit } from "../../../src/managed/models/deposits";
import { pools } from "../../../src/managed/models/pools";
import type { PoolRecord } from "../../../src/managed/models/pools";
import { tokens } from "../../../src/managed/models/tokens";
import { wallets } from "../../../src/managed/models/wallets";
import type { ManagedWalletRecord } from "../../../src/managed/models/wallets";
import type { ManagedToken, ManagedWalletStatus, Network } from "../../../src/managed/types";

export const TEST_DB_URL = "postgres://postgres:test@localhost:55432/managed_test?sslmode=disable";

/** True when the throwaway database answers and has the managed tables. */
export async function probeDb(): Promise<boolean> {
  const client = new Client({ connectionString: TEST_DB_URL, connectionTimeoutMillis: 3_000 });
  try {
    await client.connect();
    await client.query("SELECT 1 FROM managed_pools LIMIT 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

export function rawClient(): Client {
  return new Client({ connectionString: TEST_DB_URL });
}

export function randomAddress(): string {
  return Wallet.createRandom().address;
}

export function randomTokenAddress(): string {
  return randomAddress().toLowerCase();
}

export function hex64(): string {
  return randomBytes(32).toString("hex");
}

export function txHash(): string {
  return `0x${hex64()}`;
}

/** A pool row with fake (random) ciphertext: no key vault involved. */
export async function createPool(input: {
  network: Network;
  name?: string;
  masterAddress?: string;
  ownerUserId?: string;
}): Promise<PoolRecord> {
  return pools.create({
    id: randomUUID(),
    ownerUserId: input.ownerUserId ?? randomUUID(),
    name: input.name ?? `N8 QA pool ${randomUUID().slice(0, 8)}`,
    network: input.network,
    masterAddress: input.masterAddress ?? randomAddress(),
    mnemonicCiphertext: randomBytes(64).toString("base64"),
    mnemonicIv: randomBytes(12).toString("base64"),
    mnemonicTag: randomBytes(16).toString("base64"),
  });
}

export interface WalletSpec {
  label?: string | null;
  holderName?: string | null;
  holderEmail?: string | null;
  status?: ManagedWalletStatus;
}

/** Inserts wallets with indexes startIndex..startIndex+n-1 (random addresses) and applies the specs. */
export async function addWallets(
  poolId: string,
  specs: WalletSpec[],
  startIndex = 1
): Promise<ManagedWalletRecord[]> {
  const created = await wallets.insertMany(
    specs.map((spec, i) => ({
      poolId,
      derivationIndex: startIndex + i,
      address: randomAddress(),
      label: spec.label ?? null,
    }))
  );
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const patch: Parameters<typeof wallets.update>[1] = {};
    if (spec.holderName !== undefined) patch.holderName = spec.holderName;
    if (spec.holderEmail !== undefined) patch.holderEmail = spec.holderEmail;
    if (spec.status !== undefined) patch.status = spec.status;
    if (Object.keys(patch).length > 0) await wallets.update(created[i].id, patch);
  }
  const records = await wallets.findByIds(created.map((c) => c.id));
  return records.sort((a, b) => a.derivationIndex - b.derivationIndex);
}

export async function addToken(
  network: Network,
  input: { symbol: string; decimals: number; name?: string; hidden?: boolean; tokenAddress?: string }
): Promise<ManagedToken> {
  const { token } = await tokens.insertTracked({
    network,
    tokenAddress: input.tokenAddress ?? randomTokenAddress(),
    symbol: input.symbol,
    name: input.name ?? `${input.symbol} token`,
    decimals: input.decimals,
  });
  if (input.hidden) {
    const hidden = await tokens.setHidden(token.id, true);
    if (!hidden) throw new Error("setHidden returned null");
    return hidden;
  }
  return token;
}

export async function setBalances(entries: BalanceUpsert[]): Promise<void> {
  await balances.upsertMany(entries);
}

export async function setMasterBalances(entries: MasterBalanceUpsert[]): Promise<void> {
  await balances.upsertMaster(entries);
}

export async function addDeposits(rows: NewDeposit[]): Promise<number> {
  return deposits.insertManyIgnoreDuplicates(rows);
}

/** Admin user row the re-auth route can verify; returns id, email and the plaintext password. */
export async function createAdminUser(client: Client): Promise<{ id: string; email: string; password: string }> {
  const id = randomUUID();
  const email = `n8-qa-${id}@example.test`;
  const password = `pw-${hex64().slice(0, 16)}`;
  const salt = randomBytes(16).toString("hex");
  await client.query(
    `INSERT INTO users (id, email, name, password_hash, password_salt, role)
     VALUES ($1, $2, 'N8 QA Admin', $3, $4, 'ADMIN')`,
    [id, email, hashPassword(password, salt), salt]
  );
  return { id, email, password };
}

/** Deletes pools (wallets, balances, deposits, transfers cascade) and their audits. */
export async function cleanupPools(client: Client, poolIds: string[]): Promise<void> {
  if (poolIds.length === 0) return;
  await client.query("DELETE FROM managed_audits WHERE pool_id = ANY($1::uuid[])", [poolIds]);
  await client.query("DELETE FROM managed_pools WHERE id = ANY($1::uuid[])", [poolIds]);
}

export async function cleanupTokens(client: Client, tokenIds: string[]): Promise<void> {
  if (tokenIds.length === 0) return;
  await client.query("DELETE FROM managed_tokens WHERE id = ANY($1::uuid[])", [tokenIds]);
}

export async function cleanupUsers(client: Client, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  await client.query("DELETE FROM managed_audits WHERE user_id = ANY($1::text[])", [userIds]);
  await client.query("DELETE FROM users WHERE id = ANY($1::text[])", [userIds]);
}
