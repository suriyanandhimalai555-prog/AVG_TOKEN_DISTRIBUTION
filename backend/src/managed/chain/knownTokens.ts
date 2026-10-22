/**
 * Major BEP-20 tokens tracked by default on each network, so every pool can
 * show and sweep them without waiting for the indexer to discover them.
 *
 * Every address, symbol and decimals value below was verified on-chain on
 * 2026-10-22 (getCode + symbol/name/decimals through public BSC RPCs).
 * Admins can still hide any of them, or track more tokens, from Settings.
 */
import type { Network } from "../types";

export interface KnownToken {
  /** Checksummed contract address. */
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  /** The client's own token: listed first in every token picker. */
  preferred?: boolean;
}

export const KNOWN_TOKENS: Record<Network, readonly KnownToken[]> = {
  bscMainnet: [
    // AVG Coin, the client's preferred token. On-chain name "Agilavetri Groups",
    // 1,000,000,000 supply; verified on-chain 2026-10-22. Mainnet only (no testnet contract).
    { address: "0x9D7435abdB6478198C730Ed7f4AE503e51799B8b", symbol: "AVG", name: "AVG Coin", decimals: 18, preferred: true },
    { address: "0x55d398326f99059fF775485246999027B3197955", symbol: "USDT", name: "Tether USD", decimals: 18 },
    { address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", symbol: "USDC", name: "USD Coin", decimals: 18 },
    { address: "0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409", symbol: "FDUSD", name: "First Digital USD", decimals: 18 },
    { address: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56", symbol: "BUSD", name: "BUSD Token", decimals: 18 },
    { address: "0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3", symbol: "DAI", name: "Dai Token", decimals: 18 },
    { address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", symbol: "WBNB", name: "Wrapped BNB", decimals: 18 },
    { address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", symbol: "ETH", name: "Ethereum Token", decimals: 18 },
    { address: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", symbol: "BTCB", name: "BTCB Token", decimals: 18 },
    { address: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", symbol: "Cake", name: "PancakeSwap Token", decimals: 18 },
    { address: "0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE", symbol: "XRP", name: "XRP Token", decimals: 18 },
    { address: "0xbA2aE424d960c26247Dd6c32edC70B295c744C43", symbol: "DOGE", name: "Dogecoin", decimals: 8 },
    { address: "0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47", symbol: "ADA", name: "Cardano Token", decimals: 18 },
    { address: "0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD", symbol: "LINK", name: "ChainLink Token", decimals: 18 },
  ],
  bscTestnet: [
    { address: "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd", symbol: "USDT", name: "USDT Token", decimals: 18 },
    { address: "0x64544969ed7EBf5f083679233325356EbE738930", symbol: "USDC", name: "USDC Token", decimals: 18 },
    { address: "0x78867BbEeF44f2326bF8DDd1941a4439382EF2A7", symbol: "BUSD", name: "BUSD Token", decimals: 18 },
    { address: "0xEC5dCb5Dbf4B114C9d0F65BcCAb49EC54F6A0867", symbol: "DAI", name: "DAI Token", decimals: 18 },
    { address: "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd", symbol: "WBNB", name: "Wrapped BNB", decimals: 18 },
    { address: "0xFa60D973F7642B748046464e165A65B7323b0DEE", symbol: "Cake", name: "PancakeSwap Token", decimals: 18 },
  ],
};
