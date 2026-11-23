/**
 * Client-side signing helpers for browser-wallet mode.
 *
 * Everything here signs with the user's connected wallet (ethers
 * BrowserProvider). No private key ever enters this module — the wallet
 * extension does the signing, we only build transactions.
 */
import { BrowserProvider, Contract, ContractFactory, formatEther, formatUnits, parseUnits } from "ethers";
import { api } from "./api";

export interface DeployResult {
  address: string;
  txHash: string;
}

export interface DeployOptions {
  /** Optional explicit gas price in gwei; omit to use the wallet's fee data. */
  gasPriceGwei?: string;
}

/** Fetch the compiled MultiSender ABI + bytecode from the backend. */
export async function fetchMultisenderArtifact(): Promise<{ abi: unknown[]; bytecode: string }> {
  const { data } = await api.get<{ contractName: string; abi: unknown[]; bytecode: string }>(
    "/api/contracts/multisender-artifact"
  );
  return { abi: data.abi, bytecode: data.bytecode };
}

/**
 * Deploy MultiSender from the connected wallet, client-side.
 * The connected wallet becomes the contract owner — which is exactly what
 * wallet-mode distribution needs.
 */
export async function deployMultisenderClientSide(
  provider: BrowserProvider,
  network: "bscMainnet" | "bscTestnet",
  options: DeployOptions = {}
): Promise<DeployResult> {
  const signer = await provider.getSigner();
  const { abi, bytecode } = await fetchMultisenderArtifact();

  const factory = new ContractFactory(abi as [], bytecode, signer);

  const deployTx = await factory.getDeployTransaction();
  const feeData = await provider.getFeeData();
  const gasPrice = options.gasPriceGwei
    ? parseUnits(options.gasPriceGwei, "gwei")
    : (feeData.gasPrice ?? parseUnits("1", "gwei")); // sane fallback: 1 gwei

  // Send the deployment with explicit gas pricing (BSC legacy-style txs).
  const tx = await signer.sendTransaction({
    data: deployTx.data,
    gasPrice,
  });

  const receipt = await tx.wait(1);
  if (!receipt?.contractAddress) {
    throw new Error("Deployment transaction confirmed but no contract address returned");
  }

  return { address: receipt.contractAddress, txHash: receipt.hash };
}

const MULTISENDER_ABI_MIN = [
  "function owner() view returns (address)",
  "function isClaimed(uint256) view returns (bool)",
  "function multisend(address token, uint32[] indices, bytes32[] packed)",
];

/**
 * Read the MultiSender owner. Used as an ownership guard before wallet-mode
 * distribution: the connected wallet must be the contract owner or every
 * multisend() call will revert.
 */
export async function getMultisenderOwner(
  provider: BrowserProvider,
  multisenderAddress: string
): Promise<string | null> {
  try {
    const contract = new Contract(multisenderAddress, MULTISENDER_ABI_MIN, provider);
    return (await contract.owner()) as string;
  } catch {
    return null;
  }
}

/** Read the connected wallet's BNB balance (human-readable). */
export async function getConnectedBnbBalance(
  provider: BrowserProvider,
  address: string
): Promise<string> {
  const wei = await provider.getBalance(address);
  return formatEther(wei);
}

/** Read an ERC-20 balance for the connected address (human-readable). */
export async function getConnectedTokenBalance(
  provider: BrowserProvider,
  tokenAddress: string,
  userAddress: string
): Promise<{ symbol: string; balance: string; decimals: number } | null> {
  try {
    const erc20 = new Contract(
      tokenAddress,
      ["function symbol() view returns (string)", "function decimals() view returns (uint8)", "function balanceOf(address) view returns (uint256)"],
      provider
    );
    const [symbol, decimals, balance] = await Promise.all([
      erc20.symbol(),
      erc20.decimals(),
      erc20.balanceOf(userAddress),
    ]);
    return { symbol: String(symbol), decimals: Number(decimals), balance: formatUnits(balance, Number(decimals)) };
  } catch {
    return null;
  }
}
