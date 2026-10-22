/**
 * Wallet orchestration (ARCHITECTURE.md §3.2): generation, listing with
 * balances, detail, assignment, view-token rotation and the CSV export.
 * The list endpoint never includes view tokens or view URLs (SR-04,
 * ARCHITECTURE §5.3): the token appears only in GET /wallets/:id and on rotate.
 */
import { recordManagedAudit } from "../audit";
import { addressesForSecret } from "../derive";
import { decryptSecret } from "../keyVault";
import { balances } from "../models/balances";
import type { BalanceRecord } from "../models/balances";
import { deposits } from "../models/deposits";
import { maxWalletsPerPool, pools } from "../models/pools";
import { transfers } from "../models/transfers";
import { wallets } from "../models/wallets";
import type { ManagedWalletRecord } from "../models/wallets";
import { User } from "../../models/User";
import { NATIVE_ASSET } from "../types";
import type {
  BalanceEntry,
  GenerateWalletsRequest,
  GenerateWalletsResponse,
  GetWalletResponse,
  ListWalletsQuery,
  ListWalletsResponse,
  ManagedToken,
  ManagedWallet,
  Network,
  RotateViewTokenResponse,
  UpdateWalletRequest,
  UpdateWalletResponse,
} from "../types";
import {
  assetMeta,
  csvCell,
  csvAssetHeaders,
  formatAmount,
  nativeSymbol,
  optionalString,
  requirePositiveInt,
  tokenMetaForNetwork,
  viewUrlFor,
} from "./common";
import { badRequest, conflict, notFound, validation } from "./errors";
import { requirePoolRecord } from "./poolService";
import { toJob } from "./transferService";
import { toDeposit } from "./treasuryService";

const EXPORT_PAGE = 500;

export async function requireWalletRecord(walletId: string): Promise<ManagedWalletRecord> {
  const wallet = await wallets.findById(walletId);
  if (!wallet) throw notFound("WALLET_NOT_FOUND", "Wallet not found");
  return wallet;
}

function stripToken(record: ManagedWalletRecord): ManagedWallet {
  const { viewToken: _viewToken, ...wallet } = record;
  return wallet;
}

/**
 * Balance entries for one wallet: native first (0 when unknown), then every
 * visible token that has a balance row. Hidden tokens are omitted.
 */
export function balanceEntries(
  network: Network,
  rows: BalanceRecord[],
  meta: Map<string, ManagedToken>
): BalanceEntry[] {
  const native = rows.find((r) => r.asset === NATIVE_ASSET);
  const entries: BalanceEntry[] = [
    {
      asset: NATIVE_ASSET,
      symbol: nativeSymbol(network),
      name: "BNB",
      decimals: 18,
      balanceWei: native?.balanceWei ?? "0",
      balance: formatAmount(native?.balanceWei ?? "0", 18),
      blockNumber: native?.blockNumber ?? null,
      updatedAt: native?.updatedAt ?? null,
      hidden: false,
    },
  ];

  for (const row of rows) {
    if (row.asset === NATIVE_ASSET) continue;
    const m = assetMeta(network, row.asset, meta);
    if (m.hidden) continue;
    entries.push({
      asset: row.asset,
      symbol: m.symbol,
      name: m.name,
      decimals: m.decimals,
      balanceWei: row.balanceWei,
      balance: formatAmount(row.balanceWei, m.decimals),
      blockNumber: row.blockNumber,
      updatedAt: row.updatedAt,
      hidden: false,
    });
  }

  return entries;
}

