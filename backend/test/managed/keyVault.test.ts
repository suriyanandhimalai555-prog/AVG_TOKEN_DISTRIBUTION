import { randomBytes } from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  KeyVaultError,
  decryptSecret,
  encryptSecret,
  isKeyVaultAvailable,
} from "../../src/managed/keyVault";

const PHRASE = "test test test test test test test test test test test junk";
const POOL_ID = "6d1f4a3e-0000-4000-8000-000000000001";

function expectKeyVaultError(fn: () => unknown, code: KeyVaultError["code"]): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(KeyVaultError);
    expect((err as KeyVaultError).code).toBe(code);
    return;
  }
  throw new Error(`expected KeyVaultError ${code}`);
}

describe("keyVault", () => {
  const originalKey = process.env.WALLET_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.WALLET_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.WALLET_ENCRYPTION_KEY;
    else process.env.WALLET_ENCRYPTION_KEY = originalKey;
  });

  it("round-trips a mnemonic with the pool id as AAD", () => {
    const record = encryptSecret(PHRASE, POOL_ID);

    expect(record.keyVersion).toBe(1);
    expect(Buffer.from(record.iv, "base64")).toHaveLength(12);
    expect(Buffer.from(record.tag, "base64")).toHaveLength(16);
    expect(record.ciphertext).not.toContain("test");

    expect(decryptSecret(record, POOL_ID)).toBe(PHRASE);
  });

  it("uses a fresh IV per call", () => {
    const a = encryptSecret(PHRASE, POOL_ID);
    const b = encryptSecret(PHRASE, POOL_ID);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("fails with DECRYPT_FAILED under a different AAD", () => {
    const record = encryptSecret(PHRASE, POOL_ID);
    expectKeyVaultError(
      () => decryptSecret(record, "6d1f4a3e-0000-4000-8000-000000000002"),
      "DECRYPT_FAILED"
    );
  });

  it("fails with DECRYPT_FAILED when the ciphertext is tampered", () => {
    const record = encryptSecret(PHRASE, POOL_ID);
    const bytes = Buffer.from(record.ciphertext, "base64");
    bytes[0] ^= 0xff;
    const tampered = { ...record, ciphertext: bytes.toString("base64") };

    expectKeyVaultError(() => decryptSecret(tampered, POOL_ID), "DECRYPT_FAILED");
  });

  it("fails with DECRYPT_FAILED when the tag is tampered", () => {
    const record = encryptSecret(PHRASE, POOL_ID);
    const bytes = Buffer.from(record.tag, "base64");
    bytes[3] ^= 0x01;
    const tampered = { ...record, tag: bytes.toString("base64") };

    expectKeyVaultError(() => decryptSecret(tampered, POOL_ID), "DECRYPT_FAILED");
  });

  it("fails with DECRYPT_FAILED under a different key", () => {
    const record = encryptSecret(PHRASE, POOL_ID);
    process.env.WALLET_ENCRYPTION_KEY = randomBytes(32).toString("base64");

    expectKeyVaultError(() => decryptSecret(record, POOL_ID), "DECRYPT_FAILED");
  });

  it("reports KEY_MISSING when the key is not set", () => {
    delete process.env.WALLET_ENCRYPTION_KEY;

    expect(isKeyVaultAvailable()).toBe(false);
    expectKeyVaultError(() => encryptSecret(PHRASE, POOL_ID), "KEY_MISSING");
    expectKeyVaultError(
      () => decryptSecret({ ciphertext: "", iv: "", tag: "", keyVersion: 1 }, POOL_ID),
      "KEY_MISSING"
    );
  });

  it("reports KEY_INVALID when the key is not 32 bytes of base64", () => {
    process.env.WALLET_ENCRYPTION_KEY = randomBytes(16).toString("base64");
    expect(isKeyVaultAvailable()).toBe(false);
    expectKeyVaultError(() => encryptSecret(PHRASE, POOL_ID), "KEY_INVALID");

    process.env.WALLET_ENCRYPTION_KEY = "not base64 at all!!";
    expect(isKeyVaultAvailable()).toBe(false);
    expectKeyVaultError(() => encryptSecret(PHRASE, POOL_ID), "KEY_INVALID");
  });

  it("reports availability when the key is valid", () => {
    expect(isKeyVaultAvailable()).toBe(true);
  });
});
