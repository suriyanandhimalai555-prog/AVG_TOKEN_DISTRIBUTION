interface ProgressBarProps {
  value: number; // 0–100
  className?: string;
  color?: string;
}

export default function ProgressBar({ value, className = "", color = "bg-accent" }: ProgressBarProps) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className={`w-full h-1 bg-border ${className}`}>
      <div
        className={`h-full ${color} transition-all duration-500`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
