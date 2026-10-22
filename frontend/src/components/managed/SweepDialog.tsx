import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ArrowLeft, ArrowRight, Loader2, Layers, CheckCircle, AlertTriangle } from "lucide-react";
import { NATIVE_ASSET, type Asset, type Network, type TransferStatus } from "@/lib/managedTypes";
import AddressCell from "@/components/ui/AddressCell";
import StatusBadge from "@/components/ui/StatusBadge";
import TxHashLink from "@/components/ui/TxHashLink";
import ProgressBar from "@/components/ui/ProgressBar";
import { managedApi } from "./client";
import { apiErrorMessage, badgeStatus, formatUnits, isMainnet, isTerminalStatus, isValidAddress, isZeroWei, nativeSymbol, newIdempotencyKey } from "./format";
import Modal from "./Modal";
import TokenBadge from "./TokenBadge";
import TokenIcon from "./TokenIcon";
import { useReauth } from "./ReauthDialog";
import { inputCls, outlineBtn, primaryBtn, useManagedTheme } from "./theme";

interface SweepDialogProps {
  open: boolean;
  poolId: string;
  masterAddress: string;
  network: Network;
  /** Row selection from the wallet table (may be empty). */
  selectedWalletIds: string[];
  /** Token chosen in the page's selector; when set, the dialog starts on "Pick" with it ticked. */
  initialAsset?: Asset | null;
  onClose: () => void;
}

type Step = 1 | 2;
const BATCH_POLL_MS = 5000;
const SCAN_LIMIT = 500;

/**
 * F8 / Flow 6: wallets (all with balance / selected) → assets (all discovered / pick)
 * → destination → review (job count) → re-auth → POST /transfers/sweep → batch progress.
 */
