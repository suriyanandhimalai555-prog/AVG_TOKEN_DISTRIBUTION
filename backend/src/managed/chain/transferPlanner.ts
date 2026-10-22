/**
 * Transfer planner — PURE. No I/O, no env reads, no clock.
 *
 * Implements SPEC §6.5 steps 1–4 exactly:
 *  1. Build the transfer: native → { to, value }; token → { to: token, data: transfer(to, amount) }.
 *  2. gasLimit = ceil(estimate × 1.2), capped by maxGasLimit. If the estimate
 *     itself exceeds the cap → GAS_LIMIT_EXCEEDED. Gas price is given (already
 *     clamped by fees.ts).
 *  3. gasCost = gasLimit × gasPrice.
 *     Token: if childNative < gasCost → topUp = gasCost − childNative + buffer.
 *     Native: amount + gasCost ≤ childNative, sweep-all amount = childNative − gasCost,
 *             never a top-up; childNative ≤ gasCost → NOTHING_TO_SWEEP.
 *  4. topUp > 0 → masterNative ≥ topUp + masterReserve else MASTER_INSUFFICIENT_BNB.
 *
 * The caller (worker / plan endpoint) supplies every number; see `PlanInput`.
 */

import { Interface, getAddress, isAddress, ZeroAddress } from "ethers";
import { NATIVE_ASSET } from "../types";
import type { Asset, PlanRejectionCode, TransferPlan, TransferTxIntent } from "../types";

export const ERC20_TRANSFER_ABI = ["function transfer(address to, uint256 amount) returns (bool)"];
export const erc20TransferInterface = new Interface(ERC20_TRANSFER_ABI);

/** Gas limit of a plain BNB transfer from an EOA to an EOA (the master top-up). */
export const TOPUP_GAS_LIMIT = 21_000n;

/** Conservative fallbacks when estimateGas itself fails (balance checks still run). */
export const FALLBACK_GAS_ESTIMATE_NATIVE = 21_000n;
export const FALLBACK_GAS_ESTIMATE_TOKEN = 100_000n;

export interface PlanInput {
  childAddress: string;
  masterAddress: string;
  toAddress: string;
  /** 'native' or lowercase token address */
  asset: Asset;
  /** Requested amount in wei; ignored when sweepAll is true. */
  amountWei?: bigint;
  sweepAll?: boolean;
  /** Fresh child BNB balance. */
  childNativeWei: bigint;
  /** Fresh child token balance (ignored for native). */
  childAssetWei: bigint;
  /** Fresh master BNB balance. */
  masterNativeWei: bigint;
  /** Raw estimateGas result for the transfer from the child. */
  gasLimitEstimate: bigint;
  /** Already clamped gas price. */
  gasPriceWei: bigint;
  /** MANAGED_MAX_GAS_LIMIT */
  maxGasLimit: bigint;
  /** MANAGED_TOPUP_BUFFER_WEI */
  topUpBufferWei: bigint;
  /** What the master must keep after sending a top-up (see masterReserveFor). */
  masterReserveWei: bigint;
}

export type OkPlan = Extract<TransferPlan, { ok: true }>;
export type RejectedPlan = Extract<TransferPlan, { ok: false }>;

export function isNativeAsset(asset: Asset): boolean {
  return asset.toLowerCase() === NATIVE_ASSET;
}

/** ceil(estimate × 1.2) in integer arithmetic. */
export function withGasMargin(estimate: bigint): bigint {
  return (estimate * 12n + 9n) / 10n;
}

/**
 * Reserve the master must keep when funding a top-up: the gas of the top-up
 * transaction itself plus one buffer. Callers pass the result as
 * `masterReserveWei` (the planner stays pure and does not assume this).
 */
export function masterReserveFor(gasPriceWei: bigint, topUpBufferWei: bigint): bigint {
  return TOPUP_GAS_LIMIT * gasPriceWei + topUpBufferWei;
}

export interface TransferTxShape {
  /** Destination: the token contract for ERC-20, the recipient for native. */
  to: string;
  valueWei: bigint;
  data?: string;
}

/** Step 1: the transaction shape of the transfer (no gas fields). */
export function buildTransferTx(asset: Asset, to: string, amountWei: bigint): TransferTxShape {
  if (isNativeAsset(asset)) {
    return { to: getAddress(to), valueWei: amountWei };
  }
  return {
    to: getAddress(asset),
    valueWei: 0n,
    data: erc20TransferInterface.encodeFunctionData("transfer", [getAddress(to), amountWei]),
  };
}

export interface EstimateRequest {
  from: string;
  to: string;
  data?: string;
  value?: bigint;
}

/**
 * The eth_estimateGas request the worker sends before planning. For sweeps
 * the amount is not final yet (gas is unknown), so a native sweep estimates
 * with value 0 (a plain value transfer costs the same for any value) and a
 * token sweep estimates with the full token balance.
 */
