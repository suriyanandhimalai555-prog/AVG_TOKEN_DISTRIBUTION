import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { TOKEN_HOLDER_FAQ } from "./tokenHolderFaqContent";

export function TokenHolderFaq({ className }: { className?: string }) {
  const items = [...TOKEN_HOLDER_FAQ];
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className={cn("max-w-[720px] mx-auto space-y-3 px-4", className)}>
      {items.map((item, i) => {
        const isOpen = open === i;
        return (
          <div key={item.q} className="corp-card overflow-hidden">
            <button
              type="button"
              id={`faq-${i}`}
              aria-expanded={isOpen}
              aria-controls={`faq-panel-${i}`}
              className="flex w-full items-center justify-between gap-4 px-6 py-4 text-left text-base font-semibold text-text-primary transition hover:bg-white/[0.03]"
              onClick={() => setOpen(isOpen ? null : i)}
            >
              <span>{item.q}</span>
              <ChevronDown
                className={cn("h-5 w-5 shrink-0 text-accent-light transition-transform duration-300", isOpen && "rotate-180")}
                aria-hidden
              />
            </button>
            <div
              id={`faq-panel-${i}`}
              role="region"
              aria-labelledby={`faq-${i}`}
              className={cn(
                "grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none",
                isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
              )}
            >
              <div className="min-h-0 overflow-hidden">
                <p className="border-t border-border px-6 pb-5 pt-4 text-base leading-relaxed text-text-secondary">{item.a}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
