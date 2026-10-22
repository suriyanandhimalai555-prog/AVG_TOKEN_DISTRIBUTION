/**
 * Seeds the known-token catalog (chain/knownTokens.ts) into managed_tokens so
 * every network starts with the major BEP-20 tokens tracked. Idempotent and
 * safe to run on every boot; never throws.
 */
import { KNOWN_TOKENS } from "../chain/knownTokens";
import { tokens } from "../models/tokens";
import { managedLog } from "../redact";
import type { Network } from "../types";

export async function seedKnownTokens(): Promise<number> {
  const list = (Object.keys(KNOWN_TOKENS) as Network[]).flatMap((network) =>
    KNOWN_TOKENS[network].map((t) => ({
      network,
      tokenAddress: t.address,
      symbol: t.symbol,
      name: t.name,
      decimals: t.decimals,
    }))
  );
  try {
    const created = await tokens.seedTracked(list);
    managedLog("info", "known tokens seeded", { catalog: list.length, created });
    return created;
  } catch (err) {
    const code = (err as { code?: string }).code;
    managedLog(code === "42P01" ? "warn" : "error", "known-token seeding skipped", {
      reason: code === "42P01" ? "managed tables are not migrated yet" : "database error",
      code,
    });
    return 0;
  }
}
