/**
 * Pool orchestration (ARCHITECTURE.md §3.1). The mnemonic plaintext exists
 * only inside `createPool` and `revealMnemonic` locals and is never logged.
 */
import { randomUUID } from "crypto";
import { recordManagedAudit } from "../audit";
import { generateMnemonic, isValidMnemonic, masterSignerFor, normalizePrivateKey } from "../derive";
import { decryptSecret, encryptSecret } from "../keyVault";
import { deposits } from "../models/deposits";
import { pools } from "../models/pools";
import type { PoolRecord } from "../models/pools";
import { tokens } from "../models/tokens";
import type {
  CreatePoolRequest,
  CreatePoolResponse,
  GetPoolResponse,
  ListPoolsResponse,
  PoolSeedType,
  PoolStatus,
  RevealMnemonicResponse,
  UpdatePoolRequest,
  UpdatePoolResponse,
} from "../types";
import { parseNetwork, requireString, toPool, toPoolSummary } from "./common";
import { badRequest, conflict, notFound, validation } from "./errors";
import { refreshBalancesSoon } from "./indexerService";

export async function requirePoolRecord(poolId: string): Promise<PoolRecord> {
  const pool = await pools.findById(poolId);
  if (!pool) throw notFound("POOL_NOT_FOUND", "Pool not found");
  return pool;
}

export async function listPools(): Promise<ListPoolsResponse> {
  const records = await pools.listAll();
  return { pools: records.map(toPoolSummary) };
}

export async function createPool(
  userId: string,
  body: CreatePoolRequest
): Promise<CreatePoolResponse> {
  const name = requireString(body?.name, "name", 120);
  const network = parseNetwork(body?.network);

  if (body?.mnemonic !== undefined && typeof body.mnemonic !== "string") {
    throw badRequest("INVALID_MNEMONIC", "mnemonic must be a string");
  }
  if (body?.privateKey !== undefined && typeof body.privateKey !== "string") {
    throw badRequest("INVALID_PRIVATE_KEY", "privateKey must be a string");
  }
  const hasPhrase = Boolean(body?.mnemonic?.trim());
  const hasKey = Boolean(body?.privateKey?.trim());
  if (hasPhrase && hasKey) {
    throw badRequest("CONFLICTING_SECRETS", "Send either a mnemonic or a private key, not both");
  }

  // `secret` holds the plaintext phrase or key only inside this function.
  let secretText = "";
  let seedType: PoolSeedType = "MNEMONIC";
  if (hasKey) {
    const key = normalizePrivateKey(body.privateKey as string);
    if (!key) {
      throw badRequest("INVALID_PRIVATE_KEY", "The private key must be 64 hex characters (with or without 0x) and a valid secp256k1 key");
    }
    secretText = key;
    seedType = "PRIVATE_KEY";
  } else if (hasPhrase) {
    secretText = (body.mnemonic as string).trim().split(/\s+/).join(" ");
    if (!isValidMnemonic(secretText)) {
      secretText = "";
      throw badRequest("INVALID_MNEMONIC", "The mnemonic is not a valid BIP-39 phrase");
    }
  } else {
    secretText = generateMnemonic();
  }

  const id = randomUUID();
  let record: PoolRecord;
  try {
    const masterAddress = masterSignerFor(secretText, seedType).address;
    // One pool per master wallet: the same secret derives the same managed
    // addresses, which must stay unique across pools and networks.
    const existing = await pools.findByMasterAddress(masterAddress);
    if (existing) {
      throw conflict("POOL_EXISTS", `A pool already uses this wallet: "${existing.name}"`, {
        poolId: existing.id,
        poolName: existing.name,
        network: existing.network,
        masterAddress: existing.masterAddress,
      });
    }
    const secret = encryptSecret(secretText, id);
    record = await pools.create({
      id,
      ownerUserId: userId,
      name,
      network,
      masterAddress,
      mnemonicCiphertext: secret.ciphertext,
      mnemonicIv: secret.iv,
      mnemonicTag: secret.tag,
      keyVersion: secret.keyVersion,
      seedType,
    });
  } finally {
    secretText = "";
  }

  await recordManagedAudit({
    userId,
    poolId: record.id,
    action: "POOL_CREATED",
    details: { name, network, masterAddress: record.masterAddress, seedType, imported: hasPhrase || hasKey },
  });

  refreshBalancesSoon(network);
  return { pool: toPool(record), masterAddress: record.masterAddress };
}

export async function getPool(poolId: string): Promise<GetPoolResponse> {
  const record = await requirePoolRecord(poolId);
  const [visibleTokens, lastDepositAt] = await Promise.all([
    tokens.listByNetwork(record.network, false),
    deposits.lastDepositAtByPool(poolId),
  ]);

  return {
    pool: toPool(record),
    stats: {
      wallets: record.walletCount,
      assetsTracked: visibleTokens.length,
      lastDepositAt,
    },
  };
}

export async function updatePool(
  userId: string,
  poolId: string,
  body: UpdatePoolRequest
): Promise<UpdatePoolResponse> {
  const existing = await requirePoolRecord(poolId);
  const patch: { name?: string; status?: PoolStatus } = {};

  if (body?.name !== undefined) {
    patch.name = requireString(body.name, "name", 120);
  }
  if (body?.status !== undefined) {
    if (body.status !== "ACTIVE" && body.status !== "ARCHIVED") {
      throw validation("status must be ACTIVE or ARCHIVED");
    }
    patch.status = body.status;
  }
  if (Object.keys(patch).length === 0) {
    throw validation("Nothing to update");
  }

  const updated = await pools.update(poolId, patch);
  if (!updated) throw notFound("POOL_NOT_FOUND", "Pool not found");

  const archived = patch.status === "ARCHIVED" && existing.status !== "ARCHIVED";
  await recordManagedAudit({
    userId,
    poolId,
    action: archived ? "POOL_ARCHIVED" : "POOL_UPDATED",
    details: { ...patch, previousStatus: existing.status },
  });

  return { pool: toPool(updated) };
}

export async function revealMnemonic(
  userId: string,
  poolId: string
): Promise<RevealMnemonicResponse> {
  const record = await requirePoolRecord(poolId);
  const secret = await pools.getSecret(poolId);
  if (!secret) throw notFound("POOL_NOT_FOUND", "Pool not found");

  const plaintext = decryptSecret(secret, poolId);

  await pools.markRevealed(poolId);
  await recordManagedAudit({
    userId,
    poolId,
    action: "MNEMONIC_REVEALED",
    details: { masterAddress: record.masterAddress, seedType: record.seedType },
  });

  const base = { seedType: record.seedType, masterAddress: record.masterAddress, accountPath: record.accountPath };
  return record.seedType === "PRIVATE_KEY" ? { ...base, privateKey: plaintext } : { ...base, mnemonic: plaintext };
}
