import { describe, expect, it } from "vitest";
import { Interface, parseUnits } from "ethers";
import {
  buildTransferTx,
  estimateInputsFor,
  masterReserveFor,
  plan,
  withGasMargin,
  TOPUP_GAS_LIMIT,
} from "../../src/managed/chain/transferPlanner";
import type { PlanInput } from "../../src/managed/chain/transferPlanner";
import { NATIVE_ASSET } from "../../src/managed/types";
import type { PlanRejectionCode } from "../../src/managed/types";

const CHILD = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const MASTER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const DEST = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const TOKEN = "0x1111111111111111111111111111111111111111";

const GAS_PRICE = parseUnits("0.1", "gwei"); // 100_000_000 wei
const BUFFER = 100_000_000_000_000n; // 0.0001 BNB
const MAX_GAS = 300_000n;
const RESERVE = masterReserveFor(GAS_PRICE, BUFFER);

function base(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    childAddress: CHILD,
    masterAddress: MASTER,
    toAddress: DEST,
    asset: TOKEN,
    amountWei: parseUnits("10", 18),
    sweepAll: false,
    childNativeWei: 0n,
    childAssetWei: parseUnits("100", 18),
    masterNativeWei: parseUnits("1", 18),
    gasLimitEstimate: 50_000n,
    gasPriceWei: GAS_PRICE,
    maxGasLimit: MAX_GAS,
    topUpBufferWei: BUFFER,
    masterReserveWei: RESERVE,
    ...overrides,
  };
}

const erc20 = new Interface(["function transfer(address to, uint256 amount) returns (bool)"]);

