/**
 * Log redaction for the managed-wallet feature (SPEC §6.9, R4).
 *
 * `redact` deep-clones a value and masks anything that looks like a secret:
 *  - 12 or 24 word lowercase phrases (BIP-39 mnemonics),
 *  - 64-hex strings with or without a 0x prefix (private keys, view tokens;
 *    transaction hashes share this shape and are masked too),
 *  - every value under a key named mnemonic, mnemonicCiphertext, ciphertext,
 *    privateKey or password (any casing).
 *
 * `managedLog` is the only logger the feature should use.
 */

export const REDACTED = "[REDACTED]";

const SECRET_KEYS = new Set([
  "mnemonic",
  "mnemonicciphertext",
  "ciphertext",
  "privatekey",
  "password",
]);

const PHRASE_RE = /^(?:[a-z]+ ){11}[a-z]+$|^(?:[a-z]+ ){23}[a-z]+$/;
const HEX64_INLINE_RE = /(?<![0-9a-zA-Z])(?:0x)?[0-9a-fA-F]{64}(?![0-9a-zA-Z])/g;

const MAX_DEPTH = 16;

export function isSecretKey(key: string): boolean {
  return SECRET_KEYS.has(key.toLowerCase());
}

export function redactString(value: string): string {
  const collapsed = value.trim().split(/\s+/).join(" ");
  if (PHRASE_RE.test(collapsed)) return REDACTED;
  return value.replace(HEX64_INLINE_RE, REDACTED);
}

function redactInner(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;

  switch (typeof value) {
    case "string":
      return redactString(value);
    case "bigint":
      return value.toString();
    case "number":
    case "boolean":
      return value;
    case "symbol":
    case "function":
      return undefined;
    default:
      break;
  }

  if (depth > MAX_DEPTH) return "[Truncated]";

  if (value instanceof Date) return value.toISOString();

  if (typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactInner(item, depth + 1, seen));
  }

  if (value instanceof Error) {
    const out: Record<string, unknown> = {
      name: value.name,
      message: redactString(value.message),
    };
    if (value.stack) out.stack = redactString(value.stack);
    const code = (value as { code?: unknown }).code;
    if (code !== undefined) out.code = redactInner(code, depth + 1, seen);
    return out;
  }

  if (value instanceof Map) {
    return redactInner(Object.fromEntries(value), depth, seen);
  }

  if (value instanceof Set) {
    return redactInner(Array.from(value), depth, seen);
  }

  if (Buffer.isBuffer(value)) {
    return `[Buffer ${value.length} bytes]`;
  }

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretKey(key)) {
      out[key] = item === null || item === undefined ? item : REDACTED;
      continue;
    }
    out[key] = redactInner(item, depth + 1, seen);
  }
  return out;
}

/** Returns a redacted deep copy; the input is never mutated. */
export function redact(value: unknown): unknown {
  return redactInner(value, 0, new WeakSet());
}

export type ManagedLogLevel = "info" | "warn" | "error";

/** Prints `[managed] <message> <redacted meta as JSON>` to stdout (info) or stderr (warn, error). */
export function managedLog(level: ManagedLogLevel, message: string, meta?: unknown): void {
  const line = `[managed] ${redactString(message)}`;
  const sink = level === "info" ? console.log : console.error;

  if (meta === undefined) {
    sink(line);
    return;
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(redact(meta));
  } catch {
    serialized = "[unserializable meta]";
  }

  sink(`${line} ${serialized}`);
}
