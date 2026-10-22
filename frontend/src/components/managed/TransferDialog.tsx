import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ArrowLeft, ArrowRight, Loader2, Send, AlertTriangle, Fuel } from "lucide-react";
import { NATIVE_ASSET, type Asset, type BalanceEntry, type ManagedWalletWithBalances, type Network, type TransferJob, type TransferPlan } from "@/lib/managedTypes";
import AddressCell from "@/components/ui/AddressCell";
import { managedApi } from "./client";
import { apiErrorMessage, formatBnb, formatGwei, formatInt, formatUnits, isValidAddress, isValidAmount, isZeroWei, nativeSymbol, newIdempotencyKey, isMainnet } from "./format";
import Modal from "./Modal";
import JobStatusDrawer from "./JobStatusDrawer";
import TokenBadge from "./TokenBadge";
import { compareTokens } from "./TokenIcon";
import { useReauth } from "./ReauthDialog";
import { inputCls, outlineBtn, primaryBtn, useManagedTheme } from "./theme";

interface TransferDialogProps {
  open: boolean;
  wallet: ManagedWalletWithBalances | null;
  pool: { masterAddress: string; network: Network };
  onClose: () => void;
  onSubmitted?: (job: TransferJob) => void;
}

type Step = 1 | 2 | 3;

/**
 * F7 / Flow 5: asset → amount + destination → review (POST /transfers/plan)
 * → password re-auth → POST /transfers with a client idempotency key → live job drawer.
 */
