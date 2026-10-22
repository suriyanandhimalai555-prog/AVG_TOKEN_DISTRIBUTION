import type { Network } from "@/lib/managedTypes";
import { networkLabel } from "./format";

/** Mainnet is amber, testnet is accent — same cue as the Setup page network buttons. */
export default function NetworkBadge({ network, compact = false }: { network: Network; compact?: boolean }) {
  const mainnet = network === "bscMainnet";
  const tone = mainnet ? "border-warning/40 bg-warning/10 text-warning" : "border-accent/40 bg-accent/10 text-accent dark:text-accent-light";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${mainnet ? "bg-warning" : "bg-accent"}`} />
      {compact ? (mainnet ? "Mainnet" : "Testnet") : networkLabel(network)}
    </span>
  );
}
