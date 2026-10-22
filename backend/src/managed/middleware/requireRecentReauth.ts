import { RequestHandler } from "express";

/** Password re-authentication is valid for 10 minutes (SPEC §6.3). */
export const REAUTH_WINDOW_MS = 10 * 60 * 1000;

const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

export function reauthIsFresh(stampedAt: unknown, now = Date.now()): boolean {
  if (typeof stampedAt !== "number" || !Number.isFinite(stampedAt)) return false;
  return stampedAt <= now && now - stampedAt < REAUTH_WINDOW_MS;
}

/** 401 REAUTH_REQUIRED unless the session was re-authenticated recently. */
export const requireRecentReauth: RequestHandler = (req, res, next) => {
  if (!reauthIsFresh(req.session?.managedReauthAt)) {
    return res.status(401).json({
      error: "Password re-authentication required",
      code: "REAUTH_REQUIRED",
    });
  }
  next();
};

/** Stamps the session; returns the ISO time until which it stays valid. */
export function stampReauth(session: { managedReauthAt?: number }, now = Date.now()): string {
  session.managedReauthAt = now;
  return new Date(now + REAUTH_WINDOW_MS).toISOString();
}

// ─── Per-user failed-attempt limiter (in-memory, single process) ─────────────

interface AttemptWindow {
  failures: number;
  windowStart: number;
}

const attempts = new Map<string, AttemptWindow>();

function windowFor(userId: string, now: number): AttemptWindow {
  const current = attempts.get(userId);
  if (!current || now - current.windowStart >= FAILURE_WINDOW_MS) {
    const fresh = { failures: 0, windowStart: now };
    attempts.set(userId, fresh);
    return fresh;
  }
  return current;
}

/** True when the user has exhausted their failed attempts for the window. */
export function reauthLocked(userId: string, now = Date.now()): boolean {
  return windowFor(userId, now).failures >= MAX_FAILURES;
}

export function recordReauthFailure(userId: string, now = Date.now()): void {
  windowFor(userId, now).failures += 1;
}

export function clearReauthFailures(userId: string): void {
  attempts.delete(userId);
}
