/**
 * Optional follow-up to "Initialize session" (admins only): turn the signing
 * wallet into a Managed Wallets pool and track the session's token in it.
 *
 * Steps: ask → details (pool name + admin password) → done.
 * The private key comes from the Setup form; it is sent once to create the
 * pool (encrypted at rest) and is never shown here.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, KeyRound, Loader2, Wallet, AlertTriangle } from "lucide-react";
import type { Network } from "@/lib/managedTypes";
import { store } from "@/lib/store";
import { managedApi } from "./client";
import Modal from "./Modal";
import TokenIcon from "./TokenIcon";
import NetworkBadge from "./NetworkBadge";
import { useImportToken } from "./AssetSelect";
import { setReauthValidUntil } from "./reauthStore";
import { apiErrorMessage, networkLabel } from "./format";
import { inputCls, outlineBtn, primaryBtn, useManagedTheme } from "./theme";

export interface SetupPoolOffer {
  privateKey: string;
  network: Network;
  tokenAddress: string;
  tokenName?: string;
  tokenSymbol?: string;
  /** Address of the signing wallet, when the Setup preview resolved it. */
  walletAddress?: string;
}

interface Props {
  offer: SetupPoolOffer | null;
  /** "Not now" or "Continue to Generate": the normal Setup flow resumes. */
  onContinue: () => void;
}

type Step = "ask" | "details" | "done";

interface Outcome {
  poolId: string;
  poolName: string;
  /** Network of the pool that was created or already existed. */
  poolNetwork: Network;
  existed: boolean;
  masterAddress: string;
  tokenStatus: "tracked" | "already" | "failed";
  tokenError?: string;
}

const short = (a: string): string => `${a.slice(0, 8)}…${a.slice(-6)}`;

