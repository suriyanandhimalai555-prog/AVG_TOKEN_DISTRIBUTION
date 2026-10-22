/**
 * Prints a fresh WALLET_ENCRYPTION_KEY (base64 of 32 random bytes) and nothing else.
 * Usage: npm run managed:gen-key
 */
import { randomBytes } from "crypto";

process.stdout.write(`${randomBytes(32).toString("base64")}\n`);
