import { useState, useEffect, type ReactNode } from "react";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  Eye, EyeOff, CheckCircle, AlertCircle,
  RefreshCw, Loader2, Zap, ChevronDown, ChevronUp, Lock,
} from "lucide-react";
import { configApi, deployApi, sessionsApi, walletApi } from "@/lib/api";
import { store } from "@/lib/store";
import { isValidPrivateKey } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/theme/ThemeProvider";

type Network = "bscMainnet" | "bscTestnet";

const NETWORKS: { value: Network; label: string; chainId: string; color: string }[] = [
  { value: "bscMainnet", label: "BNB Mainnet",  chainId: "56",   color: "text-warning" },
  { value: "bscTestnet", label: "BNB Testnet",  chainId: "97",   color: "text-accent"  },
];
const SETUP_DRAFT_KEY = "setupDraft";

function isValidAddress(v: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(v.trim());
}

function maskPrivateKey(v: string): string {
  const raw = v.startsWith("0x") ? v : `0x${v}`;
  if (raw.length <= 14) return "********";
  return `${raw.slice(0, 8)}...${raw.slice(-4)}`;
}

function shortAddress(v: string): string {
  const t = v.trim();
  if (t.length < 12) return t;
  return `${t.slice(0, 8)}...${t.slice(-6)}`;
}

function RpcLine({ label, value }: { label: string; value?: string }) {
  const { theme } = useTheme();
  const ink = theme === "dark" ? "text-[#fafafa]" : "text-[#282828]";
  const ok = Boolean(value?.trim());
  return (
    <p className={`break-all font-mono text-[11px] leading-relaxed ${ink}`}>
      <span className="text-text-secondary">{label}: </span>
      {ok ? value : <span className="text-danger">Not set</span>}
    </p>
  );
}

const setupInput = "app-input dash-input font-mono py-2 text-sm";

function DashSection({
  code,
  title,
  hint,
  children,
}: {
  code: string;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <header className="border-b border-[var(--app-border)] pb-2">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-accent">{code}</p>
        <h2 className="mt-0.5 text-sm font-semibold tracking-tight text-[var(--app-text)] sm:text-base">{title}</h2>
        {hint ? (
          <p className="mt-0.5 text-[11px] leading-snug text-[var(--app-text-secondary)]">{hint}</p>
        ) : null}
      </header>
      {children}
    </section>
  );
}