export async function generateWallets(
  userId: string,
  poolId: string,
  body: GenerateWalletsRequest
): Promise<GenerateWalletsResponse> {
  const count = requirePositiveInt(body?.count, "count");
  const max = maxWalletsPerPool();
  if (count > max) {
    throw badRequest("POOL_LIMIT_REACHED", `count must be at most ${max}`);
  }
  const labelPrefix = optionalString(body?.labelPrefix, "labelPrefix", 64) ?? undefined;

  const pool = await requirePoolRecord(poolId);
  if (pool.status !== "ACTIVE") throw conflict("POOL_ARCHIVED", "Pool is archived");

  const secret = await pools.getSecret(poolId);
  if (!secret) throw notFound("POOL_NOT_FOUND", "Pool not found");

  // Decrypt before reserving so a vault failure does not burn indexes.
  let mnemonic = decryptSecret(secret, poolId);
  let derived: Array<{ index: number; address: string }>;
  let range: { from: number; to: number };
  try {
    range = await pools.reserveIndexes(poolId, count);
    derived = addressesForSecret(mnemonic, pool.seedType, range.from, range.to, pool.accountPath);
  } finally {
    mnemonic = "";
  }

  const created = await wallets.insertMany(
    derived.map((d) => ({
      poolId,
      derivationIndex: d.index,
      address: d.address,
      label: labelPrefix !== undefined ? `${labelPrefix}${d.index}` : null,
    }))
  );

  await recordManagedAudit({
    userId,
    poolId,
    action: "WALLETS_GENERATED",
    details: { count: created.length, fromIndex: range.from, toIndex: range.to - 1, labelPrefix: labelPrefix ?? null },
  });

  return { created, nextIndex: range.to };
}

export async function listWallets(
  poolId: string,
  query: ListWalletsQuery
): Promise<ListWalletsResponse> {
  const pool = await requirePoolRecord(poolId);
  const page = await wallets.listByPool(poolId, {
    skip: query.skip,
    limit: query.limit,
    search: query.search,
  });

  const ids = page.wallets.map((w) => w.id);
  const [rows, meta, lastDeposits] = await Promise.all([
    balances.listByWallets(ids),
    tokenMetaForNetwork(pool.network),
    deposits.lastDepositAtByWallets(ids),
  ]);

  const rowsByWallet = new Map<string, BalanceRecord[]>();
  for (const row of rows) {
    const list = rowsByWallet.get(row.walletId) ?? [];
    list.push(row);
    rowsByWallet.set(row.walletId, list);
  }

  return {
    wallets: page.wallets.map((w) => ({
      ...w,
      balances: balanceEntries(pool.network, rowsByWallet.get(w.id) ?? [], meta),
      lastDepositAt: lastDeposits.get(w.id) ?? null,
    })),
    total: page.total,
  };
}

export async function getWallet(walletId: string): Promise<GetWalletResponse> {
  const record = await requireWalletRecord(walletId);
  const pool = await requirePoolRecord(record.poolId);
  const [rows, meta, walletDeposits, walletTransfers, lastDeposits] = await Promise.all([
    balances.listByWallet(walletId),
    tokenMetaForNetwork(pool.network),
    deposits.listByWallet(walletId, 50),
    transfers.listByWallet(walletId, 50),
    deposits.lastDepositAtByWallets([walletId]),
  ]);

  return {
    wallet: {
      ...stripToken(record),
      balances: balanceEntries(pool.network, rows, meta),
      lastDepositAt: lastDeposits.get(walletId) ?? null,
      viewToken: record.viewToken,
      viewUrl: viewUrlFor(record.viewToken),
      deposits: walletDeposits.map((d) => toDeposit(pool.network, d, meta)),
      transfers: walletTransfers.map((t) => toJob(pool.network, t, meta)),
    },
  };
}

