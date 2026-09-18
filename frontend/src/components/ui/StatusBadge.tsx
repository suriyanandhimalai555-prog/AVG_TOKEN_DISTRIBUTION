type Status = "idle" | "generating" | "preparing" | "distributing" | "done" | "stopped" | "error" | "pending" | "confirmed" | "failed";

const CONFIG: Record<Status, { color: string; dot: string; label: string }> = {
  idle:         { color: "text-text-muted border-text-muted",   dot: "bg-text-muted",  label: "IDLE" },
  generating:   { color: "text-warning border-warning",         dot: "bg-warning",     label: "GENERATING" },
  preparing:    { color: "text-warning border-warning",         dot: "bg-warning",     label: "PREPARING" },
  distributing: { color: "text-accent border-accent",           dot: "bg-accent",      label: "DISTRIBUTING" },
  done:         { color: "text-success border-success",         dot: "bg-success",     label: "DONE" },
  stopped:      { color: "text-text-muted border-text-muted",   dot: "bg-text-muted",  label: "STOPPED" },
  error:        { color: "text-danger border-danger",           dot: "bg-danger",      label: "ERROR" },
  pending:      { color: "text-warning border-warning",         dot: "bg-warning",     label: "PENDING" },
  confirmed:    { color: "text-success border-success",         dot: "bg-success",     label: "CONFIRMED" },
  failed:       { color: "text-danger border-danger",           dot: "bg-danger",      label: "FAILED" },
};

interface StatusBadgeProps {
  status: Status;
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const cfg = CONFIG[status] ?? CONFIG.idle;
  const isActive = ["generating", "preparing", "distributing", "pending"].includes(status);
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 border rounded-full text-[10px] font-mono ${cfg.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} ${isActive ? "animate-pulse" : ""}`} />
      {cfg.label}
    </span>
  );
}
