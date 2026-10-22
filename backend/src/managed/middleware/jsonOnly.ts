/**
 * CSRF guard for state-changing managed routes (SECURITY_REVIEW SR-01).
 *
 * Production session cookies are `sameSite: "none"`, and the app mounts
 * `express.urlencoded()` globally, so a cross-site `<form method="POST">` is a
 * "simple" request: no CORS preflight, cookie attached, body parsed. Requiring
 * `Content-Type: application/json` on every non-GET request forces a preflight
 * (which the CORS allow-list already rejects), and the `Sec-Fetch-Site` check
 * stops bodiless cross-site POSTs from modern browsers before any handler runs.
 * A cross-site request is allowed only from an origin the CORS allow-list
 * already trusts (lib/allowedOrigins), e.g. a local frontend calling the API.
 *
 * GET/HEAD/OPTIONS pass through untouched (read-only routes).
 */
import { RequestHandler } from "express";
import { isAllowedOrigin } from "../../lib/allowedOrigins";

const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

export const jsonOnlyGuard: RequestHandler = (req, res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();

  const site = req.get("sec-fetch-site");
  if (site !== undefined && site.trim().toLowerCase() === "cross-site") {
    const origin = req.get("origin");
    if (!origin || !isAllowedOrigin(origin)) {
      return res.status(403).json({ error: "Cross-site request rejected", code: "CROSS_SITE_REQUEST" });
    }
  }

  // req.is() returns null for a bodiless request and false on a mismatch; both
  // are rejected so a bodiless cross-site fetch cannot trigger a side effect.
  if (!req.is("application/json")) {
    return res.status(415).json({
      error: "Content-Type must be application/json",
      code: "UNSUPPORTED_MEDIA_TYPE",
    });
  }

  return next();
};