export function estimateInputsFor(args: {
  asset: Asset;
  childAddress: string;
  toAddress: string;
  amountWei?: bigint;
  sweepAll?: boolean;
  childAssetWei: bigint;
}): EstimateRequest {
  const { asset, childAddress, toAddress, sweepAll, childAssetWei } = args;
  const native = isNativeAsset(asset);
  const amount = sweepAll ? (native ? 0n : childAssetWei) : (args.amountWei ?? 0n);
  const shape = buildTransferTx(asset, toAddress, amount);
  const req: EstimateRequest = { from: getAddress(childAddress), to: shape.to };
  if (shape.data) req.data = shape.data;
  if (shape.valueWei > 0n) req.value = shape.valueWei;
  return req;
}

function reject(code: PlanRejectionCode, message: string): RejectedPlan {
  return { ok: false, code, message };
}

/** Steps 1–4 of SPEC §6.5. Pure. */
export function plan(input: PlanInput): TransferPlan {
  const native = isNativeAsset(input.asset);

  // Destination validation.
  if (!isAddress(input.toAddress)) {
    return reject("INVALID_DESTINATION", "Destination is not a valid address");
  }
  const to = getAddress(input.toAddress);
  if (to === ZeroAddress) {
    return reject("INVALID_DESTINATION", "Destination cannot be the zero address");
  }
  if (!isAddress(input.childAddress)) {
    return reject("INVALID_DESTINATION", "Child address is not a valid address");
  }
  const child = getAddress(input.childAddress);
  if (to === child) {
    return reject("INVALID_DESTINATION", "Destination cannot be the wallet itself");
  }
  if (!native && !isAddress(input.asset)) {
    return reject("INVALID_DESTINATION", "Asset is not a valid token address");
  }

  // Step 2: gas limit.
  if (input.gasLimitEstimate < 0n || input.maxGasLimit <= 0n || input.gasPriceWei < 0n) {
    return reject("GAS_LIMIT_EXCEEDED", "Invalid gas parameters");
  }
  if (input.gasLimitEstimate > input.maxGasLimit) {
    return reject(
      "GAS_LIMIT_EXCEEDED",
      `Gas estimate ${input.gasLimitEstimate} exceeds the limit ${input.maxGasLimit}`
    );
  }
  let gasLimit = withGasMargin(input.gasLimitEstimate);
  if (gasLimit > input.maxGasLimit) gasLimit = input.maxGasLimit;

  // Step 3: gas cost and amount / top-up.
  const gasCost = gasLimit * input.gasPriceWei;
  let amount: bigint;
  let topUp = 0n;

  if (native) {
    if (input.sweepAll) {
      if (input.childNativeWei <= gasCost) {
        return reject("NOTHING_TO_SWEEP", "Native balance does not cover the gas cost");
      }
      amount = input.childNativeWei - gasCost;
    } else {
      amount = input.amountWei ?? 0n;
      if (amount <= 0n) {
        return reject("INSUFFICIENT_NATIVE_FOR_AMOUNT", "Amount must be greater than zero");
      }
      if (amount + gasCost > input.childNativeWei) {
        return reject(
          "INSUFFICIENT_NATIVE_FOR_AMOUNT",
          "Amount plus gas cost exceeds the wallet's BNB balance"
        );
      }
    }
    // Never a top-up for native.
  } else {
    if (input.sweepAll) {
      amount = input.childAssetWei;
      if (amount <= 0n) {
        return reject("NOTHING_TO_SWEEP", "Token balance is zero");
      }
    } else {
      amount = input.amountWei ?? 0n;
      if (amount <= 0n) {
        return reject("INSUFFICIENT_TOKEN_BALANCE", "Amount must be greater than zero");
      }
      if (amount > input.childAssetWei) {
        return reject("INSUFFICIENT_TOKEN_BALANCE", "Amount exceeds the wallet's token balance");
      }
    }
    if (input.childNativeWei < gasCost) {
      topUp = gasCost - input.childNativeWei + input.topUpBufferWei;
    }
  }

  // Step 4: master check.
  if (topUp > 0n && input.masterNativeWei < topUp + input.masterReserveWei) {
    return reject(
      "MASTER_INSUFFICIENT_BNB",
      `Master needs ${topUp + input.masterReserveWei} wei of BNB for the gas top-up but has ${input.masterNativeWei}`
    );
  }

  const master = getAddress(input.masterAddress);
  const shape = buildTransferTx(input.asset, to, amount);
  const txs: TransferTxIntent[] = [];
  if (topUp > 0n) {
    txs.push({ kind: "topup", from: master, to: child, valueWei: topUp.toString() });
  }
  const transfer: TransferTxIntent = {
    kind: "transfer",
    from: child,
    to: shape.to,
    valueWei: shape.valueWei.toString(),
  };
  if (shape.data) transfer.data = shape.data;
  txs.push(transfer);

  return {
    ok: true,
    gasLimit: gasLimit.toString(),
    gasPriceWei: input.gasPriceWei.toString(),
    gasCostWei: gasCost.toString(),
    topUpWei: topUp.toString(),
    amountWei: amount.toString(),
    childNativeWei: input.childNativeWei.toString(),
    masterNativeWei: input.masterNativeWei.toString(),
    txs,
  };
}
