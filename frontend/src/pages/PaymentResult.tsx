import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { findPlan } from "@shared/plans";
import { ThemeToggleButton } from "@/components/ThemeToggleButton";

type PayState = "NEW" | "PENDING" | "CONFIRMED" | "FAILED" | "EXPIRED" | "CANCELLED" | "UNKNOWN";

interface StatusPayload {
  status: PayState | string;
  paidAt?: string;
  txHash?: string;
  cryptoType?: string;
  amount?: number;
  planKey?: string;
  productLine?: string;
  chargeCode?: string;
  hostedUrl?: string;
}

export default function PaymentResultPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const orderId = params.get("orderId");
  const cancelled = params.get("status") === "cancelled";

  const [chargeId, setChargeId] = useState<string | null>(null);
  const [payload, setPayload] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const started = useRef<number>(Date.now());

  const poll = useCallback(async (id: string) => {
    try {
      const { data } = await api.get<StatusPayload>(`/api/payments/status/${id}`);
      setPayload(data);
      const s = data.status as PayState;
      if (s === "CONFIRMED" || s === "FAILED" || s === "EXPIRED") {
        return true;
      }
    } catch {
      setError("Could not refresh payment status.");
    }
    return false;
  }, []);

  useEffect(() => {
    if (cancelled) {
      setLoading(false);
      return;
    }
    if (!orderId) {
      setError("Missing order reference.");
      setLoading(false);
      return;
    }

    let cancelledEffect = false;

    (async () => {
      try {
        const { data } = await api.get<{ chargeId: string; status: string }>(
          `/api/payments/by-order/${encodeURIComponent(orderId)}`
        );
        if (cancelledEffect) return;
        setChargeId(data.chargeId);
        await poll(data.chargeId);
      } catch {
        if (!cancelledEffect) setError("Unable to load payment for this order.");
      } finally {
        if (!cancelledEffect) setLoading(false);
      }
    })();

    return () => {
      cancelledEffect = true;
    };
  }, [cancelled, orderId, poll]);

  useEffect(() => {
    if (cancelled || !chargeId) return undefined;

    const id = window.setInterval(() => {
      if (Date.now() - started.current > 30 * 60 * 1000) {
        setTimedOut(true);
        window.clearInterval(id);
        return;
      }
      void poll(chargeId).then((stop) => {
        if (stop) window.clearInterval(id);
      });
    }, 4000);

    return () => window.clearInterval(id);
  }, [cancelled, chargeId, poll]);

  useEffect(() => {
    const s = payload?.status as PayState | undefined;
    if (
      payload &&
      (s === "CONFIRMED" || s === "FAILED" || s === "EXPIRED" || s === "CANCELLED")
    ) {
      if (timerRef.current) window.clearInterval(timerRef.current);
    }
  }, [payload]);

  const metaRaw = sessionStorage.getItem("pendingPlanMeta");

  let planSummary = "";
  if (payload?.productLine && payload.planKey) {
    const fp = findPlan(payload.productLine, payload.planKey);
    if (fp) planSummary = `${fp.name} · ${fp.walletLimit.toLocaleString()} wallets`;
  } else if (metaRaw) {
    try {
      const m = JSON.parse(metaRaw) as { planName?: string };
      planSummary = m.planName ?? "";
    } catch {
      /* ignore */
    }
  }

  if (cancelled) {
    return (
      <div className="relative min-h-screen bg-terminal text-text-primary flex flex-col items-center justify-center p-8 font-mono text-center">
        <div className="absolute right-4 top-4 z-10">
          <ThemeToggleButton />
        </div>
        <h1 className="text-xl uppercase tracking-widest text-text-primary">Payment cancelled</h1>
        <p className="text-text-muted mt-3 max-w-md text-sm">
          You cancelled the payment. No charge was made.
        </p>
        <Link
          to="/onboarding"
          className="mt-8 px-6 py-3 border border-[#00d4aa] text-[#00d4aa] uppercase text-xs hover:bg-[#00d4aa] hover:text-white"
        >
          GO BACK →
        </Link>
      </div>
    );
  }

  if (loading && !payload) {
    return (
      <div className="relative min-h-screen bg-terminal text-text-primary flex flex-col items-center justify-center gap-4">
        <div className="absolute right-4 top-4 z-10">
          <ThemeToggleButton />
        </div>
        <div className="w-10 h-10 border border-[#00d4aa] border-t-transparent rounded-full animate-spin" />
        <p className="font-mono text-text-muted text-xs uppercase tracking-widest">Loading payment</p>
      </div>
    );
  }

  if (error || !chargeId || !payload) {
    return (
      <div className="relative min-h-screen bg-terminal text-text-primary flex flex-col items-center justify-center p-8 font-mono text-center">
        <div className="absolute right-4 top-4 z-10">
          <ThemeToggleButton />
        </div>
        <p className="text-danger text-sm">{error ?? "Something went wrong."}</p>
        <button
          type="button"
          onClick={() => navigate("/onboarding")}
          className="mt-6 px-6 py-3 border border-[#00d4aa] text-[#00d4aa] uppercase text-xs"
        >
          TRY AGAIN →
        </button>
      </div>
    );
  }

  const status = payload.status as PayState;

  if (timedOut && status !== "CONFIRMED") {
    return (
      <div className="relative min-h-screen bg-terminal text-text-primary flex flex-col items-center justify-center p-8 font-mono text-center max-w-lg mx-auto">
        <div className="absolute right-4 top-4 z-10">
          <ThemeToggleButton />
        </div>
        <p className="text-[#f59e0b] text-sm uppercase tracking-widest">Still pending</p>
        <p className="text-text-muted mt-3">
          Auto-refresh paused after 30 minutes. Check Coinbase Commerce or your wallet, then open Account
          for subscription status.
        </p>
        <Link to="/account" className="mt-6 text-[#00d4aa] text-xs underline">
          Account →
        </Link>
      </div>
    );
  }

  if (status === "CONFIRMED") {
    return (
      <div className="relative min-h-screen bg-terminal text-text-primary flex flex-col items-center justify-center p-8 font-mono text-center">
        <div className="absolute right-4 top-4 z-10">
          <ThemeToggleButton />
        </div>
        <span className="text-[64px] leading-none text-[#00d4aa]">✓</span>
        <h1 className="mt-6 text-2xl uppercase tracking-widest text-text-primary">Payment confirmed</h1>
        <p className="text-text-muted mt-2">Your subscription is now active.</p>
        <p className="text-accent mt-4 text-sm">{planSummary}</p>
        <button
          type="button"
          onClick={() => navigate("/dashboard")}
          className="mt-10 px-8 py-3 border border-[#00d4aa] text-[#00d4aa] uppercase text-xs tracking-widest hover:bg-[#00d4aa] hover:text-white"
        >
          GO TO DASHBOARD →
        </button>
      </div>
    );
  }

  if (status === "FAILED") {
    return (
      <div className="relative min-h-screen bg-terminal text-text-primary flex flex-col items-center justify-center p-8 font-mono text-center">
        <div className="absolute right-4 top-4 z-10">
          <ThemeToggleButton />
        </div>
        <span className="text-[64px] text-danger">✗</span>
        <h1 className="mt-6 text-xl uppercase text-[#ef4444]">Payment failed</h1>
        <p className="text-text-muted mt-2 max-w-md text-sm">
          Your transaction could not be completed.
        </p>
        <button
          type="button"
          onClick={() => navigate("/onboarding")}
          className="mt-8 px-8 py-3 border border-[#00d4aa] text-[#00d4aa] uppercase text-xs"
        >
          TRY AGAIN →
        </button>
      </div>
    );
  }

  if (status === "EXPIRED") {
    return (
      <div className="relative min-h-screen bg-terminal text-text-primary flex flex-col items-center justify-center p-8 font-mono text-center">
        <div className="absolute right-4 top-4 z-10">
          <ThemeToggleButton />
        </div>
        <p className="text-text-muted mt-6 text-sm uppercase">Payment expired</p>
        <p className="text-text-muted mt-2 max-w-md text-xs">
          This payment link may have expired (~30 minutes on Commerce). Create a new charge from onboarding.
        </p>
        <button
          type="button"
          onClick={() => navigate("/onboarding")}
          className="mt-8 px-8 py-3 border border-[#00d4aa] text-[#00d4aa] uppercase text-xs"
        >
          CREATE NEW PAYMENT →
        </button>
      </div>
    );
  }

  if (status === "PENDING") {
    const hash = payload.txHash;
    return (
      <div className="relative min-h-screen bg-terminal text-text-primary flex flex-col items-center justify-center p-8 font-mono text-center">
        <div className="absolute right-4 top-4 z-10">
          <ThemeToggleButton />
        </div>
        <div className="w-24 h-24 rounded-full border-2 border-[#00d4aa]/40 animate-pulse flex items-center justify-center">
          <div className="w-14 h-14 rounded-full border-t-2 border-[#00d4aa] animate-spin" />
        </div>
        <h2 className="mt-10 text-xl uppercase tracking-widest text-[#00d4aa]">Transaction detected</h2>
        <p className="text-text-muted text-sm mt-2 max-w-md">
          Confirming on-chain… This usually takes 1–5 minutes.
        </p>
        {hash && (
          <a
            href={`https://bscscan.com/tx/${hash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 text-[11px] text-[#00d4aa] break-all underline"
          >
            {hash.slice(0, 14)}…{hash.slice(-8)}
          </a>
        )}
        <button
          type="button"
          onClick={() => void poll(chargeId)}
          className="mt-8 px-4 py-2 border border-border text-xs uppercase text-text-primary"
        >
          CHECK STATUS
        </button>
      </div>
    );
  }

  /* NEW */
  const code = payload.chargeCode ?? "—";
  const hostedUrl = payload.hostedUrl ?? "";

  return (
    <div className="relative min-h-screen bg-terminal text-text-primary flex flex-col items-center justify-center p-8 font-mono text-center">
      <div className="absolute right-4 top-4 z-10">
        <ThemeToggleButton />
      </div>
      <div className="w-12 h-12 border-2 border-[#00d4aa] rounded-full border-t-transparent animate-spin" />
      <h2 className="mt-8 text-xl uppercase tracking-widest text-text-primary">Waiting for payment</h2>
      <p className="text-text-muted text-sm mt-2 max-w-lg">
        Complete your payment on Coinbase Commerce to continue.
      </p>
      <p className="mt-6 text-sm text-text-muted uppercase tracking-widest">Charge code</p>
      <p className="mt-2 text-2xl md:text-3xl tracking-wider text-accent break-all">{code}</p>
      <div className="flex flex-col sm:flex-row gap-3 mt-8">
        {hostedUrl ? (
          <a
            href={hostedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-6 py-3 border border-[#00d4aa] text-[#00d4aa] uppercase text-xs"
          >
            RETURN TO PAYMENT PAGE →
          </a>
        ) : null}
        <button
          type="button"
          onClick={() => void poll(chargeId)}
          className="px-6 py-3 border border-border text-text-primary uppercase text-xs"
        >
          CHECK STATUS
        </button>
      </div>
    </div>
  );
}
