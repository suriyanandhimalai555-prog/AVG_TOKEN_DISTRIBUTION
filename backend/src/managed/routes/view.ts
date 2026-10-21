/**
 * /api/view/:viewToken — public holder page data (API.md). No auth, rate
 * limited per IP. Never includes pool id, pool name, derivation index, other
 * wallets, hidden tokens, or any admin field.
 */
import { Request, Response, Router } from "express";
import { explorerTxUrl } from "../chain/rpc";
import { createViewRateLimit } from "../middleware/viewRateLimit";
import { managedErrorHandler } from "../middleware/notMigrated";
import { balances } from "../models/balances";
import { deposits } from "../models/deposits";
import { wallets } from "../models/wallets";
import { assetMeta, formatAmount, nativeSymbol, tokenMetaForNetwork } from "../service/common";
import { NATIVE_ASSET } from "../types";
import type { WalletViewResponse } from "../types";

const TOKEN_RE = /^[0-9a-f]{64}$/i;

/** API.md shape plus an additive `explorerUrl` per deposit. */
export type PublicWalletView = Omit<WalletViewResponse, "deposits"> & {
  deposits: Array<WalletViewResponse["deposits"][number] & { explorerUrl: string }>;
};

function notFound(res: Response): void {
  res.status(404).json({ error: "Not found" });
}

async function handleView(req: Request, res: Response): Promise<void> {
  res.setHeader("Cache-Control", "no-store");

  const token = String(req.params.viewToken ?? "");
  if (!TOKEN_RE.test(token)) return notFound(res);

  const wallet = await wallets.findByViewToken(token.toLowerCase());
  if (!wallet || wallet.status !== "ACTIVE" || wallet.poolStatus !== "ACTIVE") {
    return notFound(res);
  }

  const network = wallet.network;
  const [rows, meta, recent] = await Promise.all([
    balances.listByWallet(wallet.id),
    tokenMetaForNetwork(network),
    deposits.listByWallet(wallet.id, 50),
  ]);

  const native = rows.find((r) => r.asset === NATIVE_ASSET);
  const tokens: PublicWalletView["tokens"] = [];
  for (const row of rows) {
    if (row.asset === NATIVE_ASSET) continue;
    const m = assetMeta(network, row.asset, meta);
    if (m.hidden) continue;
    tokens.push({
      tokenAddress: row.asset,
      symbol: m.symbol,
      name: m.name,
      decimals: m.decimals,
      balanceWei: row.balanceWei,
      balance: formatAmount(row.balanceWei, m.decimals),
    });
  }

  const visibleDeposits: PublicWalletView["deposits"] = [];
  for (const d of recent) {
    const m = assetMeta(network, d.asset, meta);
    if (m.hidden) continue;
    visibleDeposits.push({
      txHash: d.txHash,
      asset: d.asset,
      symbol: m.symbol,
      decimals: m.decimals,
      amountWei: d.amountWei,
      amount: formatAmount(d.amountWei, m.decimals),
      from: d.fromAddress,
      blockNumber: d.blockNumber,
      blockTime: d.blockTime,
      explorerUrl: explorerTxUrl(network, d.txHash),
    });
  }

  let updatedAt: string | null = null;
  for (const r of rows) if (!updatedAt || r.updatedAt > updatedAt) updatedAt = r.updatedAt;

  const body: PublicWalletView = {
    label: wallet.label,
    address: wallet.address,
    network,
    native: {
      symbol: nativeSymbol(network),
      balanceWei: native?.balanceWei ?? "0",
      balance: formatAmount(native?.balanceWei ?? "0", 18),
    },
    tokens,
    deposits: visibleDeposits,
    updatedAt,
  };
  res.json(body);
}

export function createViewRouter(): Router {
  const router = Router();
  router.use(createViewRateLimit());
  router.get("/:viewToken", (req, res, next) => {
    handleView(req, res).catch(next);
  });
  router.use(managedErrorHandler);
  return router;
}