export async function updateWallet(
  userId: string,
  walletId: string,
  body: UpdateWalletRequest
): Promise<UpdateWalletResponse> {
  const existing = await requireWalletRecord(walletId);
  const patch: Parameters<typeof wallets.update>[1] = {};

  const label = optionalString(body?.label, "label", 120);
  if (label !== undefined) patch.label = label;
  const holderName = optionalString(body?.holderName, "holderName", 120);
  if (holderName !== undefined) patch.holderName = holderName;
  const holderEmail = optionalString(body?.holderEmail, "holderEmail", 254);
  if (holderEmail !== undefined) patch.holderEmail = holderEmail;

  if (body?.holderUserEmail !== undefined) {
    if (body.holderUserEmail === null) {
      patch.holderUserId = null;
    } else {
      const email = optionalString(body.holderUserEmail, "holderUserEmail", 254);
      if (!email) {
        patch.holderUserId = null;
      } else {
        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) throw badRequest("USER_NOT_FOUND", `No user with email ${email}`);
        patch.holderUserId = user._id;
      }
    }
  }

  if (body?.status !== undefined) {
    if (body.status !== "ACTIVE" && body.status !== "DISABLED") {
      throw validation("status must be ACTIVE or DISABLED");
    }
    patch.status = body.status;
  }

  if (Object.keys(patch).length === 0) {
    throw validation("Nothing to update");
  }

  const updated = await wallets.update(walletId, patch);
  if (!updated) throw notFound("WALLET_NOT_FOUND", "Wallet not found");

  const statusChanged = patch.status !== undefined && patch.status !== existing.status;
  const { status: _status, ...assignment } = patch;
  if (Object.keys(assignment).length > 0) {
    await recordManagedAudit({
      userId,
      poolId: existing.poolId,
      walletId,
      action: "WALLET_ASSIGNED",
      details: assignment,
    });
  }
  if (statusChanged) {
    await recordManagedAudit({
      userId,
      poolId: existing.poolId,
      walletId,
      action: "WALLET_STATUS_CHANGED",
      details: { from: existing.status, to: patch.status },
    });
  }

  return { wallet: stripToken(updated) };
}

export async function rotateViewToken(
  userId: string,
  walletId: string
): Promise<RotateViewTokenResponse> {
  const existing = await requireWalletRecord(walletId);
  const rotated = await wallets.rotateViewToken(walletId);
  if (!rotated) throw notFound("WALLET_NOT_FOUND", "Wallet not found");

  await recordManagedAudit({
    userId,
    poolId: existing.poolId,
    walletId,
    action: "VIEW_TOKEN_ROTATED",
    details: {},
  });

  return { viewToken: rotated.viewToken, viewUrl: viewUrlFor(rotated.viewToken) };
}

/**
 * CSV: index,address,label,holder_name,holder_email,status,<one column per
 * visible asset symbol>. No keys, no view tokens (API.md). Symbols are
 * sanitised by tokenMetaForNetwork; a token symbol that collides with the
 * native symbol or another visible token gets the short token address
 * appended so the header stays unambiguous (SR-07).
 */
export async function exportPoolCsv(
  userId: string,
  poolId: string
): Promise<{ filename: string; csv: string }> {
  const pool = await requirePoolRecord(poolId);
  const meta = await tokenMetaForNetwork(pool.network);
  const visibleTokens = [...meta.values()].filter((t) => !t.hidden);
  const assets = [
    { asset: NATIVE_ASSET, symbol: nativeSymbol(pool.network), decimals: 18 },
    ...visibleTokens.map((t) => ({ asset: t.tokenAddress.toLowerCase(), symbol: t.symbol, decimals: t.decimals })),
  ];
  const headers = csvAssetHeaders(assets);

  const lines: string[] = [
    ["index", "address", "label", "holder_name", "holder_email", "status", ...headers]
      .map(csvCell)
      .join(","),
  ];

  let skip = 0;
  let total = 0;
  for (;;) {
    const page = await wallets.listByPool(poolId, { skip, limit: EXPORT_PAGE });
    if (page.wallets.length === 0) break;
    const rows = await balances.listByWallets(page.wallets.map((w) => w.id));
    const byWalletAsset = new Map<string, string>();
    for (const row of rows) byWalletAsset.set(`${row.walletId}:${row.asset}`, row.balanceWei);

    for (const w of page.wallets) {
      const cells = [
        w.derivationIndex,
        w.address,
        w.label,
        w.holderName,
        w.holderEmail,
        w.status,
        ...assets.map((a) => formatAmount(byWalletAsset.get(`${w.id}:${a.asset}`) ?? "0", a.decimals)),
      ];
      lines.push(cells.map(csvCell).join(","));
    }

    total += page.wallets.length;
    skip += page.wallets.length;
    if (skip >= page.total) break;
  }

  await recordManagedAudit({
    userId,
    poolId,
    action: "EXPORT_DOWNLOADED",
    details: { wallets: total, assets: headers },
  });

  return { filename: `pool-${poolId}.csv`, csv: `${lines.join("\r\n")}\r\n` };
}
