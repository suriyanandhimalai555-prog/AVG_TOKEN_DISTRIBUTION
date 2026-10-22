import { audits } from "./models/audits";
import { ManagedAuditAction } from "./types";
import { managedLog, redact } from "./redact";

export interface ManagedAuditInput {
  userId: string;
  poolId?: string | null;
  walletId?: string | null;
  action: ManagedAuditAction;
  details?: Record<string, unknown>;
}

/**
 * Writes a managed_audits row. Never throws: audit failures must not break
 * the primary operation (same pattern as lib/sessionAudit.ts). Details are
 * redacted before they are stored.
 */
export async function recordManagedAudit(input: ManagedAuditInput): Promise<void> {
  try {
    const details = redact(input.details ?? {}) as Record<string, unknown>;

    await audits.create({
      userId: input.userId,
      poolId: input.poolId ?? null,
      walletId: input.walletId ?? null,
      action: input.action,
      details,
    });
  } catch (err) {
    managedLog("error", "audit write failed", {
      action: input.action,
      poolId: input.poolId ?? null,
      walletId: input.walletId ?? null,
      error: err,
    });
  }
}
