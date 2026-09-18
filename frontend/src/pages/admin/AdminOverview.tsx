import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import StatCard from "@/components/ui/StatCard";
import RouteErrorFallback from "@/components/RouteErrorFallback";
import { fmt } from "@/lib/utils";

export default function AdminOverview() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () =>
      api
        .get<{
          totalUsers: number;
          activeSubscriptions: number;
          revenueUSD: number;
          tokenHolderCount: number;
          dexCount: number;
          paymentsToday: number;
        }>(`/api/admin/stats`)
        .then((r) => r.data),
  });

  if (error) return <RouteErrorFallback message="Unable to load admin stats." onRetry={() => refetch()} />;
  if (isLoading || !data)
    return (
      <div className="py-24 text-center font-mono text-[#6b6b6b] text-xs uppercase tracking-widest">
        Loading…
      </div>
    );

  return (
    <div className="space-y-6">
      <p className="text-[11px] text-[#6b6b6b] uppercase tracking-widest">Admin · Overview</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <StatCard label="Total Users" value={fmt(data.totalUsers)} />
        <StatCard label="Active Subscriptions" value={fmt(data.activeSubscriptions)} accent />
        <StatCard label="Revenue (USD)" value={fmt(Math.round(data.revenueUSD))} />
        <StatCard label="Token Holder Plans" value={fmt(data.tokenHolderCount)} />
        <StatCard label="Dex Plans" value={fmt(data.dexCount)} />
        <StatCard label="Payments Today" value={fmt(data.paymentsToday)} />
      </div>
    </div>
  );
}
