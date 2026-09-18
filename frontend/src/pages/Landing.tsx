import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, AlertTriangle } from "lucide-react";
import { useRevealOnScroll } from "@/hooks/useRevealOnScroll";
import DotField from "@/components/DotField/DotField";
import { TokenHolderPricingGrid } from "@/components/marketing/TokenHolderPricingGrid";
import { PackageComparisonTable } from "@/components/marketing/PackageComparisonTable";
import { HowItWorks } from "@/components/marketing/HowItWorks";
import { WhatYouWillReceive } from "@/components/marketing/WhatYouWillReceive";
import { TokenHolderFaq } from "@/components/marketing/TokenHolderFaq";
import { cn } from "@/lib/cn";

function RevealSection({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  const { ref, visible } = useRevealOnScroll<HTMLElement>(0.1);
  return (
    <section
      id={id}
      ref={ref}
      className={cn(
        "transition duration-500 ease-out motion-reduce:transition-none",
        visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
        className
      )}
    >
      {children}
    </section>
  );
}

export default function Landing() {
  return (
    <div className="landing-root min-h-screen bg-terminal font-sans text-text-primary">
      <header className="sticky top-0 z-40 border-b border-border bg-terminal/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-4 px-4 py-4">
          <Link to="/" className="text-lg font-semibold tracking-tight text-text-primary">
            AVG Token Services
          </Link>
          <nav className="flex flex-wrap items-center gap-6 text-sm font-medium text-text-secondary">
            <Link to="/pricing" className="transition hover:text-text-primary">
              Pricing
            </Link>
            <Link to="/login" className="transition hover:text-text-primary">
              Log in
            </Link>
            <Link
              to="/pricing"
              className="btn-gradient-primary !py-2.5 !px-5 text-sm"
            >
              Select plan
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero — DotField background + typography */}
      <section className="relative min-h-[80vh] overflow-hidden border-b border-border">
        <div className="absolute inset-0 z-0 min-h-[92vh]">
          <DotField
            className="absolute inset-0 min-h-[92vh] w-full"
            style={{ width: "100%", height: "100%", minHeight: "92vh" }}
            dotRadius={1}
            dotSpacing={35}
            bulgeStrength={70}
            glowRadius={400}
            sparkle={true}
            waveAmplitude={1.5}
            dotGlowScale={2.85}
            dotGlowStrength={1.32}
            gradientFrom="rgba(102, 68, 235, 0.62)"
            gradientTo="rgb(255, 255, 255)"
            glowColor="#0B0F1F"
          />
        </div>
        <div
          className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-b from-terminal/74 via-terminal/34 to-terminal/[0.88]"
          aria-hidden
        />

        <div className="relative z-10 mx-auto max-w-[900px] px-4 pb-24 pt-16 text-center md:pb-32 md:pt-28 pointer-events-none [&_a]:pointer-events-auto">
          <p className="mx-auto inline-flex rounded-full border border-accent/30 bg-accent-dim/40 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-accent-light backdrop-blur-sm">
            AVG Token Services
          </p>

          {/* Display stack — size + weight only, no imagery */}
          <h1 className="mt-10 font-display text-[clamp(2.25rem,6vw,4rem)] font-light leading-[1.05] tracking-[-0.03em] text-text-primary">
            <span className="block">Holder distribution</span>
            <span className="mt-1 block bg-gradient-to-r from-[#93C5FD] via-white to-[#93C5FD] bg-clip-text font-semibold text-transparent md:mt-2">
              Infrastructure For Token Teams
            </span>
          </h1>

          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:flex-wrap">
            <Link to="/pricing" className="btn-gradient-primary min-w-[200px] justify-center gap-2 px-8">
              Select plan
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <Link to="/login" className="btn-outline-blue min-w-[200px] justify-center px-8">
              Log in to dashboard
            </Link>
          </div>

          <p className="mx-auto mt-12 max-w-xl text-sm font-light leading-7 text-text-secondary md:text-base">
            Generate holder wallets, run fixed or custom transfers, and export Excel-ready proof for BEP20 / ERC20-style
            workflows on EVM-compatible networks.
          </p>

          {/* Typographic stats — numbers as hero type, not cards */}
          {/* <div className="mx-auto mt-14 flex max-w-lg flex-col items-center justify-center gap-10 border-t border-white/[0.08] pt-14 sm:max-w-none sm:flex-row sm:gap-16 md:gap-24">
            <div className="text-center">
              <p className="font-display text-5xl font-semibold tabular-nums tracking-tighter text-text-primary md:text-6xl">
                25K
              </p>
              <p className="mt-2 text-[11px] font-medium uppercase tracking-[0.18em] text-text-muted">Max wallets · Elite</p>
            </div>
            <div className="hidden h-16 w-px bg-white/10 sm:block" aria-hidden />
            <div className="text-center">
              <p className="font-display text-5xl font-semibold tabular-nums tracking-tighter text-text-primary md:text-6xl">
                $60
              </p>
              <p className="mt-2 text-[11px] font-medium uppercase tracking-[0.18em] text-text-muted">From · crypto checkout</p>
            </div>
          </div> */}

          <div className="mt-12 flex flex-wrap justify-center gap-2">
            {["BEP20 / ERC20", "Excel + on-chain proof", "Batch & daily lanes"].map((pill) => (
              <span
                key={pill}
                className="rounded-full border border-white/10 px-3 py-1.5 text-[13px] font-medium tracking-wide text-text-secondary"
              >
                {pill}
              </span>
            ))}
          </div>
        </div>
      </section>

      <RevealSection id="packages" className="py-20 md:py-28">
        <div className="mx-auto max-w-[1200px] px-4 text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">Token holder packages</h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-text-secondary">
            One-time creation tiers from Starter through Elite. Scale Pack is our most popular balance of batch power and
            flexibility.
          </p>
        </div>
        <TokenHolderPricingGrid className="mt-14" />
      </RevealSection>

      <RevealSection id="compare" className="border-y border-border bg-surface/40 py-20 md:py-28">
        <div className="mx-auto max-w-[1200px] px-4 text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">Compare packages</h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-text-secondary">
            Side-by-side view of wallet counts, transfer style, reporting, and delivery expectations.
          </p>
        </div>
        <div className="mt-14">
          <PackageComparisonTable />
        </div>
      </RevealSection>

      <RevealSection id="deliverables" className="py-20 md:py-28">
        <WhatYouWillReceive />
      </RevealSection>

      <RevealSection id="how-it-works" className="py-20 md:py-28">
        <div className="mx-auto max-w-[1200px] px-4 text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">How it works</h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-text-secondary">
            Five steps from checkout to reconciled reporting—built for operators who need repeatable distributions.
          </p>
        </div>
        <HowItWorks className="mt-14" />
      </RevealSection>

      <RevealSection id="faq" className="border-t border-border py-20 md:py-28">
        <div className="mx-auto max-w-[1200px] px-4 text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">Frequently asked questions</h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-text-secondary">
            Straight answers on wallets, payments, upgrades, and proof of transfer.
          </p>
        </div>
        <TokenHolderFaq className="mt-12" />
      </RevealSection>

      <RevealSection id="notice" className="pb-12 md:pb-16">
        <div className="mx-auto max-w-[960px] px-4">
          <div
            className="flex gap-4 rounded-2xl border border-warning/30 bg-warning/5 p-6 md:p-8"
            style={{ borderLeftWidth: "4px", borderLeftColor: "rgba(245, 158, 11, 0.9)" }}
          >
            <AlertTriangle className="h-6 w-6 shrink-0 text-warning" aria-hidden />
            <div>
              <h2 className="text-lg font-semibold text-text-primary">Important notice</h2>
              <p className="mt-3 text-base leading-relaxed text-text-secondary">
                Digital assets involve technical and market risks. AVG Token Services provides software tooling for token
                distribution workflows and reporting—not investment, legal, or tax advice. You are responsible for
                compliance with applicable laws in your jurisdiction and for securing signing keys and treasury operations.
              </p>
            </div>
          </div>
        </div>
      </RevealSection>

      <RevealSection id="cta" className="pb-24 md:pb-32">
        <div className="mx-auto max-w-[960px] px-4">
          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#1e3a5f] via-surface to-terminal p-10 text-center shadow-card md:p-14">
            <div
              className="pointer-events-none absolute inset-0 opacity-30"
              style={{
                background: "radial-gradient(circle at 30% 20%, rgba(59,130,246,0.35), transparent 50%)",
              }}
            />
            <div className="relative">
              <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Ready to grow your holder base?</h2>
              <p className="mx-auto mt-4 max-w-xl text-lg text-text-secondary">
                Pick the tier that matches your launch or campaign, complete crypto checkout, and move straight into
                setup.
              </p>
              <p className="mt-3 text-sm font-medium text-text-muted">Starting from $60 · Elite supports up to 25,000 wallets</p>
              <Link to="/pricing" className="btn-gradient-primary mx-auto mt-8 gap-2">
                Select plan
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>
          </div>
        </div>
      </RevealSection>

      <footer className="border-t border-border px-4 py-14">
        <div className="mx-auto grid max-w-[1200px] gap-12 md:grid-cols-3">
          <div>
            <p className="text-lg font-semibold text-text-primary">AVG Token Services</p>
            <p className="mt-2 text-sm text-text-secondary">
              Corporate-grade tooling for token holder creation and batch distribution.
            </p>
          </div>
          <nav className="flex flex-col gap-3 text-sm text-text-secondary">
            <Link to="/" className="transition hover:text-text-primary">
              Home
            </Link>
            <Link to="/pricing" className="transition hover:text-text-primary">
              Pricing
            </Link>
            <Link to="/login" className="transition hover:text-text-primary">
              Log in
            </Link>
          </nav>
          <div className="text-sm text-text-muted">
            <p>ETH · USDC · BTC · DAI · USDT · and more via Coinbase Commerce</p>
            <p className="mt-2 text-xs">BEP20 · ERC20 · EVM-compatible distribution workflows.</p>
          </div>
        </div>
        <p className="mx-auto mt-12 max-w-4xl border-t border-border pt-8 text-center text-xs text-text-muted">
          © {new Date().getFullYear()} AVG Token Services. For token distribution and Web3 operational use only.
        </p>
      </footer>
    </div>
  );
}
