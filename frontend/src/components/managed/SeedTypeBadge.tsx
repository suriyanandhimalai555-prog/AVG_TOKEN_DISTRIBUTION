import { KeyRound } from "lucide-react";
import type { PoolSeedType } from "@/lib/managedTypes";

/** Marks pools whose secret is an imported private key; phrase pools show nothing. */
export default function SeedTypeBadge({ seedType }: { seedType: PoolSeedType | undefined }) {
  if (seedType !== "PRIVATE_KEY") return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent dark:text-accent-light"
      title="The master is an imported private key; managed wallets derive from it"
    >
      <KeyRound size={10} aria-hidden /> Imported key
    </span>
  );
}