describe("transferPlanner.plan — accepted plans", () => {
  it("token with zero BNB: top-up equals gasCost + buffer, two txs", () => {
    const input = base({ childNativeWei: 0n, gasLimitEstimate: 50_000n });
    const result = plan(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const gasLimit = withGasMargin(50_000n); // 60000
    expect(result.gasLimit).toBe("60000");
    const gasCost = gasLimit * GAS_PRICE;
    expect(result.gasCostWei).toBe(gasCost.toString());
    expect(result.topUpWei).toBe((gasCost + BUFFER).toString());
    expect(result.amountWei).toBe(parseUnits("10", 18).toString());
    expect(result.txs).toHaveLength(2);
    expect(result.txs[0]).toEqual({
      kind: "topup",
      from: MASTER,
      to: CHILD,
      valueWei: (gasCost + BUFFER).toString(),
    });
    expect(result.txs[1].kind).toBe("transfer");
    expect(result.txs[1].from).toBe(CHILD);
    expect(result.txs[1].to).toBe(TOKEN);
    expect(result.txs[1].valueWei).toBe("0");
    expect(result.txs[1].data).toBe(erc20.encodeFunctionData("transfer", [DEST, parseUnits("10", 18)]));
  });

  it("token with partial BNB: top-up covers only the shortfall plus buffer", () => {
    const gasCost = withGasMargin(50_000n) * GAS_PRICE;
    const childNative = gasCost / 2n;
    const result = plan(base({ childNativeWei: childNative }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(BigInt(result.topUpWei)).toBe(gasCost - childNative + BUFFER);
  });

  it("token with enough BNB: no top-up, single tx", () => {
    const result = plan(base({ childNativeWei: parseUnits("0.01", 18) }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.topUpWei).toBe("0");
    expect(result.txs).toHaveLength(1);
    expect(result.txs[0].kind).toBe("transfer");
  });

  it("token sweep-all sends the full token balance", () => {
    const result = plan(base({ sweepAll: true, amountWei: undefined, childNativeWei: parseUnits("0.01", 18) }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.amountWei).toBe(parseUnits("100", 18).toString());
  });

  it("native sweep-all: amount = childNative − gasCost, never a top-up", () => {
    const childNative = parseUnits("0.5", 18);
    const result = plan(
      base({
        asset: NATIVE_ASSET,
        sweepAll: true,
        amountWei: undefined,
        childNativeWei: childNative,
        childAssetWei: childNative,
        gasLimitEstimate: 21_000n,
        masterNativeWei: 0n, // master balance is irrelevant for native
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const gasLimit = withGasMargin(21_000n); // 25200
    expect(result.gasLimit).toBe(gasLimit.toString());
    const gasCost = gasLimit * GAS_PRICE;
    expect(result.amountWei).toBe((childNative - gasCost).toString());
    expect(result.topUpWei).toBe("0");
    expect(result.txs).toHaveLength(1);
    expect(result.txs[0]).toEqual({
      kind: "transfer",
      from: CHILD,
      to: DEST,
      valueWei: (childNative - gasCost).toString(),
    });
  });

  it("native explicit amount within balance is accepted with no top-up even when BNB is scarce", () => {
    const gasCost = withGasMargin(21_000n) * GAS_PRICE;
    const amount = 1_000n;
    const result = plan(
      base({
        asset: NATIVE_ASSET,
        amountWei: amount,
        childNativeWei: amount + gasCost, // exactly enough
        gasLimitEstimate: 21_000n,
        masterNativeWei: 0n,
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.topUpWei).toBe("0");
    expect(result.amountWei).toBe(amount.toString());
  });

  it("gas margin is capped by maxGasLimit when the estimate itself fits", () => {
    const result = plan(base({ gasLimitEstimate: 280_000n, childNativeWei: parseUnits("1", 18) }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.gasLimit).toBe(MAX_GAS.toString()); // 336000 capped to 300000
  });

  it("echoes child and master balances as strings", () => {
    const result = plan(base({ childNativeWei: 5n, masterNativeWei: parseUnits("2", 18) }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.childNativeWei).toBe("5");
    expect(result.masterNativeWei).toBe(parseUnits("2", 18).toString());
    expect(result.gasPriceWei).toBe(GAS_PRICE.toString());
  });
});

describe("transferPlanner.plan — rejections", () => {
  const cases: Array<{ name: string; input: PlanInput; code: PlanRejectionCode }> = [
    {
      name: "master short of BNB for the top-up",
      input: base({ childNativeWei: 0n, masterNativeWei: RESERVE }), // reserve only, no room for topUp
      code: "MASTER_INSUFFICIENT_BNB",
    },
    {
      name: "master has topUp but not the reserve",
      input: base({
        childNativeWei: 0n,
        masterNativeWei: withGasMargin(50_000n) * GAS_PRICE + BUFFER, // exactly topUp, no reserve
      }),
      code: "MASTER_INSUFFICIENT_BNB",
    },
    {
      name: "native amount too high",
      input: base({
        asset: NATIVE_ASSET,
        amountWei: parseUnits("1", 18),
        childNativeWei: parseUnits("1", 18), // no room for gas
        gasLimitEstimate: 21_000n,
      }),
      code: "INSUFFICIENT_NATIVE_FOR_AMOUNT",
    },
    {
      name: "native never tops up: zero BNB with explicit amount is rejected, not funded",
      input: base({
        asset: NATIVE_ASSET,
        amountWei: 1n,
        childNativeWei: 0n,
        masterNativeWei: parseUnits("100", 18),
        gasLimitEstimate: 21_000n,
      }),
      code: "INSUFFICIENT_NATIVE_FOR_AMOUNT",
    },
    {
      name: "native sweep-all with balance <= gas cost",
      input: base({
        asset: NATIVE_ASSET,
        sweepAll: true,
        amountWei: undefined,
        childNativeWei: withGasMargin(21_000n) * GAS_PRICE, // equal to gas cost
        gasLimitEstimate: 21_000n,
      }),
      code: "NOTHING_TO_SWEEP",
    },
    {
      name: "token sweep-all with zero balance",
      input: base({ sweepAll: true, amountWei: undefined, childAssetWei: 0n }),
      code: "NOTHING_TO_SWEEP",
    },
    {
      name: "token amount above balance",
      input: base({ amountWei: parseUnits("101", 18), childAssetWei: parseUnits("100", 18) }),
      code: "INSUFFICIENT_TOKEN_BALANCE",
    },
    {
      name: "token amount of zero",
      input: base({ amountWei: 0n }),
      code: "INSUFFICIENT_TOKEN_BALANCE",
    },
    {
      name: "gas estimate above the cap",
      input: base({ gasLimitEstimate: 300_001n }),
      code: "GAS_LIMIT_EXCEEDED",
    },
    {
      name: "invalid destination string",
      input: base({ toAddress: "not-an-address" }),
      code: "INVALID_DESTINATION",
    },
    {
      name: "destination equals the child (case-insensitive)",
      input: base({ toAddress: CHILD.toLowerCase() }),
      code: "INVALID_DESTINATION",
    },
    {
      name: "destination is the zero address",
      input: base({ toAddress: "0x0000000000000000000000000000000000000000" }),
      code: "INVALID_DESTINATION",
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const result = plan(c.input);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe(c.code);
      expect(result.message.length).toBeGreaterThan(0);
    });
  }

  it("master check uses topUp + reserve exactly (one wei short fails, exact passes)", () => {
    const gasCost = withGasMargin(50_000n) * GAS_PRICE;
    const topUp = gasCost + BUFFER;
    const short = plan(base({ childNativeWei: 0n, masterNativeWei: topUp + RESERVE - 1n }));
    expect(short.ok).toBe(false);
    const exact = plan(base({ childNativeWei: 0n, masterNativeWei: topUp + RESERVE }));
    expect(exact.ok).toBe(true);
  });
});

describe("transferPlanner helpers", () => {
  it("withGasMargin rounds up 1.2×", () => {
    expect(withGasMargin(21_000n)).toBe(25_200n);
    expect(withGasMargin(1n)).toBe(2n);
    expect(withGasMargin(0n)).toBe(0n);
  });

  it("masterReserveFor = 21000 × gasPrice + buffer", () => {
    expect(masterReserveFor(GAS_PRICE, BUFFER)).toBe(TOPUP_GAS_LIMIT * GAS_PRICE + BUFFER);
  });

  it("buildTransferTx shapes native and token transfers", () => {
    expect(buildTransferTx(NATIVE_ASSET, DEST.toLowerCase(), 5n)).toEqual({ to: DEST, valueWei: 5n });
    const token = buildTransferTx(TOKEN, DEST, 7n);
    expect(token.to).toBe(TOKEN);
    expect(token.valueWei).toBe(0n);
    expect(token.data).toBe(erc20.encodeFunctionData("transfer", [DEST, 7n]));
  });

  it("estimateInputsFor uses value 0 for native sweeps and the full balance for token sweeps", () => {
    const native = estimateInputsFor({
      asset: NATIVE_ASSET,
      childAddress: CHILD,
      toAddress: DEST,
      sweepAll: true,
      childAssetWei: 10n,
    });
    expect(native).toEqual({ from: CHILD, to: DEST });

    const token = estimateInputsFor({
      asset: TOKEN,
      childAddress: CHILD,
      toAddress: DEST,
      sweepAll: true,
      childAssetWei: 10n,
    });
    expect(token.from).toBe(CHILD);
    expect(token.to).toBe(TOKEN);
    expect(token.data).toBe(erc20.encodeFunctionData("transfer", [DEST, 10n]));
    expect(token.value).toBeUndefined();

    const nativeAmount = estimateInputsFor({
      asset: NATIVE_ASSET,
      childAddress: CHILD,
      toAddress: DEST,
      amountWei: 3n,
      childAssetWei: 10n,
    });
    expect(nativeAmount.value).toBe(3n);
  });
});
