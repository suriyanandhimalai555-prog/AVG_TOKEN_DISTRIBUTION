import type { ReactNode } from "react";

/** Modes the core POST /api/generate understands. */
export type WalletMode = "HD_SINGLE_SEED" | "INDEPENDENT_SEEDS";
/** Generate page choices: the core modes plus Managed Wallets pool wallets (admins). */
export type GenerateMode = WalletMode | "MANAGED_POOL";

interface WalletModeCardProps {
  mode: GenerateMode;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
  /** Extra line under the description (e.g. which pool, or why it is unavailable). */
  detail?: ReactNode;
}

const CARD_CONFIG = {
  HD_SINGLE_SEED: {
    title: "HD Single Seed",
    description:
      "One master mnemonic. All wallets derived via BIP44 path. Faster generation. Wallets are mathematically linked.",
    stats: [
      { label: "SPEED", value: "FAST", color: "#22c55e" },
      { label: "PRIVACY", value: "LINKED", color: "#f59e0b" },
      { label: "MNEMONIC", value: "1 SHARED", color: "#e8e8e8" },
    ],
  },
  INDEPENDENT_SEEDS: {
    title: "Independent Seeds",
    description:
      "Each wallet gets its own unique seed phrase. Looks like real independent users. Cannot be linked on-chain.",
    stats: [
      { label: "SPEED", value: "SLOWER", color: "#f59e0b" },
      { label: "PRIVACY", value: "ISOLATED", color: "#22c55e" },
      { label: "MNEMONIC", value: "UNIQUE", color: "#00d4aa" },
    ],
  },
  MANAGED_POOL: {
    title: "Pool wallets",
    description:
      "Wallets come from the Managed Wallets pool of this signing wallet. Distributed tokens show in the pool and only the master can move them.",
    stats: [
      { label: "BALANCES", value: "IN POOL", color: "#00d4aa" },
      { label: "CONTROL", value: "MASTER", color: "#22c55e" },
      { label: "KEYS ON DISK", value: "NONE", color: "#e8e8e8" },
    ],
  },
} as const;

export default function WalletModeCard({
  mode,
  selected,
  onSelect,
  disabled = false,
  detail,
}: WalletModeCardProps) {
  const config = CARD_CONFIG[mode];

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={() => !disabled && onSelect()}
      onKeyDown={(e) => {
        if (!disabled && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`p-4 transition-all duration-150 border font-mono ${
        selected ? "border-[#00d4aa] bg-[#00d4aa08]" : "border-[#1f1f23] hover:border-[#6b6b6b]"
      } ${disabled ? "pointer-events-none opacity-40" : "cursor-pointer"}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-mono text-sm font-medium text-[#e8e8e8]">{config.title}</p>
          {mode === "INDEPENDENT_SEEDS" && (
            <span className="text-[10px] font-mono px-2 py-0.5 border border-[#00d4aa] text-[#00d4aa]">
              RECOMMENDED
            </span>
          )}
          {mode === "MANAGED_POOL" && (
            <span className="text-[10px] font-mono px-2 py-0.5 border border-[#3b82f6] text-[#60a5fa]">
              MANAGED WALLETS
            </span>
          )}
        </div>
        {selected ? (
          <div className="w-3 h-3 rounded-full border border-[#00d4aa] bg-[#00d4aa] flex-shrink-0" />
        ) : (
          <div className="w-3 h-3 rounded-full border border-[#6b6b6b] flex-shrink-0" />
        )}
      </div>

      {mode === "HD_SINGLE_SEED" && (
        <span className="inline-block mt-2 text-[10px] font-mono px-2 py-0.5 border border-[#1f1f23] text-[#6b6b6b]">
          LEGACY MODE
        </span>
      )}

      <p className="mt-3 text-[12px] font-mono text-[#6b6b6b] leading-relaxed">{config.description}</p>
      {detail ? <div className="mt-2 text-[11px] font-mono leading-relaxed text-[#a3a3a3]">{detail}</div> : null}

      <div className="mt-3 flex gap-4">
        {config.stats.map((stat) => (
          <div key={stat.label}>
            <p className="text-[10px] text-[#6b6b6b] font-mono">{stat.label}</p>
            <p className="text-[12px] font-mono" style={{ color: stat.color }}>
              {stat.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
