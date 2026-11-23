import { Router, Request, Response } from "express";
import { ethers } from "ethers";
import { requireAuth } from "../middleware/requireAuth";
import { requirePlan } from "../middleware/requirePlan";

const router = Router();

const ERC20_ABI = [
  "function name() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

type Network = "bscMainnet" | "bscTestnet";

function resolveMainnetRpcUrl(): string {
  return (
    process.env.ALCHEMY_RPC_URL ||
    process.env.FALLBACK_RPC_1 ||
    process.env.FALLBACK_RPC_2 ||
    ""
  );
}

function resolveTestnetRpcUrl(): string {
  return (
    process.env.BSC_TESTNET_RPC_URL ||
    ""
  );
}

/**
 * Read-only wallet preview for a given ADDRESS (no key material).
 * Shared by /preview (legacy, pk-derived address) and /preview-address
 * (browser-wallet mode, address supplied by the connected wallet).
 */
async function buildPreview(account: string, tokenAddress: string, network: Network) {
  const mainnetRpcUrl = resolveMainnetRpcUrl();
  if (!mainnetRpcUrl) return { error: "Mainnet RPC URL missing in backend .env" as const };

  const testnetRpcUrl = resolveTestnetRpcUrl();
  const mainnetProvider = new ethers.JsonRpcProvider(mainnetRpcUrl);

  const bnbWei = await mainnetProvider.getBalance(account);
  const bnbBalance = ethers.formatEther(bnbWei);
  let tBnbBalance = "0";
  if (testnetRpcUrl) {
    try {
      const testnetProvider = new ethers.JsonRpcProvider(testnetRpcUrl);
      const tBnbWei = await testnetProvider.getBalance(account);
      tBnbBalance = ethers.formatEther(tBnbWei);
    } catch {
      // keep default 0 if testnet RPC is temporarily unavailable
    }
  }

  let tokenData:
    | {
        address: string;
        name: string;
        symbol: string;
        decimals: number;
        balance: string;
      }
    | undefined;
  let tokenError: string | undefined;
  let tokenOnSelectedNetwork = false;
  let tokenOnSelectedNetworkError: string | undefined;

  try {
    // Token metadata/balance are intentionally fetched from MAINNET
    // so known mainnet token addresses (e.g., NOVA) still resolve
    // even when user selects testnet for sending route.
    const token = new ethers.Contract(tokenAddress, ERC20_ABI, mainnetProvider);
    const [nameRaw, decimalsRaw, symbolRaw, tokenBalRaw] = await Promise.all([
      token.name(),
      token.decimals(),
      token.symbol(),
      token.balanceOf(account),
    ]);

    const decimals = Number(decimalsRaw);
    tokenData = {
      address: tokenAddress,
      name: String(nameRaw),
      symbol: String(symbolRaw),
      decimals,
      balance: ethers.formatUnits(tokenBalRaw, decimals),
    };
    tokenOnSelectedNetwork = true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Token not found on selected network";
    tokenOnSelectedNetworkError = msg;
    tokenError = msg;
  }

  return {
    payload: {
      account,
      network,
      nativeSymbol: network === "bscTestnet" ? "tBNB" : "BNB",
      bnbBalance,
      tBnbBalance,
      tokenOnSelectedNetwork,
      tokenOnSelectedNetworkError,
      token: tokenData,
      tokenError,
    },
  };
}

router.post("/preview", requireAuth, requirePlan, async (req: Request, res: Response) => {
  try {
    const { privateKey, tokenAddress, network } = req.body as {
      privateKey: string;
      tokenAddress: string;
      network: Network;
    };

    if (!privateKey?.trim()) return res.status(400).json({ error: "privateKey is required" });
    if (!tokenAddress?.trim()) return res.status(400).json({ error: "tokenAddress is required" });
    if (!ethers.isAddress(tokenAddress)) return res.status(400).json({ error: "Invalid tokenAddress" });
    if (network !== "bscMainnet" && network !== "bscTestnet") {
      return res.status(400).json({ error: "network must be bscMainnet or bscTestnet" });
    }

    const normalizedPk = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
    let account: string;
    try {
      account = new ethers.Wallet(normalizedPk).address;
    } catch {
      return res.status(400).json({ error: "Invalid privateKey" });
    }

    const result = await buildPreview(account, tokenAddress, network);
    if ("error" in result) return res.status(500).json({ error: result.error });
    return res.json(result.payload);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to fetch wallet preview";
    return res.status(500).json({ error: msg });
  }
});

// Browser-wallet variant: the connected wallet supplies only its address.
// No private key is ever sent — signing stays in the user's wallet.
router.post("/preview-address", requireAuth, requirePlan, async (req: Request, res: Response) => {
  try {
    const { address, tokenAddress, network } = req.body as {
      address: string;
      tokenAddress: string;
      network: Network;
    };

    if (!address?.trim()) return res.status(400).json({ error: "address is required" });
    if (!ethers.isAddress(address)) return res.status(400).json({ error: "Invalid address" });
    if (!tokenAddress?.trim()) return res.status(400).json({ error: "tokenAddress is required" });
    if (!ethers.isAddress(tokenAddress)) return res.status(400).json({ error: "Invalid tokenAddress" });
    if (network !== "bscMainnet" && network !== "bscTestnet") {
      return res.status(400).json({ error: "network must be bscMainnet or bscTestnet" });
    }

    const result = await buildPreview(ethers.getAddress(address), tokenAddress, network);
    if ("error" in result) return res.status(500).json({ error: result.error });
    return res.json(result.payload);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to fetch wallet preview";
    return res.status(500).json({ error: msg });
  }
});

export default router;