export default function TransferDialog({ open, wallet, pool, onClose, onSubmitted }: TransferDialogProps) {
  const { ink, soft, bgInset, hoverInset } = useManagedTheme();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>(1);
  const [asset, setAsset] = useState<Asset>(NATIVE_ASSET);
  const [amount, setAmount] = useState("");
  const [useMax, setUseMax] = useState(false);
  const [to, setTo] = useState(pool.masterAddress);
  const [plan, setPlan] = useState<TransferPlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const idemRef = useRef<string>("");
  const { withReauth, reauthDialog } = useReauth("Transfers move funds out of a managed wallet.");

  // Asset choices: native BNB always, plus every token with a non-zero balance.
  const assets: BalanceEntry[] = useMemo(() => {
    if (!wallet) return [];
    const list = wallet.balances.filter((b) => !b.hidden && (b.asset === NATIVE_ASSET || !isZeroWei(b.balanceWei)));
    if (!list.some((b) => b.asset === NATIVE_ASSET)) {
      list.unshift({ asset: NATIVE_ASSET, symbol: nativeSymbol(pool.network), name: "BNB", decimals: 18, balanceWei: "0", balance: "0", blockNumber: null, updatedAt: null, hidden: false });
    }
    return list.sort(compareTokens);
  }, [wallet, pool.network]);
  const selected = assets.find((b) => b.asset === asset) ?? assets[0];

  useEffect(() => {
    if (open) {
      setStep(1);
      setAsset(NATIVE_ASSET);
      setAmount("");
      setUseMax(false);
      setTo(pool.masterAddress);
      setPlan(null);
      setPlanError("");
      setSubmitting(false);
      setJobId(null);
      idemRef.current = "";
    }
  }, [open, pool.masterAddress, wallet?.id]);

  const amountOk = useMax || (selected ? isValidAmount(amount, selected.decimals) : false);
  const toOk = isValidAddress(to);

  async function goReview(): Promise<void> {
    if (!wallet || !selected) return;
    setStep(3);
    setPlanning(true);
    setPlan(null);
    setPlanError("");
    idemRef.current = newIdempotencyKey();
    try {
      const res = await managedApi.planTransfer({
        walletId: wallet.id,
        toAddress: to.trim(),
        asset: selected.asset,
        ...(useMax ? { sweepAll: true } : { amount: amount.trim() }),
      });
      setPlan(res.plan);
    } catch (err) {
      setPlanError(apiErrorMessage(err, "Could not estimate the transfer"));
    } finally {
      setPlanning(false);
    }
  }

  function submit(): void {
    if (!wallet || !selected || !plan || !plan.ok) return;
    withReauth(async () => {
      setSubmitting(true);
      try {
        const res = await managedApi.createTransfer({
          walletId: wallet.id,
          toAddress: to.trim(),
          asset: selected.asset,
          ...(useMax ? { sweepAll: true } : { amount: amount.trim() }),
          idempotencyKey: idemRef.current || newIdempotencyKey(),
        });
        toast.success("Transfer queued");
        onSubmitted?.(res.job);
        void qc.invalidateQueries({ queryKey: ["managed"] });
        setJobId(res.job.id);
      } catch (err) {
        toast.error(apiErrorMessage(err, "Transfer failed"));
      } finally {
        setSubmitting(false);
      }
    });
  }

  function closeAll(): void {
    setJobId(null);
    void qc.invalidateQueries({ queryKey: ["managed"] });
    onClose();
  }

  if (!wallet) return null;
  const topUp = plan && plan.ok ? BigInt(plan.topUpWei) : 0n;

  return (
    <>
      <Modal
        open={open && !jobId}
        title="Transfer"
        subtitle={`From wallet #${wallet.derivationIndex} · ${wallet.label ?? wallet.address}`}
        onClose={submitting ? undefined : onClose}
        size="md"
        footer={
          <>
            {step > 1 ? (
              <button type="button" className={outlineBtn} onClick={() => setStep((s) => (s === 3 ? 2 : 1))} disabled={submitting}>
                <ArrowLeft size={14} /> Back
              </button>
            ) : (
              <button type="button" className={outlineBtn} onClick={onClose}>
                Cancel
              </button>
            )}
            {step === 1 ? (
              <button type="button" className={primaryBtn} onClick={() => setStep(2)} disabled={!selected}>
                Next <ArrowRight size={14} />
              </button>
            ) : step === 2 ? (
              <button type="button" className={primaryBtn} onClick={() => void goReview()} disabled={!amountOk || !toOk}>
                Review <ArrowRight size={14} />
              </button>
            ) : (
              <button type="button" className={primaryBtn} onClick={submit} disabled={submitting || planning || !plan || !plan.ok}>
                {submitting ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Submitting…
                  </>
                ) : (
                  <>
                    <Send size={14} /> Confirm transfer
                  </>
                )}
              </button>
            )}
          </>
        }
      >
        <Steps step={step} />

        {step === 1 ? (
          <div className="space-y-2">
            <p className={`text-[11px] ${soft}`}>Pick the asset to move. Only assets with a balance are listed.</p>
            <ul className="space-y-1.5">
              {assets.map((b) => {
                const active = b.asset === selected?.asset;
                const zero = isZeroWei(b.balanceWei);
                return (
                  <li key={b.asset}>
                    <button
                      type="button"
                      onClick={() => setAsset(b.asset)}
                      className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition ${active ? "border-accent bg-accent/10" : `border-border ${hoverInset}`}`}
                    >
                      <span className="flex items-center gap-2">
                        <TokenBadge symbol={b.symbol} asset={b.asset} size="sm" />
                        <span className={`text-[11px] ${soft}`}>{b.name}</span>
                      </span>
                      <span className={`font-mono text-xs tabular-nums ${zero ? "text-text-muted" : ink}`}>
                        {formatUnits(b.balanceWei, b.decimals)} {b.symbol}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {selected?.asset === NATIVE_ASSET && isZeroWei(selected.balanceWei) ? (
              <p className="text-[11px] text-warning">This wallet holds no BNB; a native transfer will be rejected at review.</p>
            ) : null}
          </div>
        ) : null}

        {step === 2 && selected ? (
          <div className="space-y-3">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs font-medium text-text-secondary">Amount ({selected.symbol})</label>
                <span className={`font-mono text-[10px] ${soft}`}>Balance {formatUnits(selected.balanceWei, selected.decimals, selected.decimals)}</span>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  value={useMax ? formatUnits(selected.balanceWei, selected.decimals, selected.decimals).replace(/,/g, "") : amount}
                  onChange={(e) => {
                    setUseMax(false);
                    setAmount(e.target.value);
                  }}
                  placeholder="0.0"
                  className={`${inputCls} ${!amountOk && amount ? "!border-danger" : ""} ${useMax ? "text-accent" : ""}`}
                  spellCheck={false}
                />
                <button type="button" onClick={() => setUseMax((v) => !v)} className={`${outlineBtn} shrink-0 ${useMax ? "bg-accent/10" : ""}`} title="Send everything (sweep)">
                  Max
                </button>
              </div>
              {useMax ? (
                <p className="mt-1 text-[11px] text-text-secondary">
                  Max sweeps the full balance{selected.asset === NATIVE_ASSET ? " minus gas" : ""}; the exact amount is computed server side.
                </p>
              ) : amount && !amountOk ? (
                <p className="mt-1 text-xs text-danger">Enter a positive number with at most {selected.decimals} decimals.</p>
              ) : null}
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs font-medium text-text-secondary">Destination</label>
                {to.trim().toLowerCase() !== pool.masterAddress.toLowerCase() ? (
                  <button type="button" className="text-[10px] font-medium text-accent hover:underline" onClick={() => setTo(pool.masterAddress)}>
                    Use master
                  </button>
                ) : (
                  <span className="text-[10px] text-success">Pool master</span>
                )}
              </div>
              <input type="text" value={to} onChange={(e) => setTo(e.target.value)} className={`${inputCls} ${!toOk && to ? "!border-danger" : ""}`} placeholder="0x…" spellCheck={false} />
              {to && !toOk ? <p className="mt-1 text-xs text-danger">Must be a 0x address with 40 hex characters.</p> : null}
            </div>
          </div>
        ) : null}

        {step === 3 && selected ? (
          <div className="space-y-3">
            <dl className={`rounded-lg border border-border p-3 ${bgInset}`}>
              <ReviewRow k="Asset" v={<TokenBadge symbol={selected.symbol} asset={selected.asset} size="sm" />} />
              <ReviewRow k="Amount" v={<span className={`font-mono ${ink}`}>{useMax ? (plan?.ok ? `${formatUnits(plan.amountWei, selected.decimals)} (all)` : "All") : amount} {selected.symbol}</span>} />
              <ReviewRow k="From" v={<AddressCell address={wallet.address} />} />
              <ReviewRow k="To" v={<AddressCell address={to.trim()} />} last />
            </dl>

            {planning ? (
              <p className={`inline-flex items-center gap-2 text-xs ${soft}`}>
                <Loader2 size={14} className="animate-spin" /> Estimating gas…
              </p>
            ) : planError ? (
              <p className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs text-danger">{planError}</p>
            ) : plan && plan.ok ? (
              <div className="space-y-2">
                <dl className="rounded-lg border border-border p-3">
                  <ReviewRow k="Gas limit" v={<span className={`font-mono ${ink}`}>{formatInt(plan.gasLimit)}</span>} />
                  <ReviewRow k="Gas price" v={<span className={`font-mono ${ink}`}>{formatGwei(plan.gasPriceWei)} gwei</span>} />
                  <ReviewRow k="Gas cost" v={<span className={`font-mono ${ink}`}>{formatBnb(plan.gasCostWei)} BNB</span>} />
                  <ReviewRow k="Wallet BNB" v={<span className={`font-mono ${ink}`}>{formatBnb(plan.childNativeWei)} BNB</span>} />
                  <ReviewRow k="Master BNB" v={<span className={`font-mono ${ink}`}>{formatBnb(plan.masterNativeWei)} BNB</span>} last />
                </dl>
                {topUp > 0n ? (
                  <div className="flex gap-2 rounded-lg border border-warning/35 bg-warning/[0.08] p-3">
                    <Fuel size={16} className="mt-0.5 shrink-0 text-warning" />
                    <div className="text-[11px] leading-relaxed">
                      <p className="font-semibold text-warning">Gas top-up from master: {formatBnb(plan.topUpWei)} BNB</p>
                      <p className="text-text-secondary">The wallet cannot pay gas itself. The master sends BNB first, then the wallet signs the transfer (two transactions).</p>
                    </div>
                  </div>
                ) : (
                  <p className={`text-[11px] ${soft}`}>No gas top-up needed; the wallet pays its own gas (one transaction).</p>
                )}
              </div>
            ) : plan && !plan.ok ? (
              <div className="flex gap-2 rounded-lg border border-danger/40 bg-danger/10 p-3">
                <AlertTriangle size={16} className="mt-0.5 shrink-0 text-danger" />
                <div className="text-[11px] leading-relaxed">
                  <p className="font-semibold text-danger">Rejected: {plan.code}</p>
                  <p className="text-text-secondary">{plan.message}</p>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      {reauthDialog}

      <JobStatusDrawer jobId={open ? jobId : null} mainnet={isMainnet(pool.network)} onClose={closeAll} />
    </>
  );
}

function Steps({ step }: { step: Step }) {
  const labels = ["Asset", "Amount & destination", "Review"];
  return (
    <ol className="mb-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider">
      {labels.map((l, i) => {
        const n = (i + 1) as Step;
        const state = n < step ? "done" : n === step ? "active" : "todo";
        return (
          <li key={l} className="flex items-center gap-2">
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] ${
                state === "done" ? "border-success text-success" : state === "active" ? "border-accent bg-accent text-white" : "border-border text-text-muted"
              }`}
            >
              {n}
            </span>
            <span className={state === "active" ? "text-accent" : state === "done" ? "text-success" : "text-text-muted"}>{l}</span>
            {i < labels.length - 1 ? <span className="h-px w-4 bg-border" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

function ReviewRow({ k, v, last = false }: { k: string; v: React.ReactNode; last?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 py-1.5 ${last ? "" : "border-b border-border/50"}`}>
      <dt className="text-text-secondary">{k}</dt>
      <dd className="text-right">{v}</dd>
    </div>
  );
}
