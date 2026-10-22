/**
 * Browser origins the API trusts with credentialed requests. Shared by the CORS
 * middleware (src/index.ts) and the Managed Wallets CSRF guard, so both always
 * agree on who may call the API cross-site (e.g. a local frontend on
 * http://localhost:5173 talking to the production API).
 */
function allowedOrigins(): string[] {
  return [
    "http://localhost:5173",
    "http://localhost:3000",
    process.env.FRONTEND_URL ?? "",
    process.env.CLIENT_URL ?? "",
  ].filter(Boolean);
}

function hostMatchesAllowed(requestOrigin: string): boolean {
  try {
    const reqBase = new URL(requestOrigin).hostname.replace(/^www\./i, "");
    for (const allowed of allowedOrigins()) {
      if (new URL(allowed).hostname.replace(/^www\./i, "") === reqBase) return true;
    }
  } catch {
    /* ignore malformed origin */
  }
  return false;
}

export function isAllowedOrigin(origin: string): boolean {
  return allowedOrigins().includes(origin) || hostMatchesAllowed(origin);
}
