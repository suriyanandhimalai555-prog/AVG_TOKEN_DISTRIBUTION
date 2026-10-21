/**
 * N8 QA — service-level coverage over the throwaway database:
 *
 *  - treasury aggregation (pool + global): formatted totals by decimals,
 *    hidden tokens excluded, walletsWithBalance, per-network metadata keying,
 *    lowGas threshold (MANAGED_TOPUP_BUFFER_WEI × 50);
 *  - CSV export: exact documented header, formula-injection neutralisation,
 *    RFC 4180 quoting, no key / mnemonic / ciphertext / view token in any cell;
 *  - public view: exact key set, hidden tokens and other wallets excluded,
 *    404 for DISABLED wallets and ARCHIVED pools;
 *  - wallet list items carry viewUrl but never viewToken;
 *  - sweep enumeration: DISABLED wallets and hidden tokens skipped, "ALL"
 *    semantics, idempotent batches, 409 on archived pools.
 *
 * All token-bearing rows live on bscMainnet so this file never changes the
 * bscTestnet token set that api.test.ts (N5) asserts on. Everything runs
 * sequentially inside this one file for the same reason. Rows are created
 * here and deleted in afterAll; leftovers from earlier nodes are tolerated.
 */
import { randomUUID } from "crypto";
import express from "express";
import session from "express-session";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const SAVED_ENV: Record<string, string | undefined> = {};
const ENV_KEYS = [
  "MANAGED_WALLETS_ENABLED",
  "WALLET_ENCRYPTION_KEY",
  "MANAGED_TOPUP_BUFFER_WEI",
  "FRONTEND_URL",
  "MANAGED_VIEW_RATE_LIMIT_PER_MIN",
];

// lib/postgres reads DATABASE_URL at import time; vi.hoisted runs before the src imports.
vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://postgres:test@localhost:55432/managed_test?sslmode=disable";
  process.env.PGSSL = "false";
  process.env.FRONTEND_URL = "https://qa.example.test/";
  process.env.MANAGED_WALLETS_ENABLED = "true";
  process.env.WALLET_ENCRYPTION_KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString("base64");
  // 1000 wei buffer → lowGas threshold is exactly 50 000 wei.
  process.env.MANAGED_TOPUP_BUFFER_WEI = "1000";
  delete process.env.MANAGED_VIEW_RATE_LIMIT_PER_MIN;
});

import { mountManagedWallets } from "../../src/managed";
import { pools } from "../../src/managed/models/pools";
import { tokens } from "../../src/managed/models/tokens";
import { transfers } from "../../src/managed/models/transfers";
import type { PoolRecord } from "../../src/managed/models/pools";
import type { ManagedWalletRecord } from "../../src/managed/models/wallets";
import { csvCell } from "../../src/managed/service/common";
import { sweep, sweepIdempotencyKey } from "../../src/managed/service/transferService";
import { globalTreasury, poolTreasury } from "../../src/managed/service/treasuryService";
import { exportPoolCsv, getWallet, listWallets } from "../../src/managed/service/walletService";
import type { ManagedToken } from "../../src/managed/types";
import {
  addDeposits,
  addToken,
  addWallets,
  cleanupPools,
  cleanupTokens,
  cleanupUsers,
  createPool,
  probeDb,
  randomAddress,
  rawClient,
  setBalances,
  setMasterBalances,
  txHash,
} from "./helpers/fixtures";

const NET = "bscMainnet" as const;
const HEX64_RE = /[0-9a-f]{64}/i;
const CSV_PREFIX = ["index", "address", "label", "holder_name", "holder_email", "status"];

type FakeUser = Express.User | null;

function buildApp(currentUser: () => FakeUser): express.Express {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use(
    session({
      secret: "n8-test-secret",
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false, httpOnly: true },
    })
  );
  app.use((req, _res, next) => {
    const user = currentUser();
    const r = req as express.Request & { user?: Express.User; isAuthenticated: () => boolean };
    r.user = user ?? undefined;
    r.isAuthenticated = () => user !== null;
    next();
  });
  mountManagedWallets(app);
  app.use((_req, res) => {
    res.status(404).json({ error: "Route not found" });
  });
  return app;
}

