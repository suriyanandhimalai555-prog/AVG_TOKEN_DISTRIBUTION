/**
 * Seeds the known-token catalog (chain/knownTokens.ts) into managed_tokens so
 * every network starts with the major BEP-20 tokens tracked. Idempotent and
 * safe to run on every boot; never throws.
 */
import { KNOWN_TOKENS } from "../chain/knownTokens";
import { tokens } from "../models/tokens";
import { managedLog } from "../redact";
import type { Network } from "../types";

type SeedOutcome = { status: "DONE"; created: number } | { status: "NOT_MIGRATED" } | { status: "ERROR" };

/** Postgres "undefined table" / "undefined column": the migrations have not run yet. */
const NOT_MIGRATED_CODES = new Set(["42P01", "42703"]);

let retryTimer: ReturnType<typeof setTimeout> | null = null;

export async function seedKnownTokens(): Promise<number> {
  const outcome = await trySeed();
  return outcome.status === "DONE" ? outcome.created : 0;
}

/**
 * Seeds now and, while the managed tables do not exist yet, retries every
 * `intervalMs`. A deploy starts the new pod before it runs the migrations, so
 * the first attempt on a fresh database finds no tables. Never throws.
 */
export async function seedKnownTokensWhenReady(intervalMs = 60_000): Promise<void> {
  stopKnownTokenSeedRetry();
  const attempt = async (): Promise<void> => {
    retryTimer = null;
    const outcome = await trySeed();
    if (outcome.status === "NOT_MIGRATED") {
      retryTimer = setTimeout(() => void attempt(), intervalMs);
      retryTimer.unref?.();
    }
  };
  await attempt();
}

export function stopKnownTokenSeedRetry(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
}

async function trySeed(): Promise<SeedOutcome> {
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
    return { status: "DONE", created };
  } catch (err) {
    const code = (err as { code?: string }).code;
    const notMigrated = code !== undefined && NOT_MIGRATED_CODES.has(code);
    managedLog(notMigrated ? "warn" : "error", "known-token seeding skipped", {
      reason: notMigrated ? "managed tables are not migrated yet; retrying" : "database error",
      code,
    });
    return notMigrated ? { status: "NOT_MIGRATED" } : { status: "ERROR" };
  }
}
