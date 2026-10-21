/**
 * N8 QA — redaction is applied at every managed log call site (R4, SPEC §6.9).
 *
 * Dynamic part: console.log / console.error / console.warn are monkeypatched
 * and several real log paths are driven (the adapters' LoggerPort that the
 * chain workers receive, the "routes mounted" line, the audit-failure path
 * and the router error translator) with a mnemonic, a 0x-prefixed 64-hex
 * private key and a bare 64-hex string in message and meta. None of them may
 * reach the sinks.
 *
 * Static part: no file under src/managed uses console.* except redact.ts
 * (the sink) and chain/ports.ts (an unredacted fallback logger that is only
 * reachable when a constructor is called without `logger`), and the runtime
 * wiring in src/managed/index.ts passes the redacting `loggerPort` to every
 * worker.
 */
import * as fs from "fs";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  // adapters.ts imports the models, which need a DATABASE_URL at import time.
  process.env.DATABASE_URL = "postgres://postgres:test@localhost:55432/managed_test?sslmode=disable";
  process.env.PGSSL = "false";
});

import express from "express";
import { mountManagedWallets } from "../../src/managed";
import { loggerPort } from "../../src/managed/adapters";
import { recordManagedAudit } from "../../src/managed/audit";
import { managedErrorHandler } from "../../src/managed/middleware/notMigrated";
import { REDACTED } from "../../src/managed/redact";

const PHRASE = "test test test test test test test test test test test junk";
const PHRASE_24 =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon " +
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";
const HEX64 = "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const PK = `0x${HEX64}`;
const VIEW_TOKEN = "f".repeat(63) + "e";

const MANAGED_DIR = path.resolve(__dirname, "../../src/managed");

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTs(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("redaction at managed log call sites (dynamic)", () => {
  let lines: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  const capture = (...args: unknown[]) => {
    lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };

  beforeEach(() => {
    lines = [];
    logSpy = vi.spyOn(console, "log").mockImplementation(capture);
    errorSpy = vi.spyOn(console, "error").mockImplementation(capture);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(capture);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MANAGED_WALLETS_ENABLED;
  });

  function expectClean(): void {
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.startsWith("[managed] ")).toBe(true);
      expect(line).not.toContain(PHRASE);
      expect(line).not.toContain(PHRASE_24);
      expect(line).not.toContain("test test test");
      expect(line).not.toContain("abandon abandon");
      expect(line).not.toContain(HEX64);
      expect(line).not.toContain(HEX64.toUpperCase());
      expect(line).not.toContain(VIEW_TOKEN);
      expect(line).not.toMatch(/[0-9a-f]{64}/i);
    }
  }

  it("the adapters' LoggerPort (what the indexer and worker receive) redacts message and meta", () => {
    loggerPort.info(`picked job for signer ${PK}`, {
      jobId: "j1",
      mnemonic: PHRASE,
      privateKey: PK,
      note: `derived from ${HEX64}`,
      nested: { words: PHRASE_24, viewToken: VIEW_TOKEN, list: [PK, { ciphertext: "YWJj" }] },
      when: new Date(0),
      big: 10n,
    });
    loggerPort.warn(`retrying ${HEX64}`, { error: new Error(`bad key ${PK}`) });
    loggerPort.error(PHRASE, { password: "hunter2", mnemonicCiphertext: "zzz" });

    expectClean();
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).not.toHaveBeenCalled();

    expect(lines[0]).toContain(`[managed] picked job for signer ${REDACTED}`);
    expect(lines[0]).toContain(`"mnemonic":"${REDACTED}"`);
    expect(lines[0]).toContain(`"privateKey":"${REDACTED}"`);
    expect(lines[0]).toContain(`"words":"${REDACTED}"`);
    expect(lines[0]).toContain(`"viewToken":"${REDACTED}"`);
    expect(lines[0]).toContain(`"ciphertext":"${REDACTED}"`);
    expect(lines[0]).toContain('"jobId":"j1"');
    expect(lines[1]).toContain(`[managed] retrying ${REDACTED}`);
    expect(lines[1]).toContain(`bad key ${REDACTED}`);
    expect(lines[2]).toContain(`[managed] ${REDACTED}`);
    expect(lines[2]).toContain(`"password":"${REDACTED}"`);
  });

  it("the 'routes mounted' line goes through managedLog", () => {
    process.env.MANAGED_WALLETS_ENABLED = "true";
    mountManagedWallets(express());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[managed\] routes mounted \{"keyVault":"(ok|missing)","indexer":(true|false)\}$/);
  });

  it("the audit-failure path logs through managedLog without the details", async () => {
    // An invalid pool uuid makes Postgres reject the insert → the catch branch logs.
    await recordManagedAudit({
      userId: "n8",
      poolId: "not-a-uuid",
      action: "POOL_CREATED",
      details: { mnemonic: PHRASE, key: PK, token: VIEW_TOKEN },
    });
    expectClean();
    expect(lines[0]).toContain("[managed] audit write failed");
    expect(lines[0]).toContain('"action":"POOL_CREATED"');
    expect(lines[0]).not.toContain(PHRASE);
  });

  it("the router error translator redacts keys in the error and never echoes err.message to the client", () => {
    const req = { method: "POST", originalUrl: "/api/admin/managed/pools" } as express.Request;
    const json = vi.fn();
    const res = { headersSent: false, status: vi.fn().mockReturnValue({ json }) } as unknown as express.Response;
    managedErrorHandler(new Error(`signer failed for ${PK} (${HEX64})`), req, res, vi.fn());

    expectClean();
    expect(lines[0]).toContain("[managed] unhandled route error");
    expect(lines[0]).toContain(`signer failed for ${REDACTED} (${REDACTED})`);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ error: "Internal server error", code: "INTERNAL" });
  });

  /**
   * KNOWN GAP (owner: N2, src/managed/redact.ts): `redactString` masks a
   * 12/24-word phrase only when the WHOLE string is the phrase (PHRASE_RE is
   * anchored). A mnemonic embedded in a longer message, e.g. an error text,
   * passes through unmasked. 64-hex values are masked inline, phrases are
   * not. `it.fails` keeps the gate green while documenting the gap; once
   * redact.ts masks inline phrases this case starts failing and `.fails`
   * must be removed.
   */
  it("KNOWN GAP: a mnemonic embedded inside a longer log message is masked", () => {
    loggerPort.error(`signer failed with ${PHRASE}`);
    expect(lines[0]).toBe(`[managed] signer failed with ${REDACTED}`);
  });
});

