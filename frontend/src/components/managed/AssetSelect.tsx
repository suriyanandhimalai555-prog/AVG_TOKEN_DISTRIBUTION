/**
 * Token selector shared by the pool and treasury pages.
 *
 * The choice lives in the URL as `?asset=` ("native" or a lowercase token
 * address; absent = all assets) so it survives tab switches, reloads and links.
 */
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Coins } from "lucide-react";
import { NATIVE_ASSET, type Asset, type Network } from "@/lib/managedTypes";
import { managedApi } from "./client";
import { nativeSymbol } from "./format";
import { selectCls, useManagedTheme } from "./theme";

export interface AssetOption {
  asset: Asset;
  symbol: string;
  name: string;
  decimals: number;
  /** Replaces the short address shown after the symbol in the dropdown. */
  hint?: string;
}

/** Reads and writes `?asset=`; null means "all assets". */
export function useSelectedAsset(): [Asset | null, (asset: Asset | null) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get("asset");
  // Token addresses are compared lowercase; other keys (e.g. "bscMainnet:native") are kept as is.
  const value = raw ? (raw.startsWith("0x") ? raw.toLowerCase() : raw) : null;
  const set = (asset: Asset | null): void => {
    const next = new URLSearchParams(params);
    if (asset) next.set("asset", asset);
    else next.delete("asset");
    setParams(next, { replace: true });
  };
  return [value, set];
}

/** Native coin plus every visible tracked or discovered token on a network. */
export function useAssetOptions(network: Network | null): { options: AssetOption[]; loading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: ["managed", "tokens", network],
    queryFn: () => managedApi.listTokens({ network: network ?? undefined }),
    enabled: Boolean(network),
    staleTime: 60_000,
  });
  const options = useMemo<AssetOption[]>(() => {
    if (!network) return [];
    const tokens = (data?.tokens ?? [])
      .filter((t) => !t.hidden)
      .map((t) => ({ asset: t.tokenAddress.toLowerCase(), symbol: t.symbol, name: t.name, decimals: t.decimals }))
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
    return [{ asset: NATIVE_ASSET, symbol: nativeSymbol(network), name: "BNB (native)", decimals: 18 }, ...tokens];
  }, [data, network]);
  return { options, loading: isLoading };
}

interface AssetSelectProps {
  options: AssetOption[];
  value: Asset | null;
  onChange: (asset: Asset | null) => void;
  /** Label for the "no filter" choice. */
  allLabel?: string;
  disabled?: boolean;
}

export default function AssetSelect({ options, value, onChange, allLabel = "All assets", disabled }: AssetSelectProps) {
  const { soft } = useManagedTheme();
  // A selection that is not (or no longer) an option still renders, so the URL stays honest.
  const known = value === null || options.some((o) => o.asset === value);
  return (
    <label className={`inline-flex items-center gap-2 text-[11px] font-medium ${soft}`}>
      <Coins size={14} aria-hidden />
      <span className="uppercase tracking-widest">Token</span>
      <select
        className={`${selectCls} min-w-[170px]`}
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        aria-label="Token shown in balances"
      >
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.asset} value={o.asset}>
            {o.symbol}
            {o.hint ? ` · ${o.hint}` : o.asset === NATIVE_ASSET ? " · native" : ` · ${o.asset.slice(0, 6)}…${o.asset.slice(-4)}`}
          </option>
        ))}
        {!known && value ? <option value={value}>{value.slice(0, 10)}…</option> : null}
      </select>
    </label>
  );
}