export default function SetupPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, subscription } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  /** Primary body/heading ink — matches theme toggle (avoids faint `text-text-primary` on tinted cards in light). */
  const ink = isDark ? "text-[#fafafa]" : "text-[#282828]";
  /** Backgrounds for inset / raised blocks — same source as `ink` so light mode never shows dark panels. */
  const bgInset = isDark ? "bg-[#1e293b]" : "bg-[#f4f4f5]";
  const bgCell = isDark ? "bg-[#111827]" : "bg-white";
  const hoverInset = isDark ? "hover:bg-[#334155]" : "hover:bg-[#e2e8f0]";

  // ── Form state ──────────────────────────────────────────────────────────────
  const [privateKey, setPrivateKey]         = useState("");
  const [showKey, setShowKey]               = useState(false);
  const [tokenAddress, setTokenAddress]     = useState("");
  const [totalWallets, setTotalWallets]     = useState(100);
  const [totalWalletsInput, setTotalWalletsInput] = useState("100");

  // ── MultiSender deploy state ─────────────────────────────────────────────
  const [selectedNetwork, setSelectedNetwork] = useState<Network>("bscMainnet");
  const [deploying, setDeploying]             = useState(false);
  const [deployedAddress, setDeployedAddress] = useState("");   // set after deploy
  const [deployNetwork, setDeployNetwork]     = useState("");   // network label after deploy
  const [showManualInput, setShowManualInput] = useState(false); // toggle for manual override
  const [manualAddress, setManualAddress]     = useState("");

  // ── Validation errors ───────────────────────────────────────────────────
  const [pkError, setPkError]   = useState("");
  const [taError, setTaError]   = useState("");
  const [msError, setMsError]   = useState("");  // manual address error
  const [loading, setLoading]   = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // ── The effective multisender address used when creating session ─────────
  const multisenderAddress = showManualInput ? manualAddress : deployedAddress;
  const hasActivePlan = subscription?.status === "ACTIVE";
  const canUseSetup = hasActivePlan || user?.role === "ADMIN";
  const selectedNetworkLabel = NETWORKS.find((n) => n.value === selectedNetwork)?.label ?? "Unknown";

  // ── Load RPC config + pre-deployed address from backend ─────────────────
  const { data: config, isLoading: configLoading, error: configError, refetch: refetchConfig } = useQuery({
    queryKey: ["config"],
    queryFn: () => configApi.get().then((r) => r.data),
    retry: 1,
  });
  const selectedPrimaryRpc = selectedNetwork === "bscTestnet" ? (config?.testnetRpcUrl ?? "") : (config?.rpcUrl ?? "");

  // Auto-fill deployed address from output/deployments.json
  useEffect(() => {
    if (config?.multisenderAddress && !deployedAddress) {
      setDeployedAddress(config.multisenderAddress);
      setDeployNetwork(config.deploymentInfo?.network ?? "");
    }
  }, [config]);

  // Restore draft on first load
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SETUP_DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as {
        privateKey?: string;
        tokenAddress?: string;
        totalWallets?: number;
        selectedNetwork?: Network;
        deployedAddress?: string;
        deployNetwork?: string;
        showManualInput?: boolean;
        manualAddress?: string;
      };
      if (draft.privateKey) setPrivateKey(draft.privateKey);
      if (draft.tokenAddress) setTokenAddress(draft.tokenAddress);
      if (draft.totalWallets && Number.isFinite(draft.totalWallets)) setTotalWallets(draft.totalWallets);
      if (draft.selectedNetwork) setSelectedNetwork(draft.selectedNetwork);
      if (draft.deployedAddress) setDeployedAddress(draft.deployedAddress);
      if (draft.deployNetwork) setDeployNetwork(draft.deployNetwork);
      if (typeof draft.showManualInput === "boolean") setShowManualInput(draft.showManualInput);
      if (draft.manualAddress) setManualAddress(draft.manualAddress);
    } catch {
      // ignore corrupt draft
    }
  }, []);

  // Persist draft whenever key fields change
  useEffect(() => {
    const draft = {
      privateKey,
      tokenAddress,
      totalWallets,
      selectedNetwork,
      deployedAddress,
      deployNetwork,
      showManualInput,
      manualAddress,
    };
    sessionStorage.setItem(SETUP_DRAFT_KEY, JSON.stringify(draft));
  }, [
    privateKey,
    tokenAddress,
    totalWallets,
    selectedNetwork,
    deployedAddress,
    deployNetwork,
    showManualInput,
    manualAddress,
  ]);

  useEffect(() => {
    setTotalWalletsInput(String(totalWallets));
  }, [totalWallets]);

  const pkForPreview = privateKey.trim();
  const tokenForPreview = tokenAddress.trim();
  const canPreview = isValidPrivateKey(pkForPreview) && isValidAddress(tokenForPreview);

  const {
    data: walletPreview,
    isFetching: previewLoading,
    error: previewError,
  } = useQuery({
    queryKey: ["wallet-preview", pkForPreview, tokenForPreview, selectedNetwork],
    queryFn: () =>
      walletApi
        .preview(
          pkForPreview.startsWith("0x") ? pkForPreview : `0x${pkForPreview}`,
          tokenForPreview,
          selectedNetwork
        )
        .then((r) => r.data),
    enabled: canPreview,
    retry: 0,
    refetchOnWindowFocus: false,
  });

  const requiredMin = totalWallets * 1;
  const requiredAvg = Math.round(totalWallets * 50.5);
  const requiredMax = totalWallets * 100;
  const tokenBalanceNum = Number(walletPreview?.token?.balance ?? "0");
  const hasEnoughForMax = tokenBalanceNum >= requiredMax;
  const tokenNameRaw = walletPreview?.token?.name;
  const tokenName =
    typeof tokenNameRaw === "string" && tokenNameRaw.trim()
      ? tokenNameRaw.trim()
      : "Unknown Token";

  function handleWalletsNumberChange(v: string): void {
    setTotalWalletsInput(v);
    const parsed = Number(v);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.min(100_000, Math.max(1, Math.floor(parsed)));
    setTotalWallets(clamped);
  }

  // ── Validation helpers ──────────────────────────────────────────────────
  function validatePrivateKey(v: string) {
    if (!v.trim())                    { setPkError("Private key is required"); return false; }
    if (!isValidPrivateKey(v.trim())) { setPkError("Invalid — must be 64 hex chars (with or without 0x)"); return false; }
    setPkError(""); return true;
  }
  function validateTokenAddress(v: string) {
    if (!v.trim())          { setTaError("Token address is required"); return false; }
    if (!isValidAddress(v)) { setTaError("Invalid address (0x + 40 hex chars)"); return false; }
    setTaError(""); return true;
  }
  function validateManualAddress(v: string) {
    if (!v.trim())          { setMsError("MultiSender address is required"); return false; }
    if (!isValidAddress(v)) { setMsError("Invalid address (0x + 40 hex chars)"); return false; }
    setMsError(""); return true;
  }

  // ── Deploy MultiSender ──────────────────────────────────────────────────
  async function handleDeploy() {
    if (!validatePrivateKey(privateKey)) {
      toast.error("Enter your Private Key first — it is needed to pay for deployment gas");
      return;
    }

    const pk = privateKey.trim();
    const netLabel = NETWORKS.find((n) => n.value === selectedNetwork)?.label ?? selectedNetwork;

    setDeploying(true);
    const toastId = toast.loading(`Deploying MultiSender to ${netLabel}... (may take 30–60s)`);

    try {
      const { data } = await deployApi.multisender(
        pk.startsWith("0x") ? pk : `0x${pk}`,
        selectedNetwork
      );
      setDeployedAddress(data.address);
      setDeployNetwork(netLabel);
      setShowManualInput(false); // switch back to deployed view
      toast.success(`Deployed! ${data.address.slice(0, 10)}...${data.address.slice(-6)}`, { id: toastId });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "Deployment failed. Check that your wallet has enough BNB for gas.";
      toast.error(msg, { id: toastId, duration: 8000 });
    } finally {
      setDeploying(false);
    }
  }

  // ── Create session ───────────────────────────────────────────────────────
  function validateAllInputs(): boolean {
    const pkOk = validatePrivateKey(privateKey);
    const taOk = validateTokenAddress(tokenAddress);

    // Must have a multisender address — either deployed or manual
    let msOk = true;
    if (!multisenderAddress) {
      msOk = false;
      if (showManualInput) {
        validateManualAddress(manualAddress);
      } else {
        toast.error("Deploy the MultiSender contract first, or toggle 'Use existing address'");
      }
    } else if (showManualInput) {
      msOk = validateManualAddress(manualAddress);
    }

    return pkOk && taOk && msOk;
  }

  async function createSession() {
    setLoading(true);
    try {
      const existingSessionId = store.getSessionId();
      let sessionId = existingSessionId;
      if (existingSessionId) {
        try {
          await sessionsApi.patch(existingSessionId, {
            totalWallets,
            network: selectedNetwork,
            tokenAddress: tokenAddress.trim(),
            tokenName,
            multisenderAddress: multisenderAddress.trim(),
          });
          toast.success(`Session updated — ID: ${existingSessionId.slice(-8)}`);
        } catch {
          // If old session was deleted/not found, create fresh one.
          const { data } = await sessionsApi.create(
            totalWallets,
            selectedNetwork,
            tokenAddress.trim(),
            tokenName,
            multisenderAddress.trim()
          );
          sessionId = data.sessionId;
          toast.success(`Session created — ID: ${data.sessionId.slice(-8)}`);
        }
      } else {
        const { data } = await sessionsApi.create(
          totalWallets,
          selectedNetwork,
          tokenAddress.trim(),
          tokenName,
          multisenderAddress.trim()
        );
        sessionId = data.sessionId;
        toast.success(`Session created — ID: ${data.sessionId.slice(-8)}`);
      }
      if (!sessionId) throw new Error("Unable to resolve session id");

      /** Drop cached status/wallets/batches so Generate/Plan/Distribute never flash the previous run. */
      const idsToClear = new Set([sessionId, existingSessionId].filter(Boolean));
      for (const id of idsToClear) {
        qc.removeQueries({
          predicate: (q) => Array.isArray(q.queryKey) && q.queryKey.includes(id),
        });
      }

      store.setSessionId(sessionId);

      const pk = privateKey.trim();
      store.setPrivateKey(pk.startsWith("0x") ? pk : `0x${pk}`);
      navigate("/dashboard/generate");
    } catch {
      toast.error("Failed to create session");
    } finally {
      setLoading(false);
      setShowConfirm(false);
    }
  }

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    if (!validateAllInputs()) return;
    setShowConfirm(true);
  }

  const rpcOk = config?.rpcUrl;
  const pkValid = isValidPrivateKey(pkForPreview);
  const tokenValid = isValidAddress(tokenForPreview);
  const msReady = Boolean(multisenderAddress?.trim());
  const activeSessionId = store.getSessionId();
  const sessionIdLabel =
    activeSessionId.length === 0
      ? "None (creates on confirm)"
      : activeSessionId.length > 22
        ? `${activeSessionId.slice(0, 12)}…${activeSessionId.slice(-4)}`
        : activeSessionId;

  useBodyScrollLock(showConfirm);

  return (
    <div className="relative mx-auto max-w-[1400px] px-3 pb-10 sm:px-5">
      <header className="border-b border-border/80 pb-5">
        <h1
          className={`font-display text-2xl font-semibold tracking-tight md:text-3xl ${
            isDark ? "text-[#fafafa]" : "text-[#282828]"
          }`}
        >
          Initialize session
        </h1>
        <p
          className={`mt-2 max-w-2xl text-sm font-normal leading-relaxed text-[var(--app-text-secondary)]`}
        >
          Deploy MultiSender, set your token, then scale holder wallets—dashboard layout below.
        </p>
      </header>

      <form
        id="setup-session-form"
        onSubmit={handleStart}
        className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-start"
      >
        <div className="min-w-0 space-y-5 lg:col-span-8 lg:space-y-6">
        {!canUseSetup && (
          <div className="dash-card flex gap-3 border-warning/35 bg-warning/[0.08] p-4 sm:p-5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-warning/20 text-warning">
              <Lock className="h-4 w-4" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-warning">Read-only mode</p>
              <p className="mt-1 text-xs leading-relaxed text-text-secondary">
                You can explore the dashboard, but setup and execution are locked until payment.
              </p>
              <button
                type="button"
                onClick={() => navigate("/onboarding")}
                className="btn-gradient-primary mt-3 justify-center px-4 py-2 text-xs font-medium"
              >
                Pay to unlock
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
          <DashSection code="01" title="RPC Setup" hint="Confirm endpoints for the chain you will use.">
            <div className="dash-card px-4 py-3 sm:px-5 sm:py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="dash-section-title">RPC configuration</span>
                <div className="flex flex-wrap items-center gap-2">
                  {configLoading ? (
                    <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-text-secondary">
                      <Loader2 size={12} className="animate-spin" aria-hidden />
                      Loading
                    </span>
                  ) : rpcOk ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
                      <CheckCircle size={12} aria-hidden />
                      Ready
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full border border-warning/35 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold text-warning">
                      <AlertCircle size={12} aria-hidden />
                      Check .env
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => refetchConfig()}
                    className={`rounded-lg p-1.5 text-text-secondary transition-colors ${hoverInset} hover:text-accent`}
                    title="Refresh"
                  >
                    <RefreshCw size={14} />
                  </button>
                  {!configLoading && config && !configError && (
                    <select
                      value={selectedNetwork}
                      onChange={(e) => setSelectedNetwork(e.target.value as Network)}
                      className="app-input dash-input max-w-[160px] cursor-pointer py-2 pl-2.5 pr-8 text-xs font-medium"
                    >
                      <option value="bscMainnet">BNB Mainnet</option>
                      <option value="bscTestnet">BNB Testnet</option>
                    </select>
                  )}
                </div>
              </div>
              {!configLoading && config && !configError && (
                <details className="group mt-3 border-t border-border/70 pt-3">
                  <summary
                    className={`cursor-pointer list-none text-[11px] font-semibold marker:content-none transition-colors hover:text-accent [&::-webkit-details-marker]:hidden ${ink}`}
                  >
                    RPC endpoint URLs
                  </summary>
                  <div className="mt-2 space-y-1.5">
                    <RpcLine label="Primary" value={selectedPrimaryRpc} />
                    <RpcLine label="Testnet" value={config.testnetRpcUrl} />
                    <RpcLine label="Fallback 1" value={config.fallback1} />
                    <RpcLine label="Fallback 2" value={config.fallback2} />
                  </div>
                </details>
              )}
            </div>
          </DashSection>

          <DashSection code="00" title="Session status" hint="Live checks before you initialize.">
            <div className="dash-card space-y-3 p-4 sm:p-5">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-text-secondary">Network</span>
                <span className={`font-medium ${ink}`}>{selectedNetworkLabel}</span>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-text-secondary">RPC</span>
                {configLoading ? (
                  <span className="inline-flex items-center gap-1 text-[10px] text-text-secondary">
                    <Loader2 size={12} className="animate-spin" aria-hidden />
                    Loading
                  </span>
                ) : rpcOk ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
                    <CheckCircle size={12} aria-hidden />
                    Ready
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full border border-warning/35 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold text-warning">
                    Check .env
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-text-secondary">Plan</span>
                <span className={canUseSetup ? "font-medium text-success" : "font-medium text-warning"}>
                  {canUseSetup ? "Active" : "Read-only"}
                </span>
              </div>
              <div className="flex items-start justify-between gap-2 border-t border-border/60 pt-2 text-[11px]">
                <span className="shrink-0 text-text-secondary">Session ID</span>
                <span className={`max-w-[min(100%,12rem)] break-all text-right font-mono ${ink}`}>{sessionIdLabel}</span>
              </div>
            </div>
          </DashSection>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
          <DashSection code="02" title="Signing wallet" hint="Your key stays in this browser session only.">
            <div className="dash-card flex flex-col p-4 sm:p-5">
              <label className="mb-1.5 block text-xs font-medium text-text-secondary">
                Private key <span className="font-normal text-text-secondary">(in-memory only)</span>
              </label>
              <div className="relative">
                <input
                  type={showKey ? "text" : "password"}
                  value={privateKey}
                  onChange={(e) => {
                    setPrivateKey(e.target.value);
                    if (pkError) validatePrivateKey(e.target.value);
                  }}
                  onBlur={() => validatePrivateKey(privateKey)}
                  placeholder="0x… or 64 hex characters"
                  autoComplete="off"
                  spellCheck={false}
                  className={`${setupInput} pr-10 ${pkError ? "!border-danger" : ""}`}
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className={`absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-text-secondary ${hoverInset} hover:text-text-primary`}
                  aria-label={showKey ? "Hide private key" : "Show private key"}
                >
                  {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {pkError && <p className="mt-1.5 text-xs text-danger">{pkError}</p>}
              <p className="mt-1.5 text-[11px] leading-relaxed text-text-secondary">
                Used to deploy and sign transfers. Never stored on the server.
              </p>
              {walletPreview?.account && (
                <p className="mt-1.5 text-[11px] text-text-secondary">
                  Wallet:{" "}
                  <span className="font-mono text-xs text-accent">{shortAddress(walletPreview.account)}</span>
                </p>
              )}
            </div>
          </DashSection>

          <DashSection code="03" title="Token" hint="BEP-20 contract used for distribution and balance checks.">
            <div className="dash-card flex flex-col p-4 sm:p-5">
              <label className="mb-1.5 block text-xs font-medium text-text-secondary">
                Token address <span className="font-normal text-text-secondary">(BEP-20)</span>
              </label>
              <input
                type="text"
                value={tokenAddress}
                onChange={(e) => {
                  setTokenAddress(e.target.value);
                  if (taError) validateTokenAddress(e.target.value);
                }}
                onBlur={() => validateTokenAddress(tokenAddress)}
                placeholder="0x… contract address"
                spellCheck={false}
                className={`${setupInput} ${taError ? "!border-danger" : ""}`}
              />
              {taError && <p className="mt-1.5 text-xs text-danger">{taError}</p>}

              <div className={`mt-3 rounded-lg border border-border p-3 ${bgInset}`}>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <span className={`font-medium ${ink}`}>Balance preview</span>
                  {previewLoading ? (
                    <span className="inline-flex items-center gap-1 font-medium text-warning">
                      <Loader2 size={12} className="animate-spin" aria-hidden />
                      Fetching…
                    </span>
                  ) : walletPreview ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success">
                      <CheckCircle size={10} aria-hidden />
                      Live
                    </span>
                  ) : (
                    <span className="text-text-secondary">Enter key + token</span>
                  )}
                </div>
                {walletPreview && (
                  <div className={`mt-2 space-y-1 text-xs ${ink}`}>
                    <p>
                      <span className="text-text-secondary">Token: </span>
                      <span className="font-medium text-accent">{walletPreview.token?.name ?? "—"}</span>
                    </p>
                    <p>
                      <span className="text-text-secondary">BNB: </span>
                      <span className="font-mono text-accent">{Number(walletPreview.bnbBalance).toFixed(6)}</span>
                    </p>
                    <p>
                      <span className="text-text-secondary">tBNB: </span>
                      <span className="font-mono text-accent">{Number(walletPreview.tBnbBalance).toFixed(6)}</span>
                    </p>
                    <p>
                      <span className="text-text-secondary">Balance: </span>
                      <span className="font-mono text-accent">
                        {Number(walletPreview.token?.balance ?? "0").toLocaleString()}{" "}
                        {walletPreview.token?.symbol ?? ""}
                      </span>
                    </p>
                    {walletPreview.tokenError && (
                      <p className="text-xs text-warning">Token check: {walletPreview.tokenError}</p>
                    )}
                    {!walletPreview.tokenOnSelectedNetwork && (
                      <p className="text-xs text-warning">
                        Token not on {selectedNetworkLabel}. Mainnet preview shown.
                      </p>
                    )}
                  </div>
                )}
                {previewError && (
                  <p className="mt-2 text-xs text-warning">Could not load preview for this key/token.</p>
                )}
              </div>
            </div>
          </DashSection>
        </div>

        <DashSection code="04" title="MultiSender" hint="Deploy once per chain, reuse for distributions.">
        <div className="dash-card overflow-hidden">
          <div className="border-b border-border px-4 py-3 sm:px-5 sm:py-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="dash-section-title">Status</span>
              {deployedAddress && (
                <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success">
                  <CheckCircle size={12} aria-hidden />
                  {deployNetwork || "Deployed"}
                </span>
              )}
            </div>
          </div>

          <div className="space-y-3 p-4 sm:p-5">
            {deployedAddress && !showManualInput && (
              <div className="rounded-lg border border-success/30 bg-success/5 p-3">
                <div className="mb-1 flex items-center gap-1.5">
                  <CheckCircle size={14} className="shrink-0 text-success" aria-hidden />
                  <span className="text-xs font-semibold text-success">Contract ready</span>
                </div>
                <p className={`break-all font-mono text-xs ${ink}`}>{deployedAddress}</p>
                {deployNetwork && (
                  <p className="mt-1 text-[10px] text-text-secondary">
                    Network: <span className="font-medium text-accent">{deployNetwork}</span>
                  </p>
                )}
              </div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
              <div className="dash-segment sm:shrink-0">
                {NETWORKS.map((n) => (
                  <button
                    key={n.value}
                    type="button"
                    onClick={() => setSelectedNetwork(n.value)}
                    className={`dash-segment-btn ${
                      selectedNetwork === n.value ? "dash-segment-btn-active" : ""
                    }`}
                  >
                    {n.label}
                    <span className="ml-0.5 opacity-80">({n.chainId})</span>
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={handleDeploy}
                disabled={deploying || !canUseSetup}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border-2 border-accent bg-accent-dim/30 px-3 py-2 text-xs font-semibold text-accent transition hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-40 dark:text-accent-light"
              >
                {deploying ? (
                  <>
                    <Loader2 size={16} className="animate-spin" aria-hidden />
                    Deploying…
                  </>
                ) : (
                  <>
                    <Zap size={16} aria-hidden />
                    {deployedAddress ? "Redeploy" : "Deploy"}{" "}
                    {NETWORKS.find((n) => n.value === selectedNetwork)?.label}
                  </>
                )}
              </button>
            </div>

            {deploying && (
              <div className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2">
                <p className="text-xs text-warning">Deploying — keep this page open (~30–60s).</p>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setShowManualInput((v) => !v);
                setMsError("");
              }}
              className="flex w-full items-center gap-1.5 text-left text-[11px] font-medium text-text-secondary transition-colors hover:text-accent"
            >
              {showManualInput ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
              {showManualInput ? "Hide manual address" : "Use existing MultiSender address"}
            </button>

            {showManualInput && (
              <div>
                <input
                  type="text"
                  value={manualAddress}
                  onChange={(e) => {
                    setManualAddress(e.target.value);
                    if (msError) validateManualAddress(e.target.value);
                  }}
                  onBlur={() => validateManualAddress(manualAddress)}
                  placeholder="0x… MultiSender contract"
                  spellCheck={false}
                  className={`${setupInput} ${msError ? "!border-danger" : ""}`}
                />
                {msError && <p className="mt-1 text-xs text-danger">{msError}</p>}
                <p className="mt-1 text-[10px] text-text-secondary">Paste a deployed MultiSender contract address.</p>
              </div>
            )}
          </div>
        </div>
        </DashSection>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
          <DashSection code="05" title="Holder scale" hint="Pick total wallets and review estimated token demand.">
            <div className="dash-card p-4 sm:p-5">
              <label className="mb-1 block text-xs font-medium text-text-secondary">
                Total wallets{" "}
                <span className="font-mono font-semibold text-accent">{totalWallets.toLocaleString()}</span>
              </label>
              <p className="mb-2 text-[11px] text-text-secondary">1–100,000 holder wallets.</p>
              <input
                type="number"
                min={1}
                max={100000}
                value={totalWalletsInput}
                onChange={(e) => handleWalletsNumberChange(e.target.value)}
                onBlur={(e) => handleWalletsNumberChange(e.target.value || "1")}
                className={setupInput}
              />
              <input
                type="range"
                min="1"
                max="100000"
                step="1"
                value={totalWallets}
                onChange={(e) => setTotalWallets(Number(e.target.value))}
                className="mt-2 w-full accent-accent"
              />
              <div className="mt-1 flex justify-between text-[10px] text-text-secondary">
                <span>1</span>
                <span className="font-medium text-accent">{totalWallets.toLocaleString()}</span>
                <span>100k</span>
              </div>
            </div>
          </DashSection>

          <DashSection code="06" title="Distribution analytics" hint="Random 1–100 tokens per wallet (estimate).">
            <div className="dash-card p-4 sm:p-5">
              <p className={`text-[11px] font-medium ${ink}`}>Est. tokens (random 1–100 / wallet)</p>
              <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
                <div className={`rounded px-1 py-1.5 ${bgCell}`}>
                  <div className="text-[9px] uppercase text-text-secondary">Min</div>
                  <div className="font-mono text-xs font-semibold text-accent">{requiredMin.toLocaleString()}</div>
                </div>
                <div className={`rounded px-1 py-1.5 ${bgCell}`}>
                  <div className="text-[9px] uppercase text-text-secondary">Avg</div>
                  <div className="font-mono text-xs font-semibold text-accent">{requiredAvg.toLocaleString()}</div>
                </div>
                <div className={`rounded px-1 py-1.5 ${bgCell}`}>
                  <div className="text-[9px] uppercase text-text-secondary">Max</div>
                  <div className="font-mono text-xs font-semibold text-accent">{requiredMax.toLocaleString()}</div>
                </div>
              </div>
              {walletPreview && (
                <p className={`mt-3 text-[11px] leading-snug ${hasEnoughForMax ? "text-success" : "text-warning"}`}>
                  {hasEnoughForMax
                    ? "Balance covers max-case distribution."
                    : "Balance may be insufficient for max case."}
                </p>
              )}
            </div>
          </DashSection>
        </div>
        </div>

        <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-20 lg:col-span-4 lg:self-start">
          <div className="dash-card flex flex-col gap-4 p-4 sm:p-5">
            <div>
              <p className="dash-section-title">Summary</p>
              <h2 className={`mt-1 text-sm font-semibold ${ink}`}>Session overview</h2>
            </div>
            <dl className="space-y-0 text-xs">
              <div className="flex items-start justify-between gap-3 border-b border-border/60 py-2">
                <dt className="text-text-secondary">Network</dt>
                <dd className={`text-right font-medium ${ink}`}>{selectedNetworkLabel}</dd>
              </div>
              <div className="flex items-start justify-between gap-3 border-b border-border/60 py-2">
                <dt className="text-text-secondary">Signing wallet</dt>
                <dd className={`max-w-[11rem] break-all text-right font-mono text-[11px] ${ink}`}>
                  {walletPreview?.account
                    ? shortAddress(walletPreview.account)
                    : pkValid
                      ? "Key valid"
                      : privateKey.trim()
                        ? "Invalid key"
                        : "Not set"}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3 border-b border-border/60 py-2">
                <dt className="text-text-secondary">Token</dt>
                <dd className={`max-w-[11rem] break-all text-right font-mono text-[11px] ${ink}`}>
                  {tokenValid ? shortAddress(tokenAddress.trim()) : "Not set"}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3 border-b border-border/60 py-2">
                <dt className="text-text-secondary">MultiSender</dt>
                <dd className={`max-w-[11rem] break-all text-right font-mono text-[11px] ${ink}`}>
                  {msReady ? shortAddress(multisenderAddress.trim()) : "Not deployed"}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3 border-b border-border/60 py-2">
                <dt className="text-text-secondary">Est. gas</dt>
                <dd className={`text-right text-[11px] leading-snug ${ink}`}>
                  {deploying
                    ? "Deployment in progress…"
                    : "Varies with network activity; keep BNB on the signing wallet."}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3 border-b border-border/60 py-2">
                <dt className="text-text-secondary">Est. distribution</dt>
                <dd className={`text-right text-[11px] leading-snug ${ink}`}>
                  {requiredMin.toLocaleString()} – {requiredMax.toLocaleString()} tokens
                  <span className="block text-[10px] text-text-secondary">avg {requiredAvg.toLocaleString()}</span>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 py-2">
                <dt className="text-text-secondary">Wallet count</dt>
                <dd className="font-semibold text-accent">{totalWallets.toLocaleString()}</dd>
              </div>
            </dl>

            <div className="flex flex-wrap gap-1.5 border-t border-border/60 pt-3">
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                  !configLoading && rpcOk
                    ? "border-success/35 bg-success/10 text-success"
                    : "border-border text-[var(--app-muted)]"
                }`}
              >
                RPC
              </span>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                  pkValid ? "border-success/35 bg-success/10 text-success" : "border-border text-[var(--app-muted)]"
                }`}
              >
                Key
              </span>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                  tokenValid ? "border-success/35 bg-success/10 text-success" : "border-border text-[var(--app-muted)]"
                }`}
              >
                Token
              </span>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                  msReady ? "border-success/35 bg-success/10 text-success" : "border-border text-[var(--app-muted)]"
                }`}
              >
                Contract
              </span>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                  canUseSetup
                    ? "border-success/35 bg-success/10 text-success"
                    : "border-warning/40 bg-warning/10 text-warning"
                }`}
              >
                Plan
              </span>
            </div>

            <button
              type="submit"
              disabled={loading || configLoading || !multisenderAddress || !canUseSetup}
              className="btn-gradient-primary w-full justify-center gap-2 px-4 py-2.5 text-sm font-semibold shadow-lg transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" aria-hidden />
                  Initializing…
                </>
              ) : !multisenderAddress ? (
                "Deploy MultiSender first"
              ) : (
                "Initialize session"
              )}
            </button>
          </div>
        </aside>
      </form>

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm dark:bg-black/70">
          <div
            className="dash-card w-full max-w-md overflow-hidden shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-session-title"
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h3 id="confirm-session-title" className={`font-display text-lg font-semibold ${ink}`}>
                Confirm session
              </h3>
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium text-text-secondary transition-colors ${hoverInset} hover:text-text-primary`}
              >
                Close
              </button>
            </div>

            <div className="space-y-0 px-5 py-4 text-xs">
              <div className="flex justify-between gap-3 border-b border-border/50 py-2">
                <span className="text-text-secondary">Private key</span>
                <span className={`font-mono ${ink}`}>{maskPrivateKey(privateKey.trim())}</span>
              </div>
              <div className="flex justify-between gap-3 border-b border-border/50 py-2">
                <span className="text-text-secondary">Token</span>
                <span className={`font-mono ${ink}`}>{shortAddress(tokenAddress.trim())}</span>
              </div>
              <div className="flex justify-between gap-3 border-b border-border/50 py-2">
                <span className="text-text-secondary">Token name</span>
                <span className={ink}>{tokenName}</span>
              </div>
              <div className="flex justify-between gap-3 border-b border-border/50 py-2">
                <span className="text-text-secondary">MultiSender</span>
                <span className={`font-mono ${ink}`}>{shortAddress(multisenderAddress.trim())}</span>
              </div>
              <div className="flex justify-between gap-3 border-b border-border/50 py-2">
                <span className="text-text-secondary">Network</span>
                <span className={ink}>{selectedNetworkLabel}</span>
              </div>
              <div className="flex justify-between gap-3 py-2">
                <span className="text-text-secondary">Wallets</span>
                <span className="font-semibold text-accent">{totalWallets.toLocaleString()}</span>
              </div>
            </div>

            <div className={`flex flex-wrap justify-end gap-2 border-t border-border px-5 py-4 ${bgInset}`}>
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                disabled={loading}
                className="btn-outline-blue min-w-[88px] justify-center px-4 py-2 text-xs font-medium disabled:opacity-40"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={createSession}
                disabled={loading}
                className="btn-gradient-primary min-w-[140px] justify-center px-4 py-2 text-xs font-semibold disabled:opacity-40"
              >
                {loading ? "Creating…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
