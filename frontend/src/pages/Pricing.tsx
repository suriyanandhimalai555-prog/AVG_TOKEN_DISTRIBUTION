import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { TokenHolderPricingGrid } from "@/components/marketing/TokenHolderPricingGrid";
import { PackageComparisonTable } from "@/components/marketing/PackageComparisonTable";
import { TokenHolderFaq } from "@/components/marketing/TokenHolderFaq";
import { cn } from "@/lib/cn";

import { ThemeToggleButton } from "@/components/ThemeToggleButton";

export default function Pricing() {
  return (
    <div className="min-h-screen bg-terminal font-sans text-text-primary">
      <header className="border-b border-border bg-surface/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 px-4 py-4">
          <Link to="/" className="text-lg font-semibold tracking-tight text-text-primary">
            AVG Token Services
          </Link>
          <nav className="flex flex-wrap items-center gap-4 text-sm font-medium text-text-secondary sm:gap-6">
            <Link to="/" className="transition hover:text-text-primary">
              Home
            </Link>
            <ThemeToggleButton />
            <Link to="/login" className="btn-outline-blue !py-2 !px-4 text-sm">
              Log in
            </Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-[1200px] px-4 py-12 md:py-16">
        <p className="text-sm font-medium uppercase tracking-wider text-accent-light">Token holder creation</p>
        <h1 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">Choose your holder package</h1>
        <p className="mt-4 max-w-2xl text-lg text-text-secondary">
          Build a durable holder base with fixed or custom per-wallet amounts, tier-based batching, and Excel-friendly
          reporting. Up to 25,000 wallets on Elite · starting from $60 USD.
        </p>
      </div>

      <section aria-labelledby="packages-heading" className="pb-16 md:pb-24">
        <h2 id="packages-heading" className="sr-only">
          Package tiers
        </h2>
        <TokenHolderPricingGrid />
      </section>

      <section
        aria-labelledby="compare-heading"
        className="border-y border-border bg-surface/40 py-16 md:py-24"
      >
        <div className="mx-auto max-w-[1200px] px-4 text-center">
          <h2 id="compare-heading" className="text-3xl font-bold tracking-tight md:text-4xl">
            Compare packages
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-text-secondary">
            Transfer style, batching, reporting, and delivery at a glance.
          </p>
        </div>
        <div className="mt-12">
          <PackageComparisonTable />
        </div>
      </section>

      <CoinbaseCommerceBanner />

      <IncludedFeatures />

      <section aria-labelledby="faq-heading" className="border-t border-border py-16 md:py-24">
        <div className="mx-auto max-w-[1200px] px-4 text-center">
          <h2 id="faq-heading" className="text-3xl font-bold tracking-tight md:text-4xl">
            Frequently asked questions
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-text-secondary">
            Same answers as our homepage—no surprises at checkout.
          </p>
        </div>
        <TokenHolderFaq className="mt-12" />
      </section>

      <section className="border-t border-border px-4 py-16">
        <div className="mx-auto max-w-[720px] text-center">
          <h2 className="text-2xl font-bold md:text-3xl">Ready to check out?</h2>
          <p className="mt-3 text-text-secondary">Use “Select Plan →” on a card above to open login with that tier pre-selected.</p>
          <Link to="/login" className="btn-gradient-primary mx-auto mt-8 gap-2">
            Go to login
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </section>
    </div>
  );
}

function CoinbaseCommerceBanner() {
  return (
    <section className="mx-auto max-w-[1100px] px-4 py-16 md:py-20" aria-labelledby="payments-heading">
      <div className="corp-card border-accent/20 bg-accent-dim/40 p-8 md:p-12">
        <h2 id="payments-heading" className="text-xl font-semibold text-text-primary md:text-2xl">
          Pay with cryptocurrency
        </h2>
        <p className="mt-4 text-base leading-relaxed text-text-secondary">
          ETH · USDC · BTC · DAI · USDT · DOGE · LTC · and additional assets supported through Coinbase Commerce.
        </p>
        <p className="mt-3 text-sm text-text-muted">
          Hosted checkout · Merchant webhooks · Card data never touches your infrastructure when buyers pay in crypto.
        </p>
        <Link to="/login" className="btn-outline-blue mt-8 inline-flex gap-2">
          Create account
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    </section>
  );
}

function IncludedFeatures() {
  const items = [
    "BEP20 / ERC20 oriented workflows",
    "Signed transaction references for reconciliation",
    "CSV & Excel-friendly exports",
    "Session-scoped signing workflows",
    "Tier-based batch and gas planning",
    "Resume-safe distribution execution where configured",
  ];
  return (
    <div className="mx-auto max-w-[1100px] px-4 pb-8">
      <h2 className="text-center text-sm font-semibold uppercase tracking-wider text-text-muted">
        Included across packages
      </h2>
      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((label) => (
          <li
            key={label}
            className={cn(
              "corp-card flex gap-3 border-border p-5 text-sm leading-relaxed text-text-secondary"
            )}
          >
            <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden />
            {label}
          </li>
        ))}
      </ul>
    </div>
  );
}
