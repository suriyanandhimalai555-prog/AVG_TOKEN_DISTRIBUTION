import { afterEach, describe, expect, it, vi } from "vitest";
import { REDACTED, managedLog, redact } from "../../src/managed/redact";

const PHRASE_12 = "test test test test test test test test test test test junk";
const PHRASE_24 =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon " +
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";
const HEX64 = "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const PRIVATE_KEY = `0x${HEX64}`;
const ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

describe("redact", () => {
  it("masks 12 and 24 word phrases", () => {
    expect(redact(PHRASE_12)).toBe(REDACTED);
    expect(redact(PHRASE_24)).toBe(REDACTED);
    expect(redact(`  ${PHRASE_12}\n`)).toBe(REDACTED);
  });

  it("masks 0x-prefixed and bare 64-hex strings", () => {
    expect(redact(PRIVATE_KEY)).toBe(REDACTED);
    expect(redact(HEX64)).toBe(REDACTED);
    expect(redact(HEX64.toUpperCase())).toBe(REDACTED);
    expect(redact(`key=${PRIVATE_KEY} done`)).toBe(`key=${REDACTED} done`);
  });

  it("masks values under secret keys regardless of shape", () => {
    const input = {
      mnemonic: "short",
      mnemonicCiphertext: "YWJj",
      ciphertext: "YWJj",
      privateKey: "nope",
      password: "hunter2",
      PASSWORD: "hunter2",
      nested: { Mnemonic: ["a", "b"], ok: "fine" },
    };

    expect(redact(input)).toEqual({
      mnemonic: REDACTED,
      mnemonicCiphertext: REDACTED,
      ciphertext: REDACTED,
      privateKey: REDACTED,
      password: REDACTED,
      PASSWORD: REDACTED,
      nested: { Mnemonic: REDACTED, ok: "fine" },
    });
  });

  it("leaves ordinary strings, addresses and tx-free values alone", () => {
    expect(redact("Pool created")).toBe("Pool created");
    expect(redact(ADDRESS)).toBe(ADDRESS);
    expect(redact("one two three four five six seven")).toBe("one two three four five six seven");
    expect(redact("Twelve Capitalised Words Are Not A Mnemonic Phrase Here At All Ok")).toBe(
      "Twelve Capitalised Words Are Not A Mnemonic Phrase Here At All Ok"
    );
    expect(redact("0x1234")).toBe("0x1234");
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
    expect(redact(10n)).toBe("10");
  });

  it("deep-clones arrays and objects without mutating the input", () => {
    const input = { list: [PHRASE_12, { privateKey: PRIVATE_KEY }, "ok"], when: new Date(0) };
    const out = redact(input) as { list: unknown[]; when: string };

    expect(out.list).toEqual([REDACTED, { privateKey: REDACTED }, "ok"]);
    expect(out.when).toBe("1970-01-01T00:00:00.000Z");
    expect(input.list[0]).toBe(PHRASE_12);
    expect(out).not.toBe(input);
  });

  it("handles errors and circular references", () => {
    const err = new Error(`bad key ${PRIVATE_KEY}`);
    const out = redact(err) as { name: string; message: string };
    expect(out.name).toBe("Error");
    expect(out.message).toBe(`bad key ${REDACTED}`);

    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(redact(circular)).toEqual({ a: 1, self: "[Circular]" });
  });
});

describe("managedLog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prefixes with [managed] and redacts meta", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    managedLog("info", "pool created", { poolId: "p1", mnemonic: PHRASE_12 });
    managedLog("error", `worker failed ${PRIVATE_KEY}`);

    expect(log).toHaveBeenCalledWith(
      `[managed] pool created ${JSON.stringify({ poolId: "p1", mnemonic: REDACTED })}`
    );
    expect(error).toHaveBeenCalledWith(`[managed] worker failed ${REDACTED}`);
  });
});

describe("redact: long hex blobs (SR-05)", () => {
  it("masks raw signed transactions and calldata of 130+ hex chars", async () => {
    const { redactString } = await import("../../src/managed/redact");
    const blob = "0x" + "ab".repeat(100);
    const out = redactString(`broadcast failed for ${blob} on bsc`);
    expect(out).not.toContain(blob);
    expect(out).toContain("bsc");
  });
  it("leaves short hex such as addresses alone", async () => {
    const { redactString } = await import("../../src/managed/redact");
    const addr = "0x" + "ab".repeat(20);
    expect(redactString(`to ${addr}`)).toContain(addr);
  });
});
