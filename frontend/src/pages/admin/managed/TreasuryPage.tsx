import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQueries, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Fuel, RefreshCw, Loader2 } from "lucide-react";
import type { Deposit, Network } from "@/lib/managedTypes";
import RouteErrorFallback from "@/components/RouteErrorFallback";
import StatCard from "@/components/ui/StatCard";
import AddressCell from "@/components/ui/AddressCell";
import { managedApi } from "@/components/managed/client";
import NetworkBadge from "@/components/managed/NetworkBadge";
import TokenBadge from "@/components/managed/TokenBadge";
import DepositFeed from "@/components/managed/DepositFeed";
import { apiErrorMessage, formatUnits, isMainnet, networkLabel, timeAgo } from "@/components/managed/format";
import { ghostBtn, tdCls, thCls, useManagedTheme } from "@/components/managed/theme";

const FEED_LIMIT = 50;

/** F6: totals per token, master balances per pool, low-gas warning, cross-pool deposit feed. */
export default function TreasuryPage() {
  const { ink, soft, bgInset, rowZebra } = useManagedTheme();

  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ["managed", "treasury"],
    queryFn: () => managedApi.getTreasury(),
    refetchInterval: 30000,
  });
  const { data: poolsData } = useQuery({
    queryKey: ["managed", "pools"],
    queryFn: () => managedApi.listPools(),
    refetchInterval: 30000,
  });
  const poolName = useMemo(() => new Map((poolsData?.pools ?? []).map((p) => [p.id, p.name])), [poolsData]);
  const poolNetwork = useMemo(() => new Map((data?.byPool ?? []).map((p) => [p.poolId, p.network])), [data]);

  // Cross-pool deposit feed: last 50 per pool, merged and trimmed to 50.
  const depositQueries = useQueries({
    queries: (data?.byPool ?? []).map((p) => ({
      queryKey: ["managed", "deposits", p.poolId, "treasury-feed"],
      queryFn: () => managedApi.listDeposits(p.poolId, { skip: 0, limit: FEED_LIMIT }),
      refetchInterval: 30000,
    })),
  });
  const feed: Array<Deposit & { poolId: string }> = useMemo(() => {
    const out: Array<Deposit & { poolId: string }> = [];
    depositQueries.forEach((q, i) => {
      const poolId = data?.byPool[i]?.poolId;
      if (!q.data || !poolId) return;
      for (const d of q.data.deposits) out.push({ ...d, poolId });
    });
    out.sort((a, b) => ((a.blockTime ?? a.createdAt) < (b.blockTime ?? b.createdAt) ? 1 : -1));
    return out.slice(0, FEED_LIMIT);
  }, [depositQueries, data]);
  const feedLoading = depositQueries.some((q) => q.isLoading);
  const walletIdPool = useMemo(() => new Map(feed.map((d) => [d.id, d.poolId])), [feed]);

  if (error) return <RouteErrorFallback message={apiErrorMessage(error, "Unable to load the treasury.")} onRetry={() => void refetch()} />;

  const lowGasPools = (data?.byPool ?? []).filter((p) => p.lowGas);
  const assetCount = new Set((data?.totalsByNetwork ?? []).flatMap((n) => n.totals.map((t) => `${n.network}:${t.asset}`))).size;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className={`text-[11px] uppercase tracking-widest ${soft}`}>Admin · Treasury</p>
          <h1 className={`mt-1 font-display text-xl font-semibold tracking-tight ${ink}`}>Treasury</h1>
          <p className={`mt-1 text-xs ${soft}`}>All balances across managed wallets roll up here, per token and per pool. Refreshes every 30 s{dataUpdatedAt ? ` · updated ${timeAgo(new Date(dataUpdatedAt).toISOString())}` : ""}.</p>
        </div>
        <button type="button" className={ghostBtn} onClick={() => void refetch()}>
          <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {lowGasPools.length > 0 ? (
        <div className="flex gap-3 rounded-lg border border-warning/40 bg-warning/[0.08] p-4">
          <Fuel size={18} className="mt-0.5 shrink-0 text-warning" />
          <div className="text-xs">
            <p className="font-semibold text-warning">Low gas on {lowGasPools.length === 1 ? "a master wallet" : `${lowGasPools.length} master wallets`}</p>
            <p className={`mt-0.5 ${soft}`}>
              Gas top-ups for outbound transfers come from the master. Fund{" "}
              {lowGasPools.map((p, i) => (
                <span key={p.poolId}>
                  {i > 0 ? ", " : ""}
                  <Link to={`/admin/managed/pools/${p.poolId}`} className="font-medium text-accent hover:underline">
                    {poolName.get(p.poolId) ?? p.poolId.slice(0, 8)}
                  </Link>{" "}
                  (<span className="font-mono">{p.masterAddress.slice(0, 8)}…</span>)
                </span>
              ))}{" "}
              with BNB before sweeping.
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Active pools" value={data?.poolCount ?? 0} accent />
        <StatCard label="Managed wallets" value={data?.walletCount ?? 0} />
        <StatCard label="Assets held" value={assetCount} />
        <StatCard label="Low-gas masters" value={lowGasPools.length} sub={lowGasPools.length ? "needs BNB" : "all funded"} />
      </div>

      {isLoading ? (
        <p className={`inline-flex items-center gap-2 py-6 text-[11px] uppercase tracking-widest ${soft}`}>
          <Loader2 size={14} className="animate-spin" /> Loading balances…
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* Totals per token (per network) */}
        <section className="dash-card overflow-hidden">
          <div className={`border-b border-border px-4 py-2 ${bgInset}`}>
            <p className={`text-[10px] font-mono uppercase tracking-widest ${soft}`}>Totals per token</p>
          </div>
          {(data?.totalsByNetwork ?? []).length === 0 && !isLoading ? (
            <p className={`px-4 py-8 text-center text-[11px] ${soft}`}>No balances yet.</p>
          ) : (
            (data?.totalsByNetwork ?? []).map((n) => (
              <div key={n.network}>
                <div className="flex items-center gap-2 px-4 pt-3">
                  <NetworkBadge network={n.network} compact />
                  <span className={`text-[10px] ${soft}`}>{networkLabel(n.network)}</span>
                </div>
                <table className="mt-2 w-full text-xs font-mono">
                  <thead>
                    <tr className="border-b border-border">
                      {["Token", "Total", "Wallets holding"].map((h) => (
                        <th key={h} className={`${thCls} ${soft}`}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {n.totals.length === 0 ? (
                      <tr>
                        <td colSpan={3} className={`py-4 text-center text-[11px] ${soft}`}>
                          Nothing held on this network.
                        </td>
                      </tr>
                    ) : (
                      n.totals.map((t, i) => (
                        <tr key={t.asset} className={`border-b border-border/50 ${i % 2 ? rowZebra : ""}`}>
                          <td className={tdCls}>
                            <span className="inline-flex items-center gap-2">
                              <TokenBadge symbol={t.symbol} asset={t.asset} size="sm" />
                              <span className={`text-[11px] ${soft}`}>{t.name}</span>
                            </span>
                          </td>
                          <td className={`${tdCls} tabular-nums ${ink}`} title={`${formatUnits(t.totalWei, t.decimals, t.decimals)} ${t.symbol}`}>
                            {formatUnits(t.totalWei, t.decimals)} {t.symbol}
                          </td>
                          <td className={`${tdCls} tabular-nums ${soft}`}>{t.walletsWithBalance.toLocaleString()}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            ))
          )}
          <div className="h-3" />
        </section>

        {/* Master wallet balances per pool */}
        <section className="dash-card overflow-hidden">
          <div className={`border-b border-border px-4 py-2 ${bgInset}`}>
            <p className={`text-[10px] font-mono uppercase tracking-widest ${soft}`}>Master wallets</p>
          </div>
          <ul className="divide-y divide-border/60">
            {(data?.byPool ?? []).length === 0 && !isLoading ? <li className={`px-4 py-8 text-center text-[11px] ${soft}`}>No active pools.</li> : null}
            {(data?.byPool ?? []).map((p) => (
              <li key={p.poolId} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={`/admin/managed/pools/${p.poolId}`} className={`text-xs font-semibold hover:text-accent ${ink}`}>
                      {poolName.get(p.poolId) ?? p.poolId.slice(0, 8)}
                    </Link>
                    <NetworkBadge network={p.network} compact />
                    {p.lowGas ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-warning">
                        <AlertTriangle size={10} /> Low gas
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1">
                    <AddressCell address={p.masterAddress} />
                  </p>
                  <p className={`mt-0.5 text-[10px] ${soft}`}>
                    {p.walletCount.toLocaleString()} wallets · updated {timeAgo(p.updatedAt)}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-0.5 font-mono text-xs">
                  {p.master.length === 0 ? <span className="text-text-muted">—</span> : null}
                  {p.master.map((m) => (
                    <span key={m.asset} className={`tabular-nums ${m.asset === "native" && p.lowGas ? "text-warning" : ink}`} title={`${formatUnits(m.balanceWei, m.decimals, m.decimals)} ${m.symbol}`}>
                      {formatUnits(m.balanceWei, m.decimals)} <span className={`text-[10px] ${soft}`}>{m.symbol}</span>
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Deposit feed across pools */}
      <section className="dash-card overflow-hidden">
        <div className={`border-b border-border px-4 py-2 ${bgInset}`}>
          <p className={`text-[10px] font-mono uppercase tracking-widest ${soft}`}>Recent deposits · last {FEED_LIMIT} across pools</p>
        </div>
        <DepositFeed
          deposits={feed}
          loading={feedLoading}
          mainnet={(d) => {
            const net: Network | undefined = poolNetwork.get(walletIdPool.get(d.id) ?? "");
            return net ? isMainnet(net) : true;
          }}
          poolNameOf={(d) => poolName.get(walletIdPool.get(d.id) ?? "")}
          emptyText="No token deposits across active pools yet."
        />
      </section>

      {/* Per-pool breakdown */}
      <section className="space-y-3">
        <p className="dash-section-title">Per-pool breakdown</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(data?.byPool ?? []).map((p) => (
            <div key={p.poolId} className="dash-card p-4">
              <div className="flex items-center justify-between gap-2">
                <Link to={`/admin/managed/pools/${p.poolId}`} className={`truncate text-xs font-semibold hover:text-accent ${ink}`}>
                  {poolName.get(p.poolId) ?? p.poolId.slice(0, 8)}
                </Link>
                <NetworkBadge network={p.network} compact />
              </div>
              <ul className="mt-2 space-y-1 font-mono text-[11px]">
                {p.totals.length === 0 ? <li className="text-text-muted">No balances</li> : null}
                {p.totals.map((t) => (
                  <li key={t.asset} className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5">
                      <TokenBadge symbol={t.symbol} asset={t.asset} />
                      <span className={soft}>{t.walletsWithBalance} wallet{t.walletsWithBalance === 1 ? "" : "s"}</span>
                    </span>
                    <span className={`tabular-nums ${ink}`}>{formatUnits(t.totalWei, t.decimals)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
