interface CountdownPanelProps {
  secondsRemaining: number;
  totalSeconds: number;
  currentWallet: number;
  remainingWallets: number;
  totalElapsed: number;
}

function formatCountdown(secs: number): string {
  const m = Math.floor(secs / 60)
    .toString()
    .padStart(2, "0");
  const s = (secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function formatElapsed(secs: number): string {
  if (secs < 3600) {
    const m = Math.floor(secs / 60)
      .toString()
      .padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60)
    .toString()
    .padStart(2, "0");
  return `${h}h ${m}m`;
}

export default function CountdownPanel({
  secondsRemaining,
  totalSeconds,
  currentWallet,
  remainingWallets,
  totalElapsed,
}: CountdownPanelProps) {
  const delayProgressPct =
    totalSeconds > 0 ? ((totalSeconds - secondsRemaining) / totalSeconds) * 100 : 0;

  return (
    <div className="bg-[#111113] border border-[#1f1f23] p-6 mt-4 font-mono">
      <div className="flex items-center justify-between mb-4">
        <p className="text-[11px] uppercase tracking-widest text-[#6b6b6b] font-mono">
          NEXT TRANSFER IN
        </p>
        <span className="text-[10px] font-mono px-2 py-0.5 border border-[#00d4aa22] text-[#00d4aa] animate-pulse">
          ● DELAY ACTIVE
        </span>
      </div>

      <p className="text-6xl font-mono font-bold text-[#00d4aa] text-center tabular-nums">
        {formatCountdown(secondsRemaining)}
      </p>
      <p className="text-[11px] font-mono text-[#6b6b6b] text-center mt-2 uppercase tracking-widest">
        SECONDS REMAINING
      </p>

      <div className="w-full h-1 bg-[#1f1f23] mt-4">
        <div
          className="h-full bg-[#00d4aa] transition-all duration-1000"
          style={{ width: `${delayProgressPct}%` }}
        />
      </div>

      <div className="flex justify-between mt-4 text-[11px] font-mono text-[#6b6b6b]">
        <span>CURRENT WALLET: #{currentWallet}</span>
        <span>REMAINING: {remainingWallets} wallets</span>
        <span>ELAPSED: {formatElapsed(totalElapsed)}</span>
      </div>
    </div>
  );
}
