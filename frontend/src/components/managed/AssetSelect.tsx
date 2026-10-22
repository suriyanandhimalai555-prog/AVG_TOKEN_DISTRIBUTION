/**
 * Token selector shared by the pool and treasury pages.
 *
 * The choice lives in the URL as `?asset=` ("native" or a lowercase token
 * address; absent = all assets) so it survives tab switches, reloads and links.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Coins, Layers, Loader2, Plus, Search } from "lucide-react";
import { NATIVE_ASSET, type Asset, type Network } from "@/lib/managedTypes";
import { managedApi } from "./client";
import { apiErrorMessage, nativeSymbol, networkLabel } from "./format";
import { useManagedTheme } from "./theme";
import TokenIcon, { compareTokens, isPreferredToken } from "./TokenIcon";

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
      .map((t) => ({ asset: t.tokenAddress.toLowerCase(), symbol: t.symbol, name: t.name, decimals: t.decimals }));
    return [{ asset: NATIVE_ASSET, symbol: nativeSymbol(network), name: "BNB (native)", decimals: 18 }, ...tokens].sort(compareTokens);
  }, [data, network]);
  return { options, loading: isLoading };
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Tracks a token by contract address (metadata is read on-chain by the API)
 * and refreshes every token list and balance view. "Already tracked" counts
 * as success. Returns the lowercase address.
 */
export function useImportToken(): (network: Network, address: string) => Promise<string> {
  const qc = useQueryClient();
  return async (network, address) => {
    const tokenAddress = address.trim().toLowerCase();
    try {
      await managedApi.trackToken({ network, tokenAddress });
    } catch (err) {
      const code = (err as { response?: { data?: { code?: string } } }).response?.data?.code;
      if (code !== "ALREADY_TRACKED") throw err;
    }
    void qc.invalidateQueries({ queryKey: ["managed", "tokens"] });
    // Balances refresh on the server right after the import; pick them up shortly.
    for (const ms of [4000, 12000]) {
      setTimeout(() => {
        void qc.invalidateQueries({ queryKey: ["managed", "wallets"] });
        void qc.invalidateQueries({ queryKey: ["managed", "treasury"] });
      }, ms);
    }
    return tokenAddress;
  };
}

interface AssetSelectProps {
  options: AssetOption[];
  value: Asset | null;
  onChange: (asset: Asset | null) => void;
  /** Label for the "no filter" choice. */
  allLabel?: string;
  disabled?: boolean;
  /**
   * Networks a pasted contract address can be imported on. Omit to disable
   * importing. `importValue` maps the imported token to this select's value.
   */
  importNetworks?: Network[];
  importValue?: (network: Network, address: string) => Asset;
}

export default function AssetSelect({
  options,
  value,
  onChange,
  allLabel = "All assets",
  disabled,
  importNetworks,
  importValue = (_network, address) => address,
}: AssetSelectProps) {
  const { soft, ink, bgCell, isDark } = useManagedTheme();
  const importToken = useImportToken();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [importing, setImporting] = useState<Network | null>(null);
  const [importError, setImportError] = useState("");
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

  useEffect(() => {
    setActive(0);
    setImportError("");
  }, [query]);

  // A pasted contract address that is not listed yet can be imported.
  const pasted = query.trim();
  const importCandidates: Network[] =
    importNetworks && ADDRESS_RE.test(pasted) && !options.some((o) => o.asset.toLowerCase().endsWith(pasted.toLowerCase()))
      ? importNetworks
      : [];

  async function runImport(network: Network): Promise<void> {
    setImporting(network);
    setImportError("");
    try {
      const addr = await importToken(network, pasted);
      onChange(importValue(network, addr));
      setOpen(false);
    } catch (err) {
      setImportError(apiErrorMessage(err, "Could not import this token"));
    } finally {
      setImporting(null);
    }
  }

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
                placeholder={importNetworks ? "Search, or paste a contract address to import" : "Search name, symbol or address"}
                className={`w-full rounded-lg border border-[var(--app-input-border)] bg-[var(--app-input-bg)] py-1.5 pl-8 pr-2 text-xs outline-none focus:border-accent ${ink}`}
                aria-label="Search tokens"
                aria-controls={listId}
                aria-activedescendant={`${listId}-${active}`}
              />
            </div>
          </div>
          <ul ref={listRef} id={listId} role="listbox" aria-label="Tokens" className="max-h-72 overflow-y-auto py-1">
            {importCandidates.map((network) => (
              <li key={`import-${network}`} className="mx-1">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void runImport(network)}
                  disabled={importing !== null}
                  className="flex w-full items-center gap-2.5 rounded-lg border border-dashed border-accent/50 bg-accent/5 px-2 py-2 text-left hover:bg-accent/10 disabled:opacity-60"
                >
                  <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-white">
                    {importing === network ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Plus size={14} aria-hidden />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-xs font-semibold ${ink}`}>
                      {importing === network ? "Importing…" : `Import token on ${networkLabel(network)}`}
                    </span>
                    <span className={`block truncate font-mono text-[10px] ${soft}`}>{pasted}</span>
                  </span>
                </button>
              </li>
            ))}
            {importError ? <li className="px-3 py-2 text-[11px] text-danger">{importError}</li> : null}
            {rows.length === 0 && importCandidates.length === 0 ? (
              <li className={`px-3 py-6 text-center text-[11px] ${soft}`}>
                No token matches “{query}”.{importNetworks ? " Paste a full contract address to import it." : ""}
              </li>
            ) : null}
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
                    <span className={`flex items-center gap-1.5 truncate text-xs font-semibold ${ink}`}>
                      {row ? row.symbol : allLabel}
                      {row && isPreferredToken(row.asset) ? (
                        <span className="rounded-full border border-success/40 bg-success/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-success">Preferred</span>
                      ) : null}
                    </span>
                    <span className={`block truncate text-[10px] ${soft}`}>
                      {row ? `${row.name} · ${hintOf(row)}` : "Every token in this view"}
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