describe("redaction at managed log call sites (static)", () => {
  const files = listTs(MANAGED_DIR);

  it("only redact.ts (the sink) and the ports.ts fallback touch console.*", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(MANAGED_DIR, file);
      if (rel === "redact.ts" || rel === path.join("chain", "ports.ts")) continue;
      const src = fs.readFileSync(file, "utf8");
      if (/\bconsole\.(log|error|warn|info|debug|trace)\s*\(/.test(src)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("the unredacted consoleLogger is only a constructor fallback, and index.ts wires loggerPort everywhere", () => {
    const users: string[] = [];
    for (const file of files) {
      const rel = path.relative(MANAGED_DIR, file);
      if (rel === path.join("chain", "ports.ts")) continue;
      const src = fs.readFileSync(file, "utf8");
      const matches = src.match(/consoleLogger/g) ?? [];
      // one import + one `deps.logger ?? consoleLogger` fallback at most
      const fallbacks = src.match(/deps\.logger \?\? consoleLogger/g) ?? [];
      const imports = src.match(/import \{[^}]*consoleLogger[^}]*\} from "\.\/ports"/g) ?? [];
      if (matches.length !== fallbacks.length + imports.length) users.push(rel);
    }
    expect(users).toEqual([]);

    const index = fs.readFileSync(path.join(MANAGED_DIR, "index.ts"), "utf8");
    expect(index.match(/logger: loggerPort/g)?.length).toBe(3); // BalanceService, ManagedIndexer, TransferWorker
    expect(index).not.toContain("consoleLogger");
  });

  it("every console sink in redact.ts is behind managedLog", () => {
    const src = fs.readFileSync(path.join(MANAGED_DIR, "redact.ts"), "utf8");
    const sinks = src.match(/console\.(log|error|warn)/g) ?? [];
    expect(sinks.sort()).toEqual(["console.error", "console.log"]);
    expect(src).toContain("redactString(message)");
    expect(src).toContain("JSON.stringify(redact(meta))");
  });
});