export default function SweepDialog({ open, poolId, masterAddress, network, selectedWalletIds, initialAsset = null, onClose }: SweepDialogProps) {
  const { ink, soft, bgInset, hoverInset, rowZebra } = useManagedTheme();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>(1);
  const [walletMode, setWalletMode] = useState<"ALL" | "SELECTED">("ALL");
  const [assetMode, setAssetMode] = useState<"ALL" | "PICK">("ALL");
  const [picked, setPicked] = useState<Set<Asset>>(new Set());
  const [to, setTo] = useState(masterAddress);
  const [submitting, setSubmitting] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [created, setCreated] = useState<{ jobs: number; skipped: number } | null>(null);
  const idemRef = useRef("");
  const { withReauth, reauthDialog } = useReauth("Sweeps move funds out of many managed wallets at once.");

  useEffect(() => {
    if (open) {
      setStep(1);
      setWalletMode(selectedWalletIds.length > 0 ? "SELECTED" : "ALL");
      setAssetMode(initialAsset ? "PICK" : "ALL");
      setPicked(new Set(initialAsset ? [initialAsset] : []));
      setTo(masterAddress);
      setSubmitting(false);
      setBatchId(null);
      setCreated(null);
      idemRef.current = newIdempotencyKey();
    }
  }, [open, masterAddress, selectedWalletIds.length, initialAsset]);

  // Discovered + tracked tokens on this network for the asset picker.
  const { data: tokensData } = useQuery({
    queryKey: ["managed", "tokens", network],
    queryFn: () => managedApi.listTokens({ network }),
    enabled: open,
    staleTime: 30_000,
  });
  const assetChoices = useMemo(
    () => [
      { asset: NATIVE_ASSET, symbol: nativeSymbol(network), name: "BNB" },
      ...(tokensData?.tokens ?? [])
        .filter((t) => !t.hidden)
        .map((t) => ({ asset: t.tokenAddress.toLowerCase(), symbol: t.symbol, name: t.name }))
        .sort((a, b) => a.symbol.localeCompare(b.symbol)),
    ],
    [tokensData, network]
  );

  // Client-side estimate of the (wallet, asset) pairs the sweep will create.
  const { data: walletsData, isLoading: scanning } = useQuery({
    queryKey: ["managed", "wallets", poolId, "sweep-scan"],
    queryFn: () => managedApi.listWallets(poolId, { skip: 0, limit: SCAN_LIMIT }),
    enabled: open && step === 2 && !batchId,
    staleTime: 10_000,
  });
  const estimate = useMemo(() => {
    if (!walletsData) return null;
    const sel = new Set(selectedWalletIds);
    let pairs = 0;
    let wallets = 0;
    for (const w of walletsData.wallets) {
      if (walletMode === "SELECTED" && !sel.has(w.id)) continue;
      let held = false;
      for (const b of w.balances) {
        if (b.hidden || isZeroWei(b.balanceWei)) continue;
        if (assetMode === "PICK" && !picked.has(b.asset)) continue;
        pairs += 1;
        held = true;
      }
      if (held) wallets += 1;
    }
    return { pairs, wallets, truncated: walletsData.total > walletsData.wallets.length };
  }, [walletsData, walletMode, assetMode, picked, selectedWalletIds]);

  // Batch progress after creation.
  const { data: batch } = useQuery({
    queryKey: ["managed", "transfers", "batch", batchId],
    queryFn: () => managedApi.listTransfers({ batchId: batchId as string, limit: 200 }),
    enabled: Boolean(batchId),
    refetchInterval: (q) => {
      const jobs = q.state.data?.jobs;
      if (!jobs) return BATCH_POLL_MS;
      return jobs.every((j) => isTerminalStatus(j.status)) ? false : BATCH_POLL_MS;
    },
  });

  const toOk = isValidAddress(to);
  const assetsOk = assetMode === "ALL" || picked.size > 0;
  const walletsOk = walletMode === "ALL" || selectedWalletIds.length > 0;

  function submit(): void {
    withReauth(async () => {
      setSubmitting(true);
      try {
        const res = await managedApi.createSweep({
          poolId,
          walletIds: walletMode === "ALL" ? "ALL" : selectedWalletIds,
          assets: assetMode === "ALL" ? "ALL" : [...picked],
          toAddress: to.trim().toLowerCase() === masterAddress.toLowerCase() ? undefined : to.trim(),
          idempotencyKey: idemRef.current,
        });
        setCreated({ jobs: res.jobs, skipped: res.skipped });
        setBatchId(res.batchId);
        toast.success(`Sweep queued: ${res.jobs} job${res.jobs === 1 ? "" : "s"}`);
        void qc.invalidateQueries({ queryKey: ["managed"] });
      } catch (err) {
        toast.error(apiErrorMessage(err, "Sweep failed"));
      } finally {
        setSubmitting(false);
      }
    });
  }

  function closeAll(): void {
    void qc.invalidateQueries({ queryKey: ["managed"] });
    onClose();
  }

  const byStatus = batch?.byStatus ?? {};
  const total = batch?.total ?? created?.jobs ?? 0;
  const done = (byStatus.CONFIRMED ?? 0) + (byStatus.FAILED ?? 0) + (byStatus.CANCELLED ?? 0);
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;
  const allDone = total > 0 && done >= total;
  const mainnet = isMainnet(network);

  return (
    <>
      <Modal
        open={open}
        title={batchId ? "Sweep in progress" : "Sweep to master"}
        subtitle={batchId ? `Batch ${batchId.slice(0, 8)} · one job per wallet × asset; failures are isolated.` : "Move balances from many managed wallets into one destination."}
        onClose={submitting ? undefined : closeAll}
        size="lg"
        footer={
          batchId ? (
            <button type="button" className={primaryBtn} onClick={closeAll}>
              {allDone ? "Done" : "Close (keeps running)"}
            </button>
          ) : (
            <>
              {step === 2 ? (
                <button type="button" className={outlineBtn} onClick={() => setStep(1)} disabled={submitting}>
                  <ArrowLeft size={14} /> Back
                </button>
              ) : (
                <button type="button" className={outlineBtn} onClick={closeAll}>
                  Cancel
                </button>
              )}
              {step === 1 ? (
                <button type="button" className={primaryBtn} onClick={() => setStep(2)} disabled={!toOk || !assetsOk || !walletsOk}>
                  Review <ArrowRight size={14} />
                </button>
              ) : (
                <button type="button" className={primaryBtn} onClick={submit} disabled={submitting || (estimate !== null && estimate.pairs === 0 && !estimate.truncated)}>
                  {submitting ? (
                    <>
                      <Loader2 size={14} className="animate-spin" /> Queuing…
                    </>
                  ) : (
                    <>
                      <Layers size={14} /> Start sweep
                    </>
                  )}
                </button>
              )}
            </>
          )
        }
      >
        {!batchId && step === 1 ? (
          <div className="space-y-4">
            <section>
              <p className="dash-section-title mb-1.5">Wallets</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Choice active={walletMode === "ALL"} onClick={() => setWalletMode("ALL")} hover={hoverInset} title="All with a balance" desc="Every wallet in the pool holding any asset." ink={ink} soft={soft} />
                <Choice
                  active={walletMode === "SELECTED"}
                  onClick={() => setWalletMode("SELECTED")}
                  disabled={selectedWalletIds.length === 0}
                  hover={hoverInset}
                  title={`Selected rows (${selectedWalletIds.length})`}
                  desc={selectedWalletIds.length ? "Only the wallets ticked in the table." : "Tick rows in the table first."}
                  ink={ink}
                  soft={soft}
                />
              </div>
            </section>
            <section>
              <p className="dash-section-title mb-1.5">Assets</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Choice active={assetMode === "ALL"} onClick={() => setAssetMode("ALL")} hover={hoverInset} title="All assets" desc="BNB plus every tracked token (USDT, USDC, ETH…) these wallets hold." ink={ink} soft={soft} />
                <Choice active={assetMode === "PICK"} onClick={() => setAssetMode("PICK")} hover={hoverInset} title="Pick assets" desc="Choose which assets to sweep." ink={ink} soft={soft} />
              </div>
              {assetMode === "PICK" ? (
                <div className={`mt-2 flex flex-wrap gap-1.5 rounded-lg border border-border p-2 ${bgInset}`}>
                  {assetChoices.map((a) => {
                    const on = picked.has(a.asset);
                    return (
                      <button
                        key={a.asset}
                        type="button"
                        onClick={() =>
                          setPicked((prev) => {
                            const n = new Set(prev);
                            if (n.has(a.asset)) n.delete(a.asset);
                            else n.add(a.asset);
                            return n;
                          })
                        }
                        className={`inline-flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 text-[11px] font-mono transition ${on ? "border-accent bg-accent/15 text-accent" : `border-border ${soft} ${hoverInset}`}`}
                        title={a.asset === NATIVE_ASSET ? a.name : `${a.name} · ${a.asset}`}
                        aria-pressed={on}
                      >
                        <TokenIcon asset={a.asset} symbol={a.symbol} size={18} />
                        {a.symbol}
                      </button>
                    );
                  })}
                  {assetChoices.length <= 1 ? <span className={`text-[11px] ${soft}`}>Loading tokens…</span> : null}
                </div>
              ) : null}
            </section>
            <section>
              <div className="mb-1 flex items-center justify-between">
                <p className="dash-section-title">Destination</p>
                {to.trim().toLowerCase() !== masterAddress.toLowerCase() ? (
                  <button type="button" className="text-[10px] font-medium text-accent hover:underline" onClick={() => setTo(masterAddress)}>
                    Use master
                  </button>
                ) : (
                  <span className="text-[10px] text-success">Pool master</span>
                )}
              </div>
              <input type="text" value={to} onChange={(e) => setTo(e.target.value)} className={`${inputCls} ${!toOk && to ? "!border-danger" : ""}`} spellCheck={false} />
              {to && !toOk ? <p className="mt-1 text-xs text-danger">Must be a 0x address with 40 hex characters.</p> : null}
            </section>
          </div>
        ) : null}

        {!batchId && step === 2 ? (
          <div className="space-y-3">
            <dl className={`rounded-lg border border-border p-3 ${bgInset}`}>
              <Row k="Wallets" v={<span className={ink}>{walletMode === "ALL" ? "All with a balance" : `${selectedWalletIds.length} selected`}</span>} />
              <Row
                k="Assets"
                v={
                  assetMode === "ALL" ? (
                    <span className={ink}>All discovered</span>
                  ) : (
                    <span className="inline-flex flex-wrap justify-end gap-1">
                      {[...picked].map((a) => {
                        const c = assetChoices.find((x) => x.asset === a);
                        return <TokenBadge key={a} symbol={c?.symbol ?? a.slice(0, 8)} asset={a} />;
                      })}
                    </span>
                  )
                }
              />
              <Row k="Destination" v={<AddressCell address={to.trim()} />} />
              <Row
                k="Jobs to create"
                v={
                  scanning ? (
                    <span className={`inline-flex items-center gap-1 ${soft}`}>
                      <Loader2 size={12} className="animate-spin" /> counting…
                    </span>
                  ) : estimate ? (
                    <span className={`font-mono ${ink}`}>
                      ~{estimate.pairs} <span className={`text-[10px] ${soft}`}>({estimate.wallets} wallets{estimate.truncated ? `, first ${SCAN_LIMIT} scanned` : ""})</span>
                    </span>
                  ) : (
                    <span className={soft}>—</span>
                  )
                }
              />
              <Row k="Estimated gas" v={<span className={soft}>Computed per job by the planner; gas top-ups come from the master wallet.</span>} last />
            </dl>
            {estimate && estimate.pairs === 0 && !estimate.truncated ? (
              <p className="flex items-center gap-2 text-xs text-warning">
                <AlertTriangle size={14} /> Nothing to sweep with this selection.
              </p>
            ) : (
              <p className={`text-[11px] leading-relaxed ${soft}`}>
                One job per wallet × asset under a single batch id. Jobs run one at a time; a failing job does not block the others. Native BNB sweeps leave gas behind.
              </p>
            )}
          </div>
        ) : null}

        {batchId ? (
          <div className="space-y-3">
            <div className={`rounded-lg border border-border p-3 ${bgInset}`}>
              <div className="flex items-center justify-between text-[11px]">
                <span className={ink}>
                  {done} / {total} finished
                </span>
                <span className={soft}>{created ? `${created.skipped} pair${created.skipped === 1 ? "" : "s"} skipped (zero or hidden)` : ""}</span>
              </div>
              <ProgressBar value={progress} className="mt-2" color={allDone && (byStatus.FAILED ?? 0) === 0 ? "bg-success" : "bg-accent"} />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(["PENDING", "FUNDING_GAS", "SENDING", "CONFIRMED", "FAILED", "CANCELLED"] as TransferStatus[]).map((s) => (
                  <span key={s} className={`rounded-full border border-border px-2 py-0.5 font-mono text-[10px] ${byStatus[s] ? ink : "text-text-muted"}`}>
                    {s} <span className="font-semibold">{byStatus[s] ?? 0}</span>
                  </span>
                ))}
              </div>
              {allDone ? (
                <p className={`mt-2 inline-flex items-center gap-1.5 text-[11px] ${(byStatus.FAILED ?? 0) > 0 ? "text-warning" : "text-success"}`}>
                  <CheckCircle size={12} /> Batch finished{(byStatus.FAILED ?? 0) > 0 ? ` with ${byStatus.FAILED} failed job(s); retry them from the Transfers tab.` : "."}
                </p>
              ) : null}
            </div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="border-b border-border">
                    {["Status", "Wallet", "Asset", "Amount", "Top-up", "Transfer"].map((h) => (
                      <th key={h} className={`px-3 py-2 text-left text-[10px] font-normal uppercase tracking-widest ${soft}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(batch?.jobs ?? []).map((j, i) => (
                    <tr key={j.id} className={`border-b border-border/50 ${i % 2 ? rowZebra : ""}`}>
                      <td className="px-3 py-1.5">
                        <StatusBadge status={badgeStatus(j.status)} />
                      </td>
                      <td className="px-3 py-1.5">
                        <AddressCell address={j.walletAddress} />
                      </td>
                      <td className="px-3 py-1.5">
                        <TokenBadge symbol={j.symbol} asset={j.asset} />
                      </td>
                      <td className={`px-3 py-1.5 tabular-nums ${ink}`}>{formatUnits(j.amountWei, j.decimals)}</td>
                      <td className="px-3 py-1.5">
                        <TxHashLink hash={j.gasTopupTxHash} mainnet={mainnet} />
                      </td>
                      <td className="px-3 py-1.5">
                        <TxHashLink hash={j.transferTxHash} mainnet={mainnet} />
                        {j.status === "FAILED" && j.error ? <p className="mt-0.5 max-w-[220px] truncate text-[10px] text-danger" title={j.error}>{j.error}</p> : null}
                      </td>
                    </tr>
                  ))}
                  {!batch ? (
                    <tr>
                      <td colSpan={6} className={`px-3 py-6 text-center text-[11px] ${soft}`}>
                        Loading batch…
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </Modal>
      {reauthDialog}
    </>
  );
}

function Choice({ active, onClick, disabled = false, title, desc, hover, ink, soft }: { active: boolean; onClick: () => void; disabled?: boolean; title: string; desc: string; hover: string; ink: string; soft: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${active ? "border-accent bg-accent/10" : `border-border ${hover}`}`}
    >
      <p className={`text-xs font-semibold ${active ? "text-accent" : ink}`}>{title}</p>
      <p className={`mt-0.5 text-[11px] ${soft}`}>{desc}</p>
    </button>
  );
}

function Row({ k, v, last = false }: { k: string; v: React.ReactNode; last?: boolean }) {
  return (
    <div className={`flex items-start justify-between gap-3 py-1.5 ${last ? "" : "border-b border-border/50"}`}>
      <dt className="shrink-0 text-text-secondary">{k}</dt>
      <dd className="text-right">{v}</dd>
    </div>
  );
}
