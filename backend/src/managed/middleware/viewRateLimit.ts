import { RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";

const DEFAULT_PER_MINUTE = 60;

export function viewRateLimitPerMinute(): number {
  const raw = process.env.MANAGED_VIEW_RATE_LIMIT_PER_MIN?.trim();
  const parsed = raw ? Number(raw) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_PER_MINUTE;
}

/**
 * Per-IP limiter for the public holder view (SPEC §6.6): a fresh instance
 * per mount, reading MANAGED_VIEW_RATE_LIMIT_PER_MIN at construction time.
 * `trust proxy` is set in src/index.ts so the client IP survives the ingress.
 */
export function createViewRateLimit(): RequestHandler {
  return rateLimit({
    windowMs: 60 * 1000,
    limit: viewRateLimitPerMinute(),
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many requests", code: "RATE_LIMITED" },
  });
}
