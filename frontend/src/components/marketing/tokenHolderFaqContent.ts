/** Shared FAQ copy for Landing + Pricing (token holder line). */

export const TOKEN_HOLDER_FAQ = [
  {
    q: "How are wallets generated?",
    a: "Wallets are derived using standard Ethereum-compatible HD derivation (BIP44-style paths) from a secure workflow you control in-session. Each address is suitable for BEP20 / ERC20-style distributions on EVM networks.",
  },
  {
    q: "Is my private key stored on your servers?",
    a: "Signing material for distribution workflows is scoped to your authenticated session and is not intended for long-term storage in our databases. Follow operational security best practices for mnemonics and hot wallets.",
  },
  {
    q: "What cryptocurrencies can I pay with?",
    a: "Checkout is powered by Coinbase Commerce—typically ETH, USDC, BTC, USDT, DAI, and additional assets supported in the hosted payment flow.",
  },
  {
    q: "How long does crypto confirmation take?",
    a: "Settlement time depends on the asset and network congestion. Many stablecoin payments confirm within minutes on supported L1/L2 rails; always allow extra time during peak mempool activity.",
  },
  {
    q: "Can I upgrade to a higher package later?",
    a: "Yes. You can move to a larger wallet tier when your campaign grows—complete checkout for the higher package and continue from your account when ready.",
  },
  {
    q: "Which networks and token standards are supported?",
    a: "Packages are designed around EVM-compatible distribution flows—commonly BEP20 on BNB Chain and ERC20 on Ethereum-compatible networks. Confirm your token contract details during setup.",
  },
  {
    q: "What reporting and proof do I receive?",
    a: "Packages include Excel-oriented reporting with wallet addresses, amounts, and status fields where applicable, plus on-chain transaction identifiers so you can verify transfers independently.",
  },
] as const;
