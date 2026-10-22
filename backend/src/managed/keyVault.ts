/**
 * AES-256-GCM encryption of pool mnemonics (SPEC §6.3).
 *
 * Key: WALLET_ENCRYPTION_KEY, base64 of exactly 32 bytes (npm run managed:gen-key).
 * Each record carries its own random 12-byte IV and 16-byte auth tag. The pool id
 * is passed as additional authenticated data so a ciphertext cannot be moved
 * between pools. Nothing in this module logs its inputs or outputs.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

export type KeyVaultErrorCode = "KEY_MISSING" | "KEY_INVALID" | "DECRYPT_FAILED";

export class KeyVaultError extends Error {
  readonly code: KeyVaultErrorCode;

  constructor(code: KeyVaultErrorCode, message: string) {
    super(message);
    this.name = "KeyVaultError";
    this.code = code;
  }
}

/** All fields are base64 strings, ready for the managed_pools mnemonic_* columns. */
export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  tag: string;
  keyVersion: number;
}

export const KEY_VERSION = 1;

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const ALGORITHM = "aes-256-gcm";

function loadKey(): Buffer {
  const raw = process.env.WALLET_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new KeyVaultError("KEY_MISSING", "WALLET_ENCRYPTION_KEY is not set");
  }

  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES || key.toString("base64").replace(/=+$/, "") !== raw.replace(/=+$/, "")) {
    throw new KeyVaultError(
      "KEY_INVALID",
      `WALLET_ENCRYPTION_KEY must be base64 of exactly ${KEY_BYTES} bytes`
    );
  }

  return key;
}

/** True when WALLET_ENCRYPTION_KEY is present and well-formed. */
export function isKeyVaultAvailable(): boolean {
  try {
    loadKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(plaintext: string, aad: string): EncryptedSecret {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("encryptSecret: plaintext must be a non-empty string");
  }
  if (typeof aad !== "string" || aad.length === 0) {
    throw new Error("encryptSecret: aad must be a non-empty string");
  }

  const key = loadKey();
  const iv = randomBytes(IV_BYTES);

  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    keyVersion: KEY_VERSION,
  };
}

export function decryptSecret(record: EncryptedSecret, aad: string): string {
  if (typeof aad !== "string" || aad.length === 0) {
    throw new Error("decryptSecret: aad must be a non-empty string");
  }

  const key = loadKey();

  if (record.keyVersion !== KEY_VERSION) {
    throw new KeyVaultError(
      "KEY_INVALID",
      `unsupported key version ${String(record.keyVersion)}`
    );
  }

  const iv = Buffer.from(record.iv ?? "", "base64");
  const tag = Buffer.from(record.tag ?? "", "base64");
  const ciphertext = Buffer.from(record.ciphertext ?? "", "base64");

  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new KeyVaultError("DECRYPT_FAILED", "malformed encrypted record");
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new KeyVaultError("DECRYPT_FAILED", "authentication failed");
  }
}