export default function CreatePoolFromSetupDialog({ offer, onContinue }: Props) {
  const { ink, soft, bgInset } = useManagedTheme();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const importToken = useImportToken();
  const [step, setStep] = useState<Step>("ask");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const open = offer !== null;
  const tokenLabel = offer?.tokenSymbol || offer?.tokenName || "Token";

  useEffect(() => {
    if (!offer) return;
    setStep("ask");
    setName(`${tokenLabel} holders`.slice(0, 80));
    setPassword("");
    setBusy(false);
    setError("");
    setOutcome(null);
  }, [offer, tokenLabel]);

  async function create(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!offer || !name.trim() || !password) return;
    setBusy(true);
    setError("");
    try {
      const re = await managedApi.reauth(password);
      setReauthValidUntil(re.validUntil);
      setPassword("");

      let poolId = "";
      let poolName = name.trim();
      let masterAddress = offer.walletAddress ?? "";
      let poolNetwork: Network = offer.network;
      let existed = false;
      try {
        // A new pool every time (a key that already has pools gets the next
        // account), linked to this Setup's session so Generate fills this pool.
        const sessionId = store.getSessionId() || undefined;
        const res = await managedApi.createPool({ name: poolName, network: offer.network, privateKey: offer.privateKey, sessionId });
        poolId = res.pool.id;
        masterAddress = res.masterAddress;
      } catch (err) {
        const data = (err as { response?: { data?: { code?: string; poolId?: string; poolName?: string; masterAddress?: string; network?: Network } } }).response?.data;
        if (data?.code !== "POOL_EXISTS" || !data.poolId) throw err;
        poolId = data.poolId;
        poolName = data.poolName ?? poolName;
        masterAddress = data.masterAddress ?? masterAddress;
        poolNetwork = data.network ?? poolNetwork;
        existed = true;
      }

      let tokenStatus: Outcome["tokenStatus"] = "tracked";
      let tokenError: string | undefined;
      try {
        await importToken(offer.network, offer.tokenAddress);
      } catch (err) {
        tokenStatus = "failed";
        tokenError = apiErrorMessage(err, "Could not track the token");
      }

      void qc.invalidateQueries({ queryKey: ["managed", "pools"] });
      setOutcome({ poolId, poolName, poolNetwork, existed, masterAddress, tokenStatus, tokenError });
      setStep("done");
    } catch (err) {
      setError(apiErrorMessage(err, "Could not create the pool"));
    } finally {
      setBusy(false);
    }
  }

  function openPool(): void {
    if (!outcome || !offer) return;
    // Preselect the token only when it lives on the pool's network.
    const asset = outcome.tokenStatus !== "failed" && outcome.poolNetwork === offer.network ? `?asset=${offer.tokenAddress.toLowerCase()}` : "";
    navigate(`/admin/managed/pools/${outcome.poolId}${asset}`);
  }

  const summary = offer ? (
    <dl className={`space-y-2 rounded-lg border border-border p-3 text-[11px] ${bgInset}`}>
      <div className="flex items-center justify-between gap-3">
        <dt className={soft}>Master wallet</dt>
        <dd className={`inline-flex items-center gap-1.5 font-mono ${ink}`}>
          <Wallet size={12} aria-hidden />
          {offer.walletAddress ? short(offer.walletAddress) : "your signing wallet"}
        </dd>
      </div>
      <div className="flex items-center justify-between gap-3">
        <dt className={soft}>Network</dt>
        <dd>
          <NetworkBadge network={offer.network} compact />
        </dd>
      </div>
      <div className="flex items-center justify-between gap-3">
        <dt className={soft}>Token</dt>
        <dd className={`inline-flex items-center gap-1.5 ${ink}`}>
          <TokenIcon asset={offer.tokenAddress} symbol={tokenLabel} size={18} />
          <span className="font-semibold">{tokenLabel}</span>
          <span className={`font-mono ${soft}`}>{short(offer.tokenAddress)}</span>
        </dd>
      </div>
    </dl>
  ) : null;

  return (
    <Modal
      open={open}
      title={step === "done" ? (outcome?.existed ? "Pool already exists" : "Pool ready") : "Create a Managed Wallets pool for this wallet?"}
      subtitle={
        step === "done"
          ? undefined
          : "Optional. Your session is saved either way; this only adds a pool you can hand addresses out from and sweep back."
      }
      onClose={busy ? undefined : onContinue}
      size="md"
      footer={
        step === "ask" ? (
          <>
            <button type="button" className={outlineBtn} onClick={onContinue}>
              Not now
            </button>
            <button type="button" className={primaryBtn} onClick={() => setStep("details")}>
              Yes, set it up <ArrowRight size={14} />
            </button>
          </>
        ) : step === "details" ? (
          <>
            <button type="button" className={outlineBtn} onClick={() => setStep("ask")} disabled={busy}>
              Back
            </button>
            <button type="submit" form="setup-pool-form" className={primaryBtn} disabled={busy || !name.trim() || !password}>
              {busy ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Creating…
                </>
              ) : (
                <>
                  <KeyRound size={14} /> Create pool
                </>
              )}
            </button>
          </>
        ) : (
          <>
            <button type="button" className={outlineBtn} onClick={onContinue}>
              Continue to Generate
            </button>
            <button type="button" className={primaryBtn} onClick={openPool}>
              Open pool <ArrowRight size={14} />
            </button>
          </>
        )
      }
    >
      {step === "ask" ? (
        <div className="space-y-3">
          {summary}
          <ul className={`space-y-1 text-[11px] ${soft}`}>
            <li>• The signing wallet you entered becomes the pool master: sweeps arrive there and gas top-ups come from it.</li>
            <li>• Managed wallets are derived from the same private key, so that key stays their only backup.</li>
            <li>• Each pool you create here is a new pool: if this key already has pools, the new one gets its own wallet addresses.</li>
            <li>• {tokenLabel} is added to the pool's token list so its balances show everywhere.</li>
            <li>• Generate then creates this session's wallets inside the pool, so the tokens you distribute show there and the master can sweep them back.</li>
          </ul>
        </div>
      ) : null}

      {step === "details" ? (
        <form id="setup-pool-form" onSubmit={(e) => void create(e)} className="space-y-3">
          {summary}
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Pool name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={inputCls} autoFocus />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Your admin password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className={inputCls}
              placeholder="Confirms it is you before the key is stored"
            />
            <p className={`mt-1 text-[11px] ${soft}`}>
              The private key from Signing wallet is sent once over HTTPS and stored encrypted. It is never shown here.
            </p>
          </div>
          {error ? <p className="text-xs text-danger">{error}</p> : null}
        </form>
      ) : null}

      {step === "done" && outcome && offer ? (
        <div className="space-y-3">
          <div className={`flex gap-2 rounded-lg border p-3 text-xs ${outcome.existed ? "border-warning/40 bg-warning/[0.08]" : "border-success/40 bg-success/[0.08]"}`}>
            {outcome.existed ? <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" /> : <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" />}
            <p className={ink}>
              {outcome.existed ? (
                <>
                  This wallet already has a pool, <span className="font-semibold">“{outcome.poolName}”</span>. One wallet can back only one pool, so
                  nothing new was created.
                </>
              ) : (
                <>
                  Pool <span className="font-semibold">“{outcome.poolName}”</span> created on {networkLabel(offer.network)} with master{" "}
                  <span className="font-mono">{outcome.masterAddress ? short(outcome.masterAddress) : "your wallet"}</span>.
                </>
              )}
            </p>
          </div>
          <div className={`flex items-start gap-2 rounded-lg border border-border p-3 text-xs ${bgInset}`}>
            <TokenIcon asset={offer.tokenAddress} symbol={tokenLabel} size={18} />
            <p className={ink}>
              {outcome.tokenStatus === "failed" ? (
                <span className="text-warning">
                  {tokenLabel} could not be tracked on {networkLabel(offer.network)}: {outcome.tokenError}. You can import it later from the token dropdown.
                </span>
              ) : (
                <>
                  {tokenLabel} is tracked on {networkLabel(offer.network)}
                  {outcome.poolNetwork === offer.network
                    ? "; the pool opens with it selected."
                    : `. That pool is on ${networkLabel(outcome.poolNetwork)}, so ${tokenLabel} will not appear in it.`}
                </>
              )}
            </p>
          </div>
          <p className={`text-[11px] ${soft}`}>
            {outcome.poolNetwork === offer.network
              ? "Next: Continue to Generate. “Pool wallets” is preselected, so this session's wallets are created in the pool and the tokens you distribute show up there."
              : "Generate cannot use that pool for this session because it is on another network; the session keeps the normal wallet modes."}
          </p>
        </div>
      ) : null}
    </Modal>
  );
}
