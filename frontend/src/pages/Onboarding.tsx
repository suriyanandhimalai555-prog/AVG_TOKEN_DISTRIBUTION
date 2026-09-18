import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import toast from "react-hot-toast";
import { ArrowRight, Check } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import CoinbaseCheckout from "@/components/CoinbaseCheckout";
import { findPlan } from "@shared/plans";
import { parseLandingPlan } from "@/lib/planQuery";
import type { ProductLine } from "@shared/plans";
import { ThemeToggleButton } from "@/components/ThemeToggleButton";
import { TokenHolderPricingGrid } from "@/components/marketing/TokenHolderPricingGrid";
import { cn } from "@/lib/cn";

type Step = 1 | 2 | 3;

const STEP_LABELS = ["Choose product", "Choose plan", "Checkout"] as const;

export default function OnboardingPage() {
  const { subscription, user } = useAuth();
  const [step, setStep] = useState<Step>(1);
  const [product, setProduct] = useState<ProductLine>("TOKEN_HOLDER");
  const [selectedKey, setSelectedKey] = useState<string>("");

  useEffect(() => {
    const raw = sessionStorage.getItem("pendingPlan");
    const p = parseLandingPlan(raw);
    if (p && p.productLine === "TOKEN_HOLDER") {
      setProduct(p.productLine);
      setSelectedKey(p.planKey);
      setStep(2);
    }
  }, []);

  if (user?.role === "ADMIN" || subscription?.status === "ACTIVE") {
    return <Navigate to="/dashboard" replace />;
  }

  const selectedPlan = useMemo(() => {
    if (!selectedKey) return null;
    return findPlan(product, selectedKey);
  }, [product, selectedKey]);

  const priceUSD =
    selectedPlan && "priceUSD" in selectedPlan ? (selectedPlan.priceUSD as number) : 0;
  const priceINR =
    selectedPlan && "priceINR" in selectedPlan ? (selectedPlan.priceINR as number) : 0;
  const planName = selectedPlan && "name" in selectedPlan ? String(selectedPlan.name) : "";

  return (
    <div className="min-h-screen bg-terminal font-sans text-text-primary">
      <header className="border-b border-border bg-surface/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 px-4 py-4">
          <Link to="/" className="text-lg font-semibold tracking-tight text-text-primary">
            AVG Token Services
          </Link>
          <div className="flex items-center gap-4">
            <Link to="/pricing" className="text-sm font-medium text-text-secondary transition hover:text-text-primary">
              Pricing
            </Link>
            <ThemeToggleButton />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1200px] px-4 py-8 pb-12 md:py-10 md:pb-16">
        <p className="text-sm font-medium uppercase tracking-wider text-accent-light">
          Step {step} of 3 · Signed in as {user?.email}
        </p>

        <nav aria-label="Checkout steps" className="mt-8 flex flex-wrap gap-6 border-b border-border">
          {STEP_LABELS.map((label, i) => {
            const n = (i + 1) as Step;
            const active = step === n;
            return (
              <div
                key={label}
                className={cn(
                  "border-b-2 border-transparent pb-3 text-sm font-medium transition-colors",
                  active ? "border-accent text-accent-light" : "text-text-muted"
                )}
              >
                {label}
              </div>
            );
          })}
        </nav>

        {step === 1 && (
          <div className="mt-10">
            <p className="text-sm font-medium uppercase tracking-wider text-accent-light">Token holder creation</p>
            <h1 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">Choose your product</h1>
            <p className="mt-4 max-w-2xl text-lg text-text-secondary">
              One-time setup for holder wallets, distribution batches, and Excel-friendly reporting on EVM-compatible
              networks.
            </p>
            <div className="mt-8 grid max-w-xl grid-cols-1 gap-4">
              <button
                type="button"
                onClick={() => setProduct("TOKEN_HOLDER")}
                className={cn(
                  "corp-card p-6 text-left transition hover:-translate-y-0.5 hover:shadow-lg md:p-8",
                  product === "TOKEN_HOLDER" ? "ring-2 ring-accent" : ""
                )}
              >
                <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Product</p>
                <p className="mt-3 text-xl font-semibold tracking-tight text-text-primary">Token holder creation</p>
                <p className="mt-3 text-base leading-relaxed text-text-secondary">
                  Build a durable holder base with fixed or custom per-wallet amounts and tier-based batching.
                </p>
                <p className="mt-4 text-sm font-medium text-accent-light">From $60 USD (~₹5,000 INR)</p>
              </button>
            </div>
            <button
              type="button"
              onClick={() => setStep(2)}
              className="btn-gradient-primary mt-10 inline-flex items-center gap-2 px-8 py-3 text-sm font-semibold"
            >
              Continue
              <ArrowRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="mt-10">
            <p className="text-sm font-medium uppercase tracking-wider text-accent-light">Token holder creation</p>
            <h1 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">Choose your holder package</h1>
            <p className="mt-4 max-w-2xl text-lg text-text-secondary">
              Build a durable holder base with fixed or custom per-wallet amounts, tier-based batching, and
              Excel-friendly reporting. Up to 25,000 wallets on Elite · starting from $60 USD.
            </p>
            <TokenHolderPricingGrid
              className="mt-10"
              mode="select"
              selectedKey={selectedKey}
              onSelectPlan={setSelectedKey}
              showInr
            />
            <div className="mt-10 flex flex-wrap gap-4">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="btn-outline-blue px-6 py-2.5 text-sm font-medium"
              >
                Back
              </button>
              <button
                type="button"
                disabled={!selectedKey}
                onClick={() => selectedKey && setStep(3)}
                className="btn-gradient-primary inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold disabled:pointer-events-none disabled:opacity-40"
              >
                Continue
                <ArrowRight className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>
        )}

        {step === 3 && selectedPlan && "priceUSD" in selectedPlan && (
          <div className="mt-10">
            <p className="text-sm font-medium uppercase tracking-wider text-accent-light">Checkout</p>
            <h1 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">Confirm and pay</h1>
            <p className="mt-4 max-w-2xl text-lg text-text-secondary">
              Review your package, then pay with crypto via Coinbase Commerce.
            </p>

            <div className="mt-10 grid gap-6 md:grid-cols-5">
              <div className="corp-card flex flex-col p-6 md:col-span-3 md:p-8">
                <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Selected plan</p>
                <p className="mt-3 text-2xl font-bold tracking-tight text-text-primary">{planName}</p>
                <p className="mt-1 text-sm text-text-secondary">{product.replace("_", " ")}</p>
                <p className="mt-6 text-2xl font-bold text-text-primary">
                  ${priceUSD}{" "}
                  <span className="text-base font-normal text-text-muted">USD</span>
                </p>
                <p className="mt-1 text-sm text-text-muted">~₹{priceINR.toLocaleString()} INR</p>
                <hr className="my-6 border-border" />
                <ul className="space-y-3 text-sm text-text-secondary">
                  {selectedPlan.features.map((f) => (
                    <li key={f} className="flex gap-3">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex flex-col gap-6 md:col-span-2">
                <div className="corp-card border-accent/20 bg-accent-dim/40 p-6 md:p-8">
                  <h2 className="text-lg font-semibold text-text-primary md:text-xl">Pay with cryptocurrency</h2>
                  <p className="mt-3 text-sm leading-relaxed text-text-secondary">
                    ETH · USDC · BTC · DAI · USDT · DOGE · LTC · and additional assets supported through Coinbase
                    Commerce.
                  </p>
                  <p className="mt-2 text-xs text-text-muted">
                    Powered by Coinbase Commerce · Self-custody settlement
                  </p>
                </div>
                <div className="corp-card p-6 md:p-8">
                  <CoinbaseCheckout
                    productLine={product}
                    planKey={selectedKey}
                    planName={planName}
                    priceUSD={priceUSD}
                    onInitiated={() => toast.success("Redirecting to Coinbase payment...")}
                    onError={(m) => toast.error(m)}
                  />
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setStep(2)}
              className="btn-outline-blue mt-10 px-6 py-2.5 text-sm font-medium"
            >
              Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
