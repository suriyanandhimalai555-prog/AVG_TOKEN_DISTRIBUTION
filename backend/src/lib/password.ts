import crypto from "crypto";

/**
 * PBKDF2-SHA512, 100000 iterations, 64 bytes, hex. Moved verbatim from
 * routes/auth.ts so the login route and the managed-wallets re-auth share
 * one implementation (SPEC §6.3).
 */
export function hashPassword(password: string, salt: string): string {
  return crypto
    .pbkdf2Sync(password, salt, 100_000, 64, "sha512")
    .toString("hex");
}

/**
 * Constant-time comparison of a candidate password against a stored
 * PBKDF2 hash. Users without a password (OAuth-only accounts) never match.
 */
export function verifyPassword(
  user: { passwordHash?: string | null; passwordSalt?: string | null },
  password: string
): boolean {
  if (!user.passwordHash || !user.passwordSalt || typeof password !== "string") {
    return false;
  }

  const expected = Buffer.from(user.passwordHash, "hex");
  const computed = Buffer.from(hashPassword(password, user.passwordSalt), "hex");

  if (expected.length === 0 || expected.length !== computed.length) {
    return false;
  }

  return crypto.timingSafeEqual(expected, computed);
}
