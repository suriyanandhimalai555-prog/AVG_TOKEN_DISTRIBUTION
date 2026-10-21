import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Check, Loader2, AlertTriangle, Circle, Minus } from "lucide-react";
import type { TransferJob, TransferStatus } from "@/lib/managedTypes";
import AddressCell from "@/components/ui/AddressCell";
import TxHashLink from "@/components/ui/TxHashLink";
import StatusBadge from "@/components/ui/StatusBadge";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { managedApi } from "./client";
import { badgeStatus, fmtDateTime, formatBnb, formatGwei, formatInt, formatUnits, isTerminalStatus } from "./format";
import { useManagedTheme } from "./theme";

interface JobStatusDrawerProps {
  jobId: string | null;
  mainnet: boolean;
  onClose: () => void;
}

const PIPELINE: TransferStatus[] = ["PENDING", "FUNDING_GAS", "SENDING", "CONFIRMED"];
const ORDER: Record<TransferStatus, number> = { PENDING: 0, FUNDING_GAS: 1, SENDING: 2, CONFIRMED: 3, FAILED: 3, CANCELLED: 3 };

type StepState = "done" | "active" | "todo" | "skipped" | "failed";

function stepState(step: TransferStatus, job: TransferJob): StepState {
  const cur = ORDER[job.status];
  const idx = ORDER[step];
  const failed = job.status === "FAILED" || job.status === "CANCELLED";
  if (step === "FUNDING_GAS" && !job.gasTopupTxHash && cur > 1) return "skipped";
  if (step === "CONFIRMED" && failed) return "failed";
  if (idx < cur) return "done";
  if (idx === cur) return failed ? "failed" : job.status === "CONFIRMED" ? "done" : "active";
  return "todo";
}

/**
 * Right-side drawer that polls GET /transfers/:id every 3 s until the job is
 * terminal and shows the pipeline PENDING → FUNDING_GAS → SENDING → CONFIRMED.
 */
