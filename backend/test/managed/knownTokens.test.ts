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
