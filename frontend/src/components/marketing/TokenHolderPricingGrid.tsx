import { Link } from "react-router-dom";
import { ArrowRight, Check, Lock } from "lucide-react";
import { TOKEN_HOLDER_PLANS } from "@shared/plans";
import { cn } from "@/lib/cn";

export type TokenHolderPricingGridMode = "marketing" | "select";

type Plan = (typeof TOKEN_HOLDER_PLANS)[number];

const SHARED_BENEFITS = [
  "Excel-friendly exports with wallet + transaction status",
  "On-chain proof and reconciliation-friendly references",
  "BEP20 / ERC20-oriented workflows on EVM-compatible networks",
  "Session-scoped signing — keys stay in your browser",
] as const;

const CONTEXT_LABEL: Partial<Record<Plan["key"], string>> = {
  STARTER: "Best for launch",
  GROWTH: "For communities",
  SCALE: "Most popular",
  PRO: "Recommended",
  ELITE: "For DAOs",
};

const MAX_CARD_FEATURES = 5;

function SharedBenefitsStrip() {
  return (
    <div className="mb-8 rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel)]/50 px-4 py-5 backdrop-blur-sm md:px-6 md:py-6">
      <p className="text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
        Included with every package
      </p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {SHARED_BENEFITS.map((line) => (
          <li key={line} className="flex items-start gap-2.5 text-sm leading-snug text-text-secondary">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TrustRow() {
  return (
    <p className="mt-8 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-xs text-text-muted">
      <Lock className="inline h-3.5 w-3.5 shrink-0 text-text-muted opacity-80" aria-hidden />
      <span>Secured checkout</span>
      <span className="text-[var(--app-border)]" aria-hidden>
        ·
      </span>
      <span>Coinbase Commerce</span>
      <span className="text-[var(--app-border)]" aria-hidden>
        ·
      </span>
      <span>Crypto settlement — card where supported</span>
    </p>
  );
}

function MobileStickyCta({ planKey }: { planKey: string }) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-[var(--app-border)] bg-[var(--app-surface)]/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md supports-[backdrop-filter]:bg-[var(--app-surface)]/90 md:hidden">
      <Link
        to={`/login?plan=TOKEN_HOLDER_${planKey}`}
        className="btn-gradient-primary w-full justify-center gap-2 py-3 text-sm font-semibold shadow-lg"
      >
        Get started
        <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
      </Link>
    </div>
  );
}

export function TokenHolderPricingGrid({
  className,
  mode = "marketing",
  selectedKey,
  onSelectPlan,
  showInr = false,
}: {
  className?: string;
  mode?: TokenHolderPricingGridMode;
  selectedKey?: string;
  onSelectPlan?: (key: string) => void;
  showInr?: boolean;
}) {
  const plans = [...TOKEN_HOLDER_PLANS];
  /** Featured (Scale) centered on desktop: Starter | Scale | Growth */
  const topOrdered: Plan[] = [plans[0], plans[2], plans[1]];
  const bottom = plans.slice(3, 5);
  const popularPlan = TOKEN_HOLDER_PLANS.find((p) => "popular" in p && p.popular);
  const popularKey = popularPlan?.key ?? "SCALE";

  return (
    <div
      className={cn(
        "relative mx-auto max-w-[1200px] px-4",
        mode === "marketing" && "pb-24 md:pb-0",
        className
      )}
    >
      <SharedBenefitsStrip />

      <div className="grid grid-cols-1 gap-5 py-1 md:grid-cols-2 lg:grid-cols-3 lg:gap-6 lg:py-3">
        {topOrdered.map((p) => (
          <PricingCard
            key={p.key}
            plan={p}
            mode={mode}
            selectedKey={selectedKey}
            onSelectPlan={onSelectPlan}
            showInr={showInr}
          />
        ))}
      </div>

      <div className="mx-auto mt-5 grid max-w-[920px] grid-cols-1 gap-5 md:mt-6 md:grid-cols-2 md:gap-6">
        {bottom.map((p) => (
          <PricingCard
            key={p.key}
            plan={p}
            mode={mode}
            selectedKey={selectedKey}
            onSelectPlan={onSelectPlan}
            showInr={showInr}
          />
        ))}
      </div>

      <TrustRow />

      {mode === "marketing" && <MobileStickyCta planKey={popularKey} />}
    </div>
  );
}

function PlanCardBody({ plan, showInr }: { plan: Plan; showInr: boolean }) {
  const popular = "popular" in plan && plan.popular;
  const context = CONTEXT_LABEL[plan.key];
  const highlights = plan.features.slice(0, MAX_CARD_FEATURES);
  const metaLine = plan.footerLines.join(" · ");

  return (
    <>
      {context && !popular ? (
        <span className="inline-flex w-fit rounded-full border border-accent/25 bg-accent-dim/50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-accent-light">
          {context}
        </span>
      ) : null}
      <div className={cn("flex items-start justify-between gap-2", context && !popular ? "mt-3" : "mt-0")}>
        <h3 className="text-lg font-semibold tracking-tight text-text-primary md:text-xl">{plan.name}</h3>
      </div>
      <p className="mt-4 text-4xl font-bold tabular-nums tracking-tight text-text-primary md:text-5xl">
        ${plan.priceUSD}
      </p>
      {showInr && "priceINR" in plan ? (
        <p className="mt-1 text-xs text-text-muted">~₹{Number(plan.priceINR).toLocaleString()} INR</p>
      ) : null}
      <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-text-secondary">{plan.bestFor}</p>
      <ul className="mt-5 flex-1 space-y-2.5">
        {highlights.map((f) => (
          <li key={f} className="flex gap-2.5 text-sm leading-snug text-text-secondary">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <p className="mt-5 line-clamp-1 text-[11px] leading-tight text-text-muted" title={metaLine}>
        {metaLine}
      </p>
    </>
  );
}

function pricingCardShellClass(popular: boolean, selected: boolean, mode: TokenHolderPricingGridMode) {
  return cn(
    "pricing-tier-card flex flex-col p-5 text-left md:p-6",
    popular && "pricing-tier-card--featured pt-4 lg:z-[1] lg:scale-[1.03]",
    mode === "select" && selected && "ring-2 ring-accent ring-offset-2 ring-offset-[var(--app-ring-offset)]",
    mode === "select" && !selected && popular && "ring-2 ring-[#3B82F6]/40"
  );
}

function PricingCard({
  plan,
  mode,
  selectedKey,
  onSelectPlan,
  showInr,
}: {
  plan: Plan;
  mode: TokenHolderPricingGridMode;
  selectedKey?: string;
  onSelectPlan?: (key: string) => void;
  showInr: boolean;
}) {
  const popular = "popular" in plan && plan.popular;
  const selected = mode === "select" && selectedKey === plan.key;

  if (mode === "select") {
    return (
      <button
        type="button"
        onClick={() => onSelectPlan?.(plan.key)}
        aria-pressed={selected}
        className={cn(pricingCardShellClass(popular, selected, mode), "transition-transform")}
      >
        {popular && (
          <span className="absolute -top-3 left-1/2 z-[2] -translate-x-1/2 rounded-full bg-gradient-to-r from-[#3B82F6] to-[#60A5FA] px-4 py-1 text-[11px] font-semibold uppercase tracking-wide text-white shadow-md">
            Most Popular
          </span>
        )}
        <PlanCardBody plan={plan} showInr={showInr} />
        <div
          className={cn(
            "pointer-events-none mt-6 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition",
            popular ? "btn-gradient-primary" : "btn-outline-blue"
          )}
        >
          {selected ? (
            <>
              <Check className="h-4 w-4 shrink-0" aria-hidden />
              Selected
            </>
          ) : (
            <>
              Choose plan
              <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
            </>
          )}
        </div>
      </button>
    );
  }

  return (
    <article className={cn(pricingCardShellClass(popular, false, mode), "relative")}>
      {popular && (
        <span className="absolute -top-3 left-1/2 z-[2] -translate-x-1/2 rounded-full bg-gradient-to-r from-[#3B82F6] to-[#60A5FA] px-4 py-1 text-[11px] font-semibold uppercase tracking-wide text-white shadow-md">
          Most Popular
        </span>
      )}
      <PlanCardBody plan={plan} showInr={showInr} />
      <Link
        to={`/login?plan=TOKEN_HOLDER_${plan.key}`}
        className={cn(
          "mt-6 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-[#60A5FA] focus:ring-offset-2 focus:ring-offset-[var(--app-ring-offset)]",
          popular ? "btn-gradient-primary shadow-md hover:brightness-110" : "btn-outline-blue hover:bg-accent-dim/30"
        )}
      >
        Select plan
        <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
      </Link>
    </article>
  );
}
