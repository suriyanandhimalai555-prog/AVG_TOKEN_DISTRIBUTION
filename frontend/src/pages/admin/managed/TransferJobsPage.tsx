import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { RefreshCw, X } from "lucide-react";
import type { TransferJob, TransferStatus } from "@/lib/managedTypes";
import RouteErrorFallback from "@/components/RouteErrorFallback";
import { managedApi } from "@/components/managed/client";
import TransferJobsTable from "@/components/managed/TransferJobsTable";
import JobStatusDrawer from "@/components/managed/JobStatusDrawer";
import { useReauth } from "@/components/managed/ReauthDialog";
import { apiErrorMessage, hasActiveJob, isMainnet, pollingInterval } from "@/components/managed/format";
import { ghostBtn, inputCls, selectCls, useManagedTheme } from "@/components/managed/theme";

const PAGE = 50;
const STATUSES: TransferStatus[] = ["PENDING", "FUNDING_GAS", "SENDING", "CONFIRMED", "FAILED", "CANCELLED"];

/** F9: all transfer jobs across pools with pool / status / batch filters and retry. */
export default function TransferJobsPage() {
  const { ink, soft, bgInset } = useManagedTheme();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const poolId = params.get("poolId") ?? "";
  const batchId = params.get("batchId") ?? "";
  const statusParam = params.get("status") ?? "";
  const status: TransferStatus | "" = (STATUSES as string[]).includes(statusParam) ? (statusParam as TransferStatus) : "";
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const { withReauth, reauthDialog } = useReauth("Retrying re-queues the job for the worker.");

  const setFilter = (key: "poolId" | "batchId" | "status", value: string): void => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
    setPage(0);
  };

  const { data: poolsData } = useQuery({ queryKey: ["managed", "pools"], queryFn: () => managedApi.listPools(), staleTime: 30_000 });
  const pools = poolsData?.pools ?? [];
  const poolById = useMemo(() => new Map(pools.map((p) => [p.id, p])), [pools]);

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["managed", "transfers", "all", poolId, batchId, status, page],
    queryFn: () =>
      managedApi.listTransfers({
        poolId: poolId || undefined,
        batchId: batchId.trim() || undefined,
        status: status || undefined,
        skip: page * PAGE,
        limit: PAGE,
      }),
    refetchInterval: (q) => pollingInterval(hasActiveJob(q.state.data?.jobs)),
    placeholderData: (prev) => prev,
  });

  if (error) return <RouteErrorFallback message={apiErrorMessage(error, "Unable to load transfer jobs.")} onRetry={() => void refetch()} />;

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const byStatus = data?.byStatus ?? {};
  const openJob = open ? data?.jobs.find((j) => j.id === open) : undefined;
  const openMainnet = openJob ? isMainnet(poolById.get(openJob.poolId)?.network ?? "bscMainnet") : true;

  function retry(job: TransferJob): void {
    withReauth(async () => {
      try {
        await managedApi.retryTransfer(job.id);
        toast.success("Job re-queued");
        void qc.invalidateQueries({ queryKey: ["managed", "transfers"] });
        setOpen(job.id);
      } catch (err) {
        toast.error(apiErrorMessage(err, "Retry failed"));
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className={`text-[11px] uppercase tracking-widest ${soft}`}>Admin · Managed wallets</p>
          <h1 className={`mt-1 font-display text-xl font-semibold tracking-tight ${ink}`}>Transfer jobs</h1>
          <p className={`mt-1 text-xs ${soft}`}>Every outbound transfer and sweep job across pools. Polls every 5 s while a job is active.</p>
        </div>
        <button type="button" className={ghostBtn} onClick={() => void refetch()}>
          <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-text-secondary">Pool</label>
          <select value={poolId} onChange={(e) => setFilter("poolId", e.target.value)} className={`${selectCls} min-w-[180px]`}>
            <option value="">All pools</option>
            {pools.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-text-secondary">Status</label>
          <select value={status} onChange={(e) => setFilter("status", e.target.value)} className={`${selectCls} min-w-[150px]`}>
            <option value="">Any status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[220px] flex-1 sm:max-w-xs">
          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-text-secondary">Batch id</label>
          <div className="relative">
            <input type="text" value={batchId} onChange={(e) => setFilter("batchId", e.target.value)} placeholder="Sweep batch id" className={`${inputCls} pr-8`} spellCheck={false} />
            {batchId ? (
              <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary" onClick={() => setFilter("batchId", "")} aria-label="Clear batch filter">
                <X size={14} />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter("status", status === s ? "" : s)}
            className={`rounded-full border px-2 py-0.5 font-mono text-[10px] transition ${status === s ? "border-accent text-accent" : `border-border ${byStatus[s] ? ink : "text-text-muted"}`}`}
          >
            {s} <span className="font-semibold">{byStatus[s] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="dash-card overflow-hidden">
        <div className={`flex items-center justify-between border-b border-border px-4 py-2 ${bgInset}`}>
          <p className={`text-[10px] font-mono uppercase tracking-widest ${soft}`}>Jobs · {total.toLocaleString()}</p>
        </div>
        <TransferJobsTable
          jobs={data?.jobs ?? []}
          loading={isLoading}
          networkOf={(id) => poolById.get(id)?.network}
          poolNameOf={(id) => poolById.get(id)?.name}
          onOpen={(j) => setOpen(j.id)}
          onRetry={retry}
        />
        <div className={`flex items-center justify-between border-t border-border px-4 py-2 text-[11px] font-mono ${soft}`}>
          <span>
            Page {page + 1} / {pages}
          </span>
          <div className="flex gap-2">
            <button type="button" disabled={page <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className="border border-border px-3 py-1 disabled:opacity-30">
              Prev
            </button>
            <button type="button" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} className="border border-border px-3 py-1 disabled:opacity-30">
              Next
            </button>
          </div>
        </div>
      </div>

      <JobStatusDrawer jobId={open} mainnet={openMainnet} onClose={() => setOpen(null)} />
      {reauthDialog}
    </div>
  );
}