export default function JobStatusDrawer({ jobId, mainnet, onClose }: JobStatusDrawerProps) {
  const { ink, soft, bgInset } = useManagedTheme();
  const qc = useQueryClient();
  useBodyScrollLock(Boolean(jobId));

  const { data, error, isLoading } = useQuery({
    queryKey: ["managed", "transfer", jobId],
    queryFn: () => managedApi.getTransfer(jobId as string),
    enabled: Boolean(jobId),
    refetchInterval: (q) => {
      const s = q.state.data?.job.status;
      return s && isTerminalStatus(s) ? false : 3000;
    },
  });
  const job = data?.job;

  // Lists elsewhere on screen should pick up the terminal state immediately.
  useEffect(() => {
    if (job && isTerminalStatus(job.status)) void qc.invalidateQueries({ queryKey: ["managed", "transfers"] });
  }, [job?.status, job, qc]);

  if (!jobId) return null;

  return (
    <div className="fixed inset-0 z-[55] flex justify-end bg-black/50 backdrop-blur-[1px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="dash-card flex h-full w-full max-w-md flex-col overflow-hidden rounded-none border-y-0 border-r-0 shadow-2xl" role="dialog" aria-modal="true" aria-label="Transfer job status">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <p className="dash-section-title">Transfer job</p>
            <h3 className={`mt-0.5 font-display text-base font-semibold ${ink}`}>{job ? `${formatUnits(job.amountWei, job.decimals)} ${job.symbol}` : "Loading…"}</h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-text-secondary hover:text-text-primary" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 text-xs">
          {isLoading && !job ? (
            <p className={`inline-flex items-center gap-2 ${soft}`}>
              <Loader2 size={14} className="animate-spin" /> Fetching job…
            </p>
          ) : null}
          {error ? <p className="text-danger">Could not load the job.</p> : null}
          {job ? (
            <>
              <div className="flex items-center justify-between">
                <StatusBadge status={badgeStatus(job.status)} />
                <span className={`font-mono text-[10px] ${soft}`}>
                  {job.status} · attempt {job.attempts}
                </span>
              </div>

              <ol className="space-y-0">
                {PIPELINE.map((step, i) => {
                  const st = stepState(step, job);
                  const last = i === PIPELINE.length - 1;
                  const label =
                    step === "PENDING" ? "Queued" : step === "FUNDING_GAS" ? "Gas top-up from master" : step === "SENDING" ? "Child wallet sends" : "Confirmed";
                  const failedHere = st === "failed";
                  return (
                    <li key={step} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] ${
                            st === "done"
                              ? "border-success bg-success/15 text-success"
                              : st === "active"
                                ? "border-accent bg-accent/15 text-accent"
                                : st === "failed"
                                  ? "border-danger bg-danger/15 text-danger"
                                  : st === "skipped"
                                    ? "border-border text-text-muted"
                                    : "border-border text-text-muted"
                          }`}
                        >
                          {st === "done" ? <Check size={12} /> : st === "active" ? <Loader2 size={12} className="animate-spin" /> : st === "failed" ? <AlertTriangle size={12} /> : st === "skipped" ? <Minus size={12} /> : <Circle size={8} />}
                        </span>
                        {!last ? <span className={`w-px flex-1 ${st === "done" ? "bg-success/50" : "bg-border"}`} style={{ minHeight: 18 }} /> : null}
                      </div>
                      <div className="pb-3">
                        <p className={`font-medium ${st === "todo" || st === "skipped" ? soft : failedHere ? "text-danger" : ink}`}>
                          {failedHere ? (job.status === "CANCELLED" ? "Cancelled" : "Failed") : label}
                          {st === "skipped" ? <span className="ml-1 text-[10px] text-text-muted">(not needed, wallet had gas)</span> : null}
                        </p>
                        {step === "FUNDING_GAS" && job.gasTopupTxHash ? (
                          <p className="mt-0.5">
                            <TxHashLink hash={job.gasTopupTxHash} mainnet={mainnet} />
                          </p>
                        ) : null}
                        {step === "SENDING" && job.transferTxHash ? (
                          <p className="mt-0.5">
                            <TxHashLink hash={job.transferTxHash} mainnet={mainnet} />
                          </p>
                        ) : null}
                        {step === "CONFIRMED" && job.confirmedAt ? <p className={`mt-0.5 text-[10px] ${soft}`}>{fmtDateTime(job.confirmedAt)}</p> : null}
                        {failedHere && job.error ? (
                          <p className="mt-1 break-words rounded-md border border-danger/40 bg-danger/10 px-2 py-1 font-mono text-[11px] text-danger">
                            {job.errorCode ? `${job.errorCode}: ` : ""}
                            {job.error}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>

              <dl className={`space-y-0 rounded-lg border border-border p-3 ${bgInset}`}>
                <Row k="From" v={<AddressCell address={job.walletAddress} />} />
                <Row k="To" v={<AddressCell address={job.toAddress} />} />
                <Row k="Amount" v={<span className={`font-mono ${ink}`}>{job.sweepAll ? `All (${formatUnits(job.amountWei, job.decimals)})` : formatUnits(job.amountWei, job.decimals)} {job.symbol}</span>} />
                <Row k="Gas limit" v={<span className={`font-mono ${ink}`}>{formatInt(job.gasLimit)}</span>} />
                <Row k="Gas price" v={<span className={`font-mono ${ink}`}>{job.gasPriceWei ? `${formatGwei(job.gasPriceWei)} gwei` : "—"}</span>} />
                <Row k="Top-up tx" v={<TxHashLink hash={job.gasTopupTxHash} mainnet={mainnet} />} />
                <Row k="Transfer tx" v={<TxHashLink hash={job.transferTxHash} mainnet={mainnet} />} />
                <Row k="Batch" v={<span className={`font-mono text-[10px] ${soft}`}>{job.batchId ? job.batchId.slice(0, 8) : "—"}</span>} />
                <Row k="Created" v={<span className={soft}>{fmtDateTime(job.createdAt)}</span>} last />
              </dl>
              {job.gasPriceWei && job.gasLimit ? (
                <p className={`text-[11px] ${soft}`}>
                  Max gas cost {formatBnb((BigInt(job.gasPriceWei) * BigInt(job.gasLimit)).toString())} BNB
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function Row({ k, v, last = false }: { k: string; v: React.ReactNode; last?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 py-1.5 ${last ? "" : "border-b border-border/50"}`}>
      <dt className="text-text-secondary">{k}</dt>
      <dd className="text-right">{v}</dd>
    </div>
  );
}
