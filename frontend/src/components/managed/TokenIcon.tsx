/**
 * Token logo, looked up by CONTRACT ADDRESS (never by symbol).
 *
 * Anyone can deploy a token that calls itself "USDT", and the indexer picks up
 * whatever is sent to a managed wallet. Keying logos by address means only the
 * real contracts get the real logos; every other token gets a generated badge
 * with its initials, coloured from its address.
 *
 * Logos live in /public/token-icons (official Trust Wallet assets, resized to
 * 64x64). Keep the address list in sync with backend/src/managed/chain/knownTokens.ts.
 */
import { useState } from "react";
import { NATIVE_ASSET, type Asset } from "@/lib/managedTypes";

/** lowercase contract address → icon file name (without extension). */
const ICON_BY_ADDRESS: Record<string, string> = {
  // BSC mainnet
  "0x55d398326f99059ff775485246999027b3197955": "usdt",
  "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d": "usdc",
  "0xc5f0f7b66764f6ec8c8dff7ba683102295e16409": "fdusd",
  "0xe9e7cea3dedca5984780bafc599bd69add087d56": "busd",
  "0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3": "dai",
  "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c": "wbnb",
  "0x2170ed0880ac9a755fd29b2688956bd959f933f8": "eth",
  "0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c": "btcb",
  "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82": "cake",
  "0x1d2f0da169ceb9fc7b3144628db156f3f6c60dbe": "xrp",
  "0xba2ae424d960c26247dd6c32edc70b295c744c43": "doge",
  "0x3ee2200efb3400fabb9aacf31297cbdd1d435d47": "ada",
  "0xf8a0bf9cf54bb92f17374d9e9a321e6a111a51bd": "link",
  // BSC testnet (same logos as their mainnet counterparts)
  "0x337610d27c682e347c9cd60bd4b3b107c9d34ddd": "usdt",
  "0x64544969ed7ebf5f083679233325356ebe738930": "usdc",
  "0x78867bbeef44f2326bf8ddd1941a4439382ef2a7": "busd",
  "0xec5dcb5dbf4b114c9d0f65bccab49ec54f6a0867": "dai",
  "0xae13d989dac2f0debff460ac112a837c89baa7cd": "wbnb",
  "0xfa60d973f7642b748046464e165a65b7323b0dee": "cake",
};

export function tokenIconUrl(asset: Asset | undefined | null): string | null {
  if (!asset) return null;
  if (asset === NATIVE_ASSET) return "/token-icons/bnb.png";
  const key = ICON_BY_ADDRESS[asset.toLowerCase()];
  return key ? `/token-icons/${key}.png` : null;
}

/** Stable hue from an address (or symbol) so a token always gets the same colour. */
function hueOf(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % 360;
}

function initials(symbol: string): string {
  const clean = symbol.replace(/[^\p{L}\p{N}]/gu, "");
  return (clean.slice(0, 2) || "?").toUpperCase();
}

interface TokenIconProps {
  asset?: Asset | null;
  symbol: string;
  /** Pixel size of the round icon (default 16). */
  size?: number;
  className?: string;
}

export default function TokenIcon({ asset, symbol, size = 16, className = "" }: TokenIconProps) {
  const url = tokenIconUrl(asset);
  const [broken, setBroken] = useState(false);
  const box = { width: size, height: size };

  if (url && !broken) {
    return (
      <img
        src={url}
        alt=""
        aria-hidden
        width={size}
        height={size}
        loading="lazy"
        onError={() => setBroken(true)}
        className={`inline-block shrink-0 rounded-full bg-white object-cover ring-1 ring-black/5 dark:ring-white/10 ${className}`}
        style={box}
      />
    );
  }

  const hue = hueOf((asset ?? symbol).toLowerCase());
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full font-sans font-bold leading-none text-white ring-1 ring-black/5 dark:ring-white/10 ${className}`}
      style={{
        ...box,
        fontSize: Math.max(7, Math.round(size * 0.42)),
        background: `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${(hue + 40) % 360} 70% 42%))`,
      }}
    >
      {initials(symbol)}
    </span>
  );
}
