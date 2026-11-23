/** BNB Chain parameters for wallet_switchEthereumChain / wallet_addEthereumChain. */

export type Network = "bscMainnet" | "bscTestnet";

interface ChainParams {
  chainId: string; // hex
  chainIdDecimal: number;
  chainName: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: string[];
  blockExplorerUrls: string[];
}

export const CHAINS: Record<Network, ChainParams> = {
  bscMainnet: {
    chainId: "0x38",
    chainIdDecimal: 56,
    chainName: "BNB Smart Chain",
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    rpcUrls: ["https://bsc-dataseed1.binance.org"],
    blockExplorerUrls: ["https://bscscan.com"],
  },
  bscTestnet: {
    chainId: "0x61",
    chainIdDecimal: 97,
    chainName: "BNB Smart Chain Testnet",
    nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
    rpcUrls: ["https://data-seed-prebsc-1-s1.binance.org:8545"],
    blockExplorerUrls: ["https://testnet.bscscan.com"],
  },
};

export function chainIdDecimalToHex(id: number): string {
  return `0x${id.toString(16)}`;
}

export function networkFromChainId(chainIdHex: string | number | null | undefined): Network | null {
  if (chainIdHex == null) return null;
  const decimal = typeof chainIdHex === "string" ? parseInt(chainIdHex, chainIdHex.startsWith("0x") ? 16 : 10) : chainIdHex;
  if (decimal === CHAINS.bscMainnet.chainIdDecimal) return "bscMainnet";
  if (decimal === CHAINS.bscTestnet.chainIdDecimal) return "bscTestnet";
  return null;
}
