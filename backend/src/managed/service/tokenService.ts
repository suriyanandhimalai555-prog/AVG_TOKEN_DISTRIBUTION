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
import { parseNetwork, requireAddress } from "./common";
import { ManagedApiError, badRequest, conflict, notFound, validation } from "./errors";

export async function listTokens(query: ListTokensQuery): Promise<ListTokensResponse> {
  const includeHidden = query.includeHidden === true;
  if (query.network !== undefined) {
    return { tokens: await tokens.listByNetwork(parseNetwork(query.network), includeHidden) };
  }
  return { tokens: await tokens.listAll(includeHidden) };
}

export async function trackToken(
  userId: string,
  body: TrackTokenRequest
): Promise<{ response: TrackTokenResponse; created: boolean }> {
  const network = parseNetwork(body?.network);
  const tokenAddress = requireAddress(body?.tokenAddress, "tokenAddress");

  const existing = await tokens.findByAddress(network, tokenAddress);
  if (existing && existing.source === "TRACKED") {
    throw conflict("ALREADY_TRACKED", "Token is already tracked");
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

  await recordManagedAudit({
    userId,
    action: "TOKEN_TRACKED",
    details: { network, tokenAddress: result.token.tokenAddress, symbol: result.token.symbol, promoted: !result.created },
  });

  return { response: { token: result.token }, created: result.created };
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

  return { token: updated };
}
