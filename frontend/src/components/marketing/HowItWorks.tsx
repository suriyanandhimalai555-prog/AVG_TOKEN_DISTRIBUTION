import { useRevealOnScroll } from "@/hooks/useRevealOnScroll";
import { cn } from "@/lib/cn";

const STEPS = [
  {
    title: "Choose your package",
    body: "Review holder tiers from Starter through Elite, then continue to secure checkout. Crypto payments are processed via Coinbase Commerce.",
  },
  {
    title: "Complete setup",
    body: "Connect your token contract, funding wallet, and distribution parameters in the dashboard so batches run with the correct economics.",
  },
  {
    title: "Generate wallets",
    body: "Create the wallet set for your tier—up to 25,000 holders on Elite—and validate the plan before you send on-chain.",
  },
  {
    title: "Distribute in batches",
    body: "Run transfers with fixed or custom amounts per tier. Higher tiers unlock daily batch lanes and advanced scheduling where applicable.",
  },
  {
    title: "Export proof",
    body: "Download Excel reporting with addresses, amounts, and transaction references so finance and compliance can reconcile every payout.",
  },
];

export function HowItWorks({ className }: { className?: string }) {
  const top = STEPS.slice(0, 3);
  const bottom = STEPS.slice(3, 5);
  return (
    <div className={cn("max-w-[1100px] mx-auto px-4", className)}>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {top.map((step, i) => (
          <StepCard key={step.title} index={i + 1} title={step.title} body={step.body} />
        ))}
      </div>
      <div className="mt-6 grid max-w-[820px] grid-cols-1 gap-6 md:grid-cols-2 mx-auto">
        {bottom.map((step, i) => (
          <StepCard key={step.title} index={i + 4} title={step.title} body={step.body} />
        ))}
      </div>
    </div>
  );
}

function StepCard({ index, title, body }: { index: number; title: string; body: string }) {
  const { ref, visible } = useRevealOnScroll<HTMLElement>(0.12);
  return (
    <article
      ref={ref}
      className={cn(
        "corp-card border-l-4 border-l-[#3B82F6] p-6 md:p-8 transition duration-500 ease-out motion-reduce:transition-none",
        visible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[#3B82F6] to-[#60A5FA] text-lg font-bold text-white shadow-md">
        {index}
      </div>
      <h3 className="mt-5 text-xl font-semibold text-text-primary">{title}</h3>
      <p className="mt-3 text-base leading-relaxed text-text-secondary">{body}</p>
    </article>
  );
}
