import { Check, X } from "lucide-react";
import { TOKEN_HOLDER_PLANS } from "@shared/plans";
import { cn } from "@/lib/cn";

const ROWS: { label: string; values: [string, string, string, string, string] }[] = [
  {
    label: "Wallets",
    values: ["1,000", "2,500", "5,000", "10,000", "25,000"],
  },
  {
    label: "Price",
    values: ["$60", "$120", "$210", "$360", "$720"],
  },
  {
    label: "Transfer Style",
    values: ["Fixed", "Fixed", "Custom/Random", "Custom/Random", "Custom/Random"],
  },
  {
    label: "Daily Batch Transfer",
    values: ["—", "—", "Yes", "Yes", "Yes"],
  },
  {
    label: "Excel Report",
    values: ["Yes", "Yes", "Yes", "Yes", "Yes"],
  },
  {
    label: "Transaction Hash Proof",
    values: ["Yes", "Yes", "Yes", "Yes", "Yes"],
  },
  {
    label: "Delivery",
    values: [
      "Within 24 Hours",
      "Within 24 Hours",
      "Daily Batch Available",
      "Daily Batch Available",
      "Custom Schedule",
    ],
  },
];

export function PackageComparisonTable() {
  const featuredKey = TOKEN_HOLDER_PLANS.find((p) => "popular" in p && p.popular)?.key;

  return (
    <div className="max-w-[1200px] mx-auto px-4 overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left text-base">
        <caption className="sr-only">Package comparison across Starter, Growth, Scale, Pro, and Elite</caption>
        <thead>
          <tr className="bg-corp-elevated/80">
            <th
              scope="col"
              className="rounded-tl-xl border border-border px-4 py-4 font-semibold text-text-secondary"
            >
              Feature
            </th>
            {TOKEN_HOLDER_PLANS.map((p) => (
              <th
                key={p.key}
                scope="col"
                className={cn(
                  "border border-border px-4 py-4 font-semibold text-text-primary",
                  p.key === featuredKey && "bg-[#3B82F6]/15 text-[#93C5FD]",
                  p.key === TOKEN_HOLDER_PLANS[TOKEN_HOLDER_PLANS.length - 1].key && "rounded-tr-xl"
                )}
              >
                {p.name.replace(" Pack", "")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.label} className="border-b border-border">
              <th
                scope="row"
                className="border border-border bg-surface/50 px-4 py-3 font-medium text-text-secondary"
              >
                {row.label}
              </th>
              {row.values.map((cell, i) => {
                const plan = TOKEN_HOLDER_PLANS[i];
                const isFeatured = plan.key === featuredKey;
                const isDailyRow = row.label === "Daily Batch Transfer";
                const showCheck =
                  row.label === "Excel Report" || row.label === "Transaction Hash Proof";
                const showX = isDailyRow && i < 2;

                return (
                  <td
                    key={plan.key}
                    className={cn(
                      "border border-border px-4 py-3 text-text-primary",
                      isFeatured && "bg-[#3B82F6]/10"
                    )}
                  >
                    {showCheck ? (
                      <span className="inline-flex items-center gap-1 text-success">
                        <Check className="h-5 w-5" aria-label="Yes" />
                      </span>
                    ) : showX ? (
                      <span className="inline-flex items-center text-danger">
                        <X className="h-5 w-5" strokeWidth={2} aria-label="No" />
                      </span>
                    ) : isDailyRow && i >= 2 ? (
                      <span className="inline-flex items-center text-success">
                        <Check className="h-5 w-5" aria-label="Yes" />
                      </span>
                    ) : (
                      cell
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