const dbAvailable = await probeDb();
if (!dbAvailable) {
  console.warn("[services.test] throwaway database not reachable at localhost:55432 — DB-backed cases are skipped");
}

describe("csvCell (pure)", () => {
  it("neutralises spreadsheet formula prefixes and quotes RFC 4180 specials", () => {
    expect(csvCell("=SUM(A1:A3)")).toBe("'=SUM(A1:A3)");
    expect(csvCell("+1 555")).toBe("'+1 555");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("\tx")).toBe("'\tx");
    expect(csvCell('Doe, "Jane"')).toBe('"Doe, ""Jane"""');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell("=a,b")).toBe("\"'=a,b\"");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(7)).toBe("7");
    expect(csvCell("plain")).toBe("plain");
  });
});

describe.skipIf(!dbAvailable)("services against the throwaway database", () => {
  const client = rawClient();
  const userId = randomUUID();

  let poolA: PoolRecord; // bscMainnet, 3 wallets, all assets
  let poolB: PoolRecord; // bscMainnet, 1 wallet, QT18 only
  let poolC: PoolRecord; // bscTestnet, 1 wallet, balance on QT18's address with NO token row
  let a: ManagedWalletRecord[];
  let b: ManagedWalletRecord[];
  let c: ManagedWalletRecord[];
  let qt18: ManagedToken;
  let qt6: ManagedToken;
  let hidden: ManagedToken;
  let visibleDepositHash = "";

  const WEI = 10n ** 18n;

  beforeAll(async () => {
    for (const key of ENV_KEYS) SAVED_ENV[key] = process.env[key];
    await client.connect();

    qt18 = await addToken(NET, { symbol: "QT18", decimals: 18 });
    qt6 = await addToken(NET, { symbol: "QT6", decimals: 6 });
    hidden = await addToken(NET, { symbol: "QHID", decimals: 18, hidden: true });

    poolA = await createPool({ network: NET, name: "N8 QA pool A" });
    poolB = await createPool({ network: NET, name: "N8 QA pool B" });
    poolC = await createPool({ network: "bscTestnet", name: "N8 QA pool C" });

    a = await addWallets(poolA.id, [
      { label: "=SUM(A1:A3)", holderName: 'Doe, "Jane"', holderEmail: "+1 Jane" },
      { label: "member-2" },
      { label: null, status: "DISABLED" },
    ]);
    b = await addWallets(poolB.id, [{ label: "b-1" }]);
    c = await addWallets(poolC.id, [{ label: "c-1" }]);

    await setBalances([
      { walletId: a[0].id, asset: "native", balanceWei: (15n * WEI) / 10n, blockNumber: 100 },
      { walletId: a[0].id, asset: qt18.tokenAddress, balanceWei: (25n * WEI) / 10n, blockNumber: 100 },
      { walletId: a[0].id, asset: qt6.tokenAddress, balanceWei: 1_250_000n, blockNumber: 100 },
      { walletId: a[0].id, asset: hidden.tokenAddress, balanceWei: 7n * WEI, blockNumber: 100 },
      { walletId: a[1].id, asset: "native", balanceWei: 0n, blockNumber: 100 },
      { walletId: a[1].id, asset: qt18.tokenAddress, balanceWei: WEI / 2n, blockNumber: 100 },
      { walletId: a[2].id, asset: "native", balanceWei: WEI, blockNumber: 100 },
      { walletId: a[2].id, asset: qt18.tokenAddress, balanceWei: 0n, blockNumber: 100 },
      { walletId: a[2].id, asset: hidden.tokenAddress, balanceWei: 2n * WEI, blockNumber: 100 },
      { walletId: b[0].id, asset: qt18.tokenAddress, balanceWei: WEI, blockNumber: 100 },
      { walletId: c[0].id, asset: qt18.tokenAddress, balanceWei: 100_000_000n, blockNumber: 100 },
    ]);
    // Master native just below the lowGas threshold (1000 × 50 = 50 000 wei).
    await setMasterBalances([{ poolId: poolA.id, asset: "native", balanceWei: 49_999n, blockNumber: 1 }]);

    visibleDepositHash = txHash();
    await addDeposits([
      {
        walletId: a[0].id,
        asset: qt18.tokenAddress,
        fromAddress: randomAddress(),
        amountWei: (25n * WEI) / 10n,
        txHash: visibleDepositHash,
        logIndex: 3,
        blockNumber: 90,
        blockTime: new Date("2026-10-21T00:00:00Z"),
      },
      {
        walletId: a[0].id,
        asset: hidden.tokenAddress,
        fromAddress: randomAddress(),
        amountWei: 7n * WEI,
        txHash: txHash(),
        logIndex: 1,
        blockNumber: 91,
        blockTime: new Date("2026-10-21T00:01:00Z"),
      },
      {
        walletId: a[1].id,
        asset: qt18.tokenAddress,
        fromAddress: randomAddress(),
        amountWei: WEI / 2n,
        txHash: txHash(),
        logIndex: 0,
        blockNumber: 92,
        blockTime: null,
      },
    ]);
  });

  afterAll(async () => {
    await cleanupPools(client, [poolA?.id, poolB?.id, poolC?.id].filter(Boolean) as string[]);
    await cleanupTokens(client, [qt18?.id, qt6?.id, hidden?.id].filter(Boolean) as string[]);
    await cleanupUsers(client, [userId]);
    await client.end();
    for (const key of ENV_KEYS) {
      if (SAVED_ENV[key] === undefined) delete process.env[key];
      else process.env[key] = SAVED_ENV[key];
    }
  });

  // ─── Treasury ───────────────────────────────────────────────────────────────

  describe("treasury aggregation", () => {
    it("pool treasury sums per asset, formats by decimals and skips hidden tokens", async () => {
      const t = await poolTreasury(poolA.id);
      expect(t).toMatchObject({
        poolId: poolA.id,
        network: NET,
        masterAddress: poolA.masterAddress,
        walletCount: 3,
      });
      expect(t.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      const byAsset = new Map(t.totals.map((x) => [x.asset, x]));
      expect([...byAsset.keys()].sort()).toEqual(["native", qt18.tokenAddress, qt6.tokenAddress].sort());
      expect(byAsset.get(hidden.tokenAddress)).toBeUndefined();

      expect(byAsset.get("native")).toMatchObject({
        symbol: "BNB",
        name: "BNB",
        decimals: 18,
        totalWei: "2500000000000000000",
        total: "2.5",
        walletsWithBalance: 2,
      });
      expect(byAsset.get(qt18.tokenAddress)).toMatchObject({
        symbol: "QT18",
        decimals: 18,
        totalWei: "3000000000000000000",
        total: "3",
        walletsWithBalance: 2,
      });
      expect(byAsset.get(qt6.tokenAddress)).toMatchObject({
        symbol: "QT6",
        decimals: 6,
        totalWei: "1250000",
        total: "1.25",
        walletsWithBalance: 1,
      });
    });

    it("lowGas flips exactly at MANAGED_TOPUP_BUFFER_WEI × 50", async () => {
      const low = await poolTreasury(poolA.id);
      expect(low.master).toEqual([
        { asset: "native", symbol: "BNB", decimals: 18, balanceWei: "49999", balance: "0.000000000000049999" },
      ]);
      expect(low.lowGas).toBe(true);

      await setMasterBalances([{ poolId: poolA.id, asset: "native", balanceWei: 50_000n, blockNumber: 2 }]);
      const ok = await poolTreasury(poolA.id);
      expect(ok.master[0].balanceWei).toBe("50000");
      expect(ok.lowGas).toBe(false);

      // A pool with no master row at all is low on gas.
      const noMaster = await poolTreasury(poolB.id);
      expect(noMaster.master).toEqual([]);
      expect(noMaster.lowGas).toBe(true);
    });

    it("master balances skip hidden tokens too", async () => {
      await setMasterBalances([
        { poolId: poolA.id, asset: hidden.tokenAddress, balanceWei: 9n * WEI, blockNumber: 2 },
        { poolId: poolA.id, asset: qt6.tokenAddress, balanceWei: 2_000_000n, blockNumber: 2 },
      ]);
      const t = await poolTreasury(poolA.id);
      expect(t.master.map((m) => m.asset).sort()).toEqual(["native", qt6.tokenAddress].sort());
      expect(t.master.find((m) => m.asset === qt6.tokenAddress)).toMatchObject({ symbol: "QT6", balance: "2" });
    });

    it("global treasury aggregates across pools and keys token metadata per network", async () => {
      const g = await globalTreasury();
      expect(g.poolCount).toBeGreaterThanOrEqual(3);
      expect(g.walletCount).toBeGreaterThanOrEqual(5);

      const byPool = new Map(g.byPool.map((p) => [p.poolId, p]));
      expect(byPool.get(poolA.id)?.totals.find((x) => x.asset === qt18.tokenAddress)).toMatchObject({
        symbol: "QT18",
        total: "3",
      });
      expect(byPool.get(poolB.id)?.totals).toEqual([
        expect.objectContaining({ asset: qt18.tokenAddress, symbol: "QT18", total: "1", walletsWithBalance: 1 }),
      ]);
      expect(byPool.get(poolB.id)?.walletCount).toBe(1);
      expect(byPool.get(poolA.id)?.totals.some((x) => x.asset === hidden.tokenAddress)).toBe(false);

      // Same address on bscTestnet has no token row there → UNKNOWN / 18, not QT18.
      expect(byPool.get(poolC.id)?.totals).toEqual([
        expect.objectContaining({
          asset: qt18.tokenAddress,
          symbol: "UNKNOWN",
          decimals: 18,
          totalWei: "100000000",
          total: "0.0000000001",
        }),
      ]);

      const mainnet = g.totalsByNetwork.find((n) => n.network === NET);
      expect(mainnet).toBeDefined();
      expect(mainnet?.totals.find((x) => x.asset === qt18.tokenAddress)).toMatchObject({
        symbol: "QT18",
        totalWei: "4000000000000000000",
        total: "4",
        walletsWithBalance: 3,
      });
      expect(mainnet?.totals.some((x) => x.asset === hidden.tokenAddress)).toBe(false);

      const testnet = g.totalsByNetwork.find((n) => n.network === "bscTestnet");
      expect(testnet?.totals.find((x) => x.asset === qt18.tokenAddress)).toMatchObject({
        symbol: "UNKNOWN",
        totalWei: "100000000",
      });
    });
  });

  // ─── CSV export ─────────────────────────────────────────────────────────────

  describe("CSV export", () => {
    it("has exactly the documented header, neutralised formulas and no secret in any cell", async () => {
      const visible = (await tokens.listByNetwork(NET, false)).map((t) => t.symbol);
      expect(visible).toContain("QT18");
      expect(visible).toContain("QT6");
      expect(visible).not.toContain("QHID");

      const { filename, csv } = await exportPoolCsv(userId, poolA.id);
      expect(filename).toBe(`pool-${poolA.id}.csv`);
      expect(csv.endsWith("\r\n")).toBe(true);

      const lines = csv.split("\r\n").filter((l) => l.length > 0);
      expect(lines).toHaveLength(4);
      expect(lines[0]).toBe([...CSV_PREFIX, "BNB", ...visible].join(","));

      const amounts = (perSymbol: Record<string, string>) =>
        ["BNB", ...visible].map((s) => perSymbol[s] ?? "0").join(",");
      expect(lines[1]).toBe(
        `1,${a[0].address},'=SUM(A1:A3),"Doe, ""Jane""",'+1 Jane,ACTIVE,${amounts({ BNB: "1.5", QT18: "2.5", QT6: "1.25" })}`
      );
      expect(lines[2]).toBe(`2,${a[1].address},member-2,,,ACTIVE,${amounts({ QT18: "0.5" })}`);
      expect(lines[3]).toBe(`3,${a[2].address},,,,DISABLED,${amounts({ BNB: "1" })}`);

      const cells = lines.flatMap((l) => l.split(","));
      for (const cell of cells) expect(cell).not.toMatch(HEX64_RE);
      for (const w of a) expect(csv).not.toContain(w.viewToken);
      expect(csv.toLowerCase()).not.toMatch(/mnemonic|ciphertext|private|view_token|viewtoken/);
      expect(csv).not.toContain(hidden.tokenAddress);
      expect(csv).not.toContain("QHID");
      // No cell starts with a formula trigger.
      for (const cell of cells) expect(cell).not.toMatch(/^[=+\-@]/);
    });

    it("writes an EXPORT_DOWNLOADED audit with the acting user id", async () => {
      const rows = await client.query(
        `SELECT user_id, details FROM managed_audits
         WHERE pool_id = $1 AND action = 'EXPORT_DOWNLOADED' ORDER BY created_at DESC LIMIT 1`,
        [poolA.id]
      );
      expect(rows.rows[0]?.user_id).toBe(userId);
      expect(rows.rows[0]?.details).toMatchObject({ wallets: 3 });
      expect(rows.rows[0]?.details.assets).toContain("QT18");
      expect(rows.rows[0]?.details.assets).not.toContain("QHID");
    });
  });

  // ─── Wallet list / detail shape ─────────────────────────────────────────────

  describe("wallet list and detail shape", () => {
    it("list items carry neither viewUrl nor viewToken (SR-04) and omit hidden tokens", async () => {
      const page = await listWallets(poolA.id, {});
      expect(page.total).toBe(3);
      for (const item of page.wallets) {
        expect(item).not.toHaveProperty("viewToken");
        expect(item).not.toHaveProperty("viewUrl");
        expect(JSON.stringify(item)).not.toMatch(HEX64_RE);
      }
      const first = page.wallets.find((w) => w.id === a[0].id);
      expect(first?.balances[0].symbol).toBe("BNB");
      expect(first?.balances.map((x) => x.symbol).sort()).toEqual(["BNB", "QT18", "QT6"]);
      expect(first?.balances.every((x) => x.hidden === false)).toBe(true);
      expect(first?.balances.find((x) => x.symbol === "QT6")?.balance).toBe("1.25");
    });

    it("detail includes viewToken + viewUrl (admin only)", async () => {
      const { wallet } = await getWallet(a[0].id);
      expect(wallet.viewToken).toBe(a[0].viewToken);
      expect(wallet.viewUrl).toBe(`https://qa.example.test/w/${a[0].viewToken}`);
      expect(wallet.deposits.map((d) => d.symbol).sort()).toEqual(["QHID", "QT18"]);
      // native first, then visible tokens ordered by address (random here) → compare as sets.
      expect(wallet.balances[0].symbol).toBe("BNB");
      expect(wallet.balances.map((x) => x.symbol).sort()).toEqual(["BNB", "QT18", "QT6"]);
    });

    it("GET /pools/:id/wallets over HTTP carries no viewUrl, no viewToken and no token value (SR-04)", async () => {
      const admin: Express.User = { _id: userId, email: "n8@example.test", name: "N8", role: "ADMIN" };
      const res = await request(buildApp(() => admin)).get(`/api/admin/managed/pools/${poolA.id}/wallets?limit=10`);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(3);
      for (const w of a) expect(res.text).not.toContain(w.viewToken);
      expect(res.text).not.toContain('"viewToken"');
      expect(res.text).not.toContain('"viewUrl"');
      expect(res.text).not.toMatch(HEX64_RE);
    });

    it("GET /wallets/:id over HTTP is the only list/detail route that returns viewToken and viewUrl", async () => {
      const admin: Express.User = { _id: userId, email: "n8@example.test", name: "N8", role: "ADMIN" };
      const res = await request(buildApp(() => admin)).get(`/api/admin/managed/wallets/${a[0].id}`);
      expect(res.status).toBe(200);
      expect(res.body.wallet.viewToken).toBe(a[0].viewToken);
      expect(res.body.wallet.viewUrl).toBe(`https://qa.example.test/w/${a[0].viewToken}`);
    });
  });

  // ─── Public view ────────────────────────────────────────────────────────────

  describe("public view shape", () => {
    it("returns only the documented keys and nothing about the pool or other wallets", async () => {
      const res = await request(buildApp(() => null)).get(`/api/view/${a[0].viewToken}`);
      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(Object.keys(res.body).sort()).toEqual(
        ["address", "deposits", "label", "native", "network", "tokens", "updatedAt"].sort()
      );
      expect(res.body).toMatchObject({
        label: "=SUM(A1:A3)",
        address: a[0].address,
        network: NET,
        native: { symbol: "BNB", balanceWei: "1500000000000000000", balance: "1.5" },
      });

      const tokenAddrs = res.body.tokens.map((t: { tokenAddress: string }) => t.tokenAddress).sort();
      expect(tokenAddrs).toEqual([qt18.tokenAddress, qt6.tokenAddress].sort());
      expect(res.body.tokens.find((t: { symbol: string }) => t.symbol === "QT6")).toMatchObject({
        decimals: 6,
        balanceWei: "1250000",
        balance: "1.25",
      });

      expect(res.body.deposits).toHaveLength(1);
      expect(res.body.deposits[0]).toMatchObject({
        txHash: visibleDepositHash,
        asset: qt18.tokenAddress,
        symbol: "QT18",
        amount: "2.5",
        blockNumber: 90,
        explorerUrl: `https://bscscan.com/tx/${visibleDepositHash}`,
      });
      expect(Object.keys(res.body.deposits[0]).sort()).toEqual(
        ["amount", "amountWei", "asset", "blockNumber", "blockTime", "decimals", "explorerUrl", "from", "symbol", "txHash"].sort()
      );

      const text = res.text;
      expect(text).not.toContain(poolA.id);
      expect(text).not.toContain("N8 QA pool A");
      expect(text).not.toContain(poolA.masterAddress);
      expect(text).not.toContain(a[1].address);
      expect(text).not.toContain(a[2].address);
      expect(text).not.toContain(hidden.tokenAddress);
      expect(text).not.toContain("QHID");
      expect(text).not.toContain(a[0].viewToken);
      expect(text).not.toMatch(/derivationIndex|poolId|holder|viewToken|viewUrl|status/);
    });

    it("404 for a DISABLED wallet", async () => {
      const res = await request(buildApp(() => null)).get(`/api/view/${a[2].viewToken}`);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Not found" });
    });

    it("404 for a wallet whose pool is ARCHIVED", async () => {
      const ok = await request(buildApp(() => null)).get(`/api/view/${b[0].viewToken}`);
      expect(ok.status).toBe(200);
      await pools.archive(poolB.id);
      try {
        const gone = await request(buildApp(() => null)).get(`/api/view/${b[0].viewToken}`);
        expect(gone.status).toBe(404);
      } finally {
        await pools.update(poolB.id, { status: "ACTIVE" });
      }
    });
  });

  // ─── Sweep enumeration ──────────────────────────────────────────────────────

  describe("sweep enumeration", () => {
    const key = `n8-sweep-${randomUUID()}`;
    let batchId = "";

    it('"ALL"/"ALL" enumerates non-zero balances of ACTIVE wallets on visible assets only', async () => {
      const visibleAssets = 1 + (await tokens.listByNetwork(NET, false)).length;
      const res = await sweep(userId, { poolId: poolA.id, walletIds: "ALL", assets: "ALL", idempotencyKey: key });
      batchId = res.batchId;
      expect(res.jobs).toBe(4);
      expect(res.skipped).toBe(3 * visibleAssets - 4);

      const { jobs, total } = await transfers.list({ batchId, limit: 50 });
      expect(total).toBe(4);
      const pairs = jobs.map((j) => `${j.walletId}:${j.asset}`).sort();
      expect(pairs).toEqual(
        [
          `${a[0].id}:native`,
          `${a[0].id}:${qt18.tokenAddress}`,
          `${a[0].id}:${qt6.tokenAddress}`,
          `${a[1].id}:${qt18.tokenAddress}`,
        ].sort()
      );
      for (const j of jobs) {
        expect(j).toMatchObject({
          poolId: poolA.id,
          batchId,
          toAddress: poolA.masterAddress,
          sweepAll: true,
          amountWei: "0",
          status: "PENDING",
          attempts: 0,
          requestedBy: userId,
        });
        expect(j.asset).not.toBe(hidden.tokenAddress);
        expect(j.walletId).not.toBe(a[2].id);
      }
    });

    it("repeating the idempotency key creates no new jobs", async () => {
      const again = await sweep(userId, { poolId: poolA.id, walletIds: "ALL", assets: "ALL", idempotencyKey: key });
      expect(again.jobs).toBe(0);
      const count = await client.query("SELECT COUNT(*)::int AS n FROM managed_transfers WHERE pool_id = $1", [poolA.id]);
      expect(count.rows[0].n).toBe(4);
    });

    it("explicit walletIds and assets narrow the universe; DISABLED wallets stay excluded", async () => {
      const onlyNative = await sweep(userId, {
        poolId: poolA.id,
        walletIds: "ALL",
        assets: ["native"],
        idempotencyKey: `${key}-native`,
      });
      expect(onlyNative.jobs).toBe(1); // a[0] native; a[2] has native but is DISABLED
      expect(onlyNative.skipped).toBe(3 * 1 - 1);

      const disabledOnly = await sweep(userId, {
        poolId: poolA.id,
        walletIds: [a[2].id],
        assets: "ALL",
        idempotencyKey: `${key}-disabled`,
      });
      expect(disabledOnly.jobs).toBe(0);

      const hiddenOnly = await sweep(userId, {
        poolId: poolA.id,
        walletIds: [a[0].id],
        assets: [hidden.tokenAddress],
        idempotencyKey: `${key}-hidden`,
      });
      expect(hiddenOnly.jobs).toBe(0);
      expect(hiddenOnly.skipped).toBe(1);

      const custom = randomAddress();
      const toCustom = await sweep(userId, {
        poolId: poolA.id,
        walletIds: [a[1].id],
        assets: [qt18.tokenAddress],
        toAddress: custom,
        idempotencyKey: `${key}-custom`,
      });
      expect(toCustom.jobs).toBe(1);
      // Stored sweep keys are user-scoped: `${userId}:${clientKey}:${walletId}:${asset}`.
      const job = await transfers.findByIdempotencyKey(sweepIdempotencyKey(userId, `${key}-custom`, a[1].id, qt18.tokenAddress));
      expect(job?.toAddress).toBe(custom);
    });

    it("records SWEEP_REQUESTED audits with the acting user id", async () => {
      const rows = await client.query(
        `SELECT user_id, details FROM managed_audits WHERE pool_id = $1 AND action = 'SWEEP_REQUESTED'`,
        [poolA.id]
      );
      expect(rows.rows.length).toBeGreaterThanOrEqual(5);
      expect(rows.rows.every((r) => r.user_id === userId)).toBe(true);
      expect(rows.rows.some((r) => r.details.batchId === batchId && r.details.jobs === 4)).toBe(true);
    });

    it("refuses an ARCHIVED pool with 409 POOL_ARCHIVED", async () => {
      await pools.archive(poolB.id);
      try {
        await expect(
          sweep(userId, { poolId: poolB.id, walletIds: "ALL", assets: "ALL", idempotencyKey: `${key}-archived` })
        ).rejects.toMatchObject({ status: 409, code: "POOL_ARCHIVED" });
      } finally {
        await pools.update(poolB.id, { status: "ACTIVE" });
      }
    });

    it("rejects malformed selections with 400 VALIDATION", async () => {
      await expect(
        sweep(userId, { poolId: poolA.id, walletIds: [], assets: "ALL", idempotencyKey: `${key}-bad` })
      ).rejects.toMatchObject({ status: 400, code: "VALIDATION" });
      await expect(
        sweep(userId, {
          poolId: poolA.id,
          walletIds: "ALL",
          assets: "ALL",
          idempotencyKey: `${key}-bad2`,
          toAddress: "0xnot-an-address",
        })
      ).rejects.toMatchObject({ status: 400, code: "VALIDATION" });
      await expect(
        sweep(userId, { poolId: randomUUID(), walletIds: "ALL", assets: "ALL", idempotencyKey: `${key}-missing` })
      ).rejects.toMatchObject({ status: 404, code: "POOL_NOT_FOUND" });
    });
  });

  it("pool records never carry the ciphertext columns", async () => {
    const rec = await pools.findById(poolA.id);
    expect(rec).not.toBeNull();
    expect(Object.keys(rec ?? {}).join(",").toLowerCase()).not.toMatch(/ciphertext|mnemonic_iv|mnemonic_tag|mnemonicciphertext/);
  });
});
