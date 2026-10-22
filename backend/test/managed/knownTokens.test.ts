import { ethers } from "ethers";
import { describe, expect, it, vi } from "vitest";

const { seedTracked } = vi.hoisted(() => ({ seedTracked: vi.fn() }));
vi.mock("../../src/managed/models/tokens", () => ({ tokens: { seedTracked } }));

import { KNOWN_TOKENS } from "../../src/managed/chain/knownTokens";
import { seedKnownTokens } from "../../src/managed/service/knownTokenService";

describe("known-token catalog", () => {
  it.each(Object.entries(KNOWN_TOKENS))("%s entries are checksummed, unique and sane", (_network, list) => {
    expect(list.length).toBeGreaterThan(0);
    const addrs = new Set<string>();
    const symbols = new Set<string>();
    for (const t of list) {
      expect(ethers.getAddress(t.address)).toBe(t.address);
      expect(t.decimals).toBeGreaterThanOrEqual(0);
      expect(t.decimals).toBeLessThanOrEqual(36);
      expect(t.symbol.trim()).toBe(t.symbol);
      addrs.add(t.address.toLowerCase());
      symbols.add(t.symbol.toUpperCase());
    }
    expect(addrs.size).toBe(list.length);
    expect(symbols.size).toBe(list.length);
  });

  it("covers the major stablecoins on mainnet, and DOGE keeps its 8 decimals", () => {
    const main = new Map(KNOWN_TOKENS.bscMainnet.map((t) => [t.symbol, t]));
    for (const s of ["USDT", "USDC", "BUSD", "DAI", "WBNB", "ETH", "BTCB"]) expect(main.has(s)).toBe(true);
    expect(main.get("DOGE")?.decimals).toBe(8);
  });
});

describe("seedKnownTokens", () => {
  it("seeds every catalog entry for every network with lowercase-safe input", async () => {
    seedTracked.mockResolvedValueOnce(19);
    const created = await seedKnownTokens();
    expect(created).toBe(19);
    const arg = seedTracked.mock.calls[0][0] as Array<{ network: string; tokenAddress: string }>;
    const total = KNOWN_TOKENS.bscMainnet.length + KNOWN_TOKENS.bscTestnet.length;
    expect(arg).toHaveLength(total);
    expect(new Set(arg.map((t) => t.network))).toEqual(new Set(["bscMainnet", "bscTestnet"]));
  });

  it("never throws when the tables are not migrated", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    seedTracked.mockRejectedValueOnce(Object.assign(new Error("relation does not exist"), { code: "42P01" }));
    await expect(seedKnownTokens()).resolves.toBe(0);
    vi.restoreAllMocks();
  });
});

describe("AVG Coin (client's preferred token)", () => {
  it("is on mainnet with the verified address, 18 decimals, and marked preferred", () => {
    const avg = KNOWN_TOKENS.bscMainnet.find((t) => t.symbol === "AVG");
    expect(avg).toEqual({
      address: "0x9D7435abdB6478198C730Ed7f4AE503e51799B8b",
      symbol: "AVG",
      name: "AVG Coin",
      decimals: 18,
      preferred: true,
    });
    expect(KNOWN_TOKENS.bscTestnet.some((t) => t.symbol === "AVG")).toBe(false);
  });

  it("is the only preferred token", () => {
    const all = [...KNOWN_TOKENS.bscMainnet, ...KNOWN_TOKENS.bscTestnet];
    expect(all.filter((t) => t.preferred).map((t) => t.symbol)).toEqual(["AVG"]);
  });
});

describe("frontend logo map stays in sync with the catalog", () => {
  it("every catalog address has a logo and the logo file exists", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const root = path.resolve(__dirname, "../../../frontend");
    const src = fs.readFileSync(path.join(root, "src/components/managed/TokenIcon.tsx"), "utf8");
    for (const t of [...KNOWN_TOKENS.bscMainnet, ...KNOWN_TOKENS.bscTestnet]) {
      const m = new RegExp(`"${t.address.toLowerCase()}":\\s*"([a-z0-9-]+)"`).exec(src);
      expect(m, `no logo mapping for ${t.symbol} ${t.address}`).not.toBeNull();
      expect(fs.existsSync(path.join(root, "public/token-icons", `${m![1]}.png`)), `missing file for ${t.symbol}`).toBe(true);
    }
  });
});
