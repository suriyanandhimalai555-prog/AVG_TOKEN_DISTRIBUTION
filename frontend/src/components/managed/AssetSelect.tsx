/**
 * Token selector shared by the pool and treasury pages.
 *
 * The choice lives in the URL as `?asset=` ("native" or a lowercase token
 * address; absent = all assets) so it survives tab switches, reloads and links.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Coins, Layers, Search } from "lucide-react";
import { NATIVE_ASSET, type Asset, type Network } from "@/lib/managedTypes";
import { managedApi } from "./client";
import { nativeSymbol } from "./format";
import { useManagedTheme } from "./theme";
import TokenIcon from "./TokenIcon";

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
  const { soft, ink, bgCell, isDark } = useManagedTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const current = value ? options.find((o) => o.asset === value) ?? null : null;

  // "All" row first, then options filtered by symbol, name, hint or address.
  const rows = useMemo<Array<AssetOption | null>>(() => {
    const q = query.trim().toLowerCase();
    const hits = q
      ? options.filter((o) => [o.symbol, o.name, o.hint ?? "", o.asset].some((f) => f.toLowerCase().includes(q)))
      : options;
    return q ? hits : [null, ...hits];
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    const idx = Math.max(0, value ? options.findIndex((o) => o.asset === value) + 1 : 0);
    setActive(idx);
    const t = setTimeout(() => searchRef.current?.focus(), 0);
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, options, value]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const choose = (row: AssetOption | null): void => {
    onChange(row ? row.asset : null);
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(rows.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (rows[active] !== undefined) choose(rows[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  const hintOf = (o: AssetOption): string =>
    o.hint ?? (o.asset === NATIVE_ASSET ? "Native coin" : `${o.asset.slice(0, 6)}…${o.asset.slice(-4)}`);

  return (
    <div ref={rootRef} className="relative inline-flex items-center gap-2">
      <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-widest ${soft}`}>
        <Coins size={14} aria-hidden /> Token
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label="Token shown in balances"
        className={`inline-flex min-w-[190px] items-center justify-between gap-2 rounded-lg border border-[var(--app-input-border)] bg-[var(--app-input-bg)] py-1.5 pl-2 pr-2 text-xs font-medium transition hover:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-40 ${ink}`}
      >
        <span className="inline-flex min-w-0 items-center gap-2">
          {current ? (
            <>
              <TokenIcon asset={current.asset.includes(":") ? current.asset.split(":")[1] : current.asset} symbol={current.symbol} size={20} />
              <span className="truncate font-semibold">{current.symbol}</span>
              {current.hint ? <span className={`truncate text-[10px] ${soft}`}>{current.hint}</span> : null}
            </>
          ) : value ? (
            <span className="truncate font-mono">{value.slice(0, 10)}…</span>
          ) : (
            <>
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent/15 text-accent">
                <Layers size={12} aria-hidden />
              </span>
              <span>{allLabel}</span>
            </>
          )}
        </span>
        <ChevronDown size={14} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""} ${soft}`} aria-hidden />
      </button>

      {open ? (
        <div
          className={`absolute right-0 top-full z-40 mt-1.5 w-[300px] overflow-hidden rounded-xl border border-border shadow-xl ${bgCell} ${isDark ? "shadow-black/40" : "shadow-slate-900/10"}`}
          onKeyDown={onKey}
        >
          <div className="border-b border-border p-2">
            <div className="relative">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, symbol or address"
                className={`w-full rounded-lg border border-[var(--app-input-border)] bg-[var(--app-input-bg)] py-1.5 pl-8 pr-2 text-xs outline-none focus:border-accent ${ink}`}
                aria-label="Search tokens"
                aria-controls={listId}
                aria-activedescendant={`${listId}-${active}`}
              />
            </div>
          </div>
          <ul ref={listRef} id={listId} role="listbox" aria-label="Tokens" className="max-h-72 overflow-y-auto py-1">
            {rows.length === 0 ? <li className={`px-3 py-6 text-center text-[11px] ${soft}`}>No token matches “{query}”.</li> : null}
            {rows.map((row, i) => {
              const selected = row ? row.asset === value : value === null;
              const isActive = i === active;
              return (
                <li
                  key={row ? row.asset : "__all"}
                  id={`${listId}-${i}`}
                  data-row={i}
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(row)}
                  className={`mx-1 flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 ${isActive ? (isDark ? "bg-white/[0.06]" : "bg-slate-100") : ""}`}
                >
                  {row ? (
                    <TokenIcon asset={row.asset.includes(":") ? row.asset.split(":")[1] : row.asset} symbol={row.symbol} size={24} />
                  ) : (
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent/15 text-accent">
                      <Layers size={13} aria-hidden />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-xs font-semibold ${ink}`}>{row ? row.symbol : allLabel}</span>
                    <span className={`block truncate text-[10px] ${soft}`}>
                      {row ? `${row.name} · ${hintOf(row)}` : "Every token, BNB first"}
                    </span>
                  </span>
                  {selected ? <Check size={14} className="shrink-0 text-accent" aria-hidden /> : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
