/**
 * Token tracking: admin-added tokens with metadata fetched on chain, and the
 * hidden flag that removes a token from balances, sweeps and the holder view.
 */
import { recordManagedAudit } from "../audit";
import { fetchTokenMetadata } from "../chain/multicall";
import { resilientProvider, withFallback } from "../chain/rpc";
import { tokens } from "../models/tokens";
import { managedLog } from "../redact";
import type {
  ListTokensQuery,
  ListTokensResponse,
  TrackTokenRequest,
  TrackTokenResponse,
  UpdateTokenRequest,
  UpdateTokenResponse,
} from "../types";
import { parseNetwork, requireAddress, sanitizeToken } from "./common";
import { ManagedApiError, badRequest, conflict, notFound, validation } from "./errors";
import { refreshBalancesSoon } from "./indexerService";

/** Token metadata is untrusted (SR-07): every response goes through sanitizeToken. */
export async function listTokens(query: ListTokensQuery): Promise<ListTokensResponse> {
  const includeHidden = query.includeHidden === true;
  const list =
    query.network !== undefined
      ? await tokens.listByNetwork(parseNetwork(query.network), includeHidden)
      : await tokens.listAll(includeHidden);
  return { tokens: list.map(sanitizeToken) };
}

export async function trackToken(
  userId: string,
  body: TrackTokenRequest
): Promise<{ response: TrackTokenResponse; created: boolean }> {
  const network = parseNetwork(body?.network);
  const tokenAddress = requireAddress(body?.tokenAddress, "tokenAddress");

  const existing = await tokens.findByAddress(network, tokenAddress);
  if (existing && existing.source === "TRACKED") {
    if (!existing.hidden) throw conflict("ALREADY_TRACKED", "Token is already tracked");
    // Importing a hidden token is a request to see it again.
    const shown = await tokens.setHidden(existing.id, false);
    await recordManagedAudit({
      userId,
      action: "TOKEN_UNHIDDEN",
      details: { tokenId: existing.id, network, tokenAddress: existing.tokenAddress, via: "import" },
    });
    refreshBalancesSoon(network);
    return { response: { token: sanitizeToken(shown ?? existing) }, created: false };
  }

  let code: string;
  try {
    code = await withFallback(network, (p) => p.getCode(tokenAddress));
  } catch (err) {
    managedLog("error", "getCode failed while tracking token", { network, tokenAddress, error: err });
    throw new ManagedApiError(503, "RPC_UNAVAILABLE", "Could not reach the network RPC");
  }
  if (!code || code === "0x") {
    throw badRequest("NOT_A_CONTRACT", "No contract code at that address");
  }

  const meta = await fetchTokenMetadata(resilientProvider(network), tokenAddress);
  const result = await tokens.insertTracked({ network, tokenAddress, ...meta });
  const token = sanitizeToken(result.token);

  await recordManagedAudit({
    userId,
    action: "TOKEN_TRACKED",
    details: { network, tokenAddress: token.tokenAddress, symbol: token.symbol, promoted: !result.created },
  });

  refreshBalancesSoon(network);
  return { response: { token }, created: result.created };
}

export async function setTokenHidden(
  userId: string,
  id: string,
  body: UpdateTokenRequest
): Promise<UpdateTokenResponse> {
  if (typeof body?.hidden !== "boolean") throw validation("hidden must be a boolean");

  const updated = await tokens.setHidden(id, body.hidden);
  if (!updated) throw notFound("TOKEN_NOT_FOUND", "Token not found");

  await recordManagedAudit({
    userId,
    action: body.hidden ? "TOKEN_HIDDEN" : "TOKEN_UNHIDDEN",
    details: { tokenId: updated.id, network: updated.network, tokenAddress: updated.tokenAddress },
  });

  return { token: sanitizeToken(updated) };
}
