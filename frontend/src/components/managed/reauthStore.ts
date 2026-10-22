/**
 * In-memory memory of the last successful password re-auth (POST /reauth).
 * Sensitive actions within the validity window skip the dialog. Never persisted.
 */
let validUntilMs = 0;

/** Safety margin so a request issued right at the edge is not rejected. */
const MARGIN_MS = 5_000;

export function isReauthValid(now = Date.now()): boolean {
  return validUntilMs - MARGIN_MS > now;
}

export function setReauthValidUntil(iso: string): void {
  const t = new Date(iso).getTime();
  validUntilMs = Number.isFinite(t) ? t : 0;
}

export function clearReauth(): void {
  validUntilMs = 0;
}

export function reauthRemainingMs(now = Date.now()): number {
  return Math.max(0, validUntilMs - now);
}
