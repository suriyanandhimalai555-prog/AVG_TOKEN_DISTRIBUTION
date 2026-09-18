import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { statusApi } from "@/lib/api";
import { store } from "@/lib/store";
import { fmtBnb, fmt } from "@/lib/utils";

export default function TopBar() {
  const sessionId = store.getSessionId();

  const { data } = useQuery({
    queryKey: ["status", sessionId],
    queryFn: () => statusApi.get(sessionId),
    enabled: !!sessionId,
    refetchInterval: 10_000,
    retry: (count, err) => {
      if (axios.isAxiosError(err) && err.response?.status === 404) return false;
      return count < 2;
    },
  });

  const showSessionStrip = !!sessionId && !!data;

  return (
    <div className="fixed top-0 left-14 right-0 z-40 flex h-10 items-center gap-4 border-b border-[var(--app-border)] bg-[var(--app-surface)] px-6 transition-[box-shadow] duration-200 shadow-sm/50">
      {showSessionStrip ? (
        <div className="flex min-w-0 flex-1 items-center gap-8 overflow-x-auto">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--app-muted)]">Session</span>
            <span className="font-mono text-[11px] text-[var(--app-text)]">{sessionId.slice(-12)}</span>
          </div>

          <div className="h-4 w-px flex-shrink-0 bg-[var(--app-border)]" />

          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--app-muted)]">Status</span>
            <span
              className={`font-mono text-[11px] uppercase ${
                data.status === "done"
                  ? "text-success"
                  : data.status === "distributing" || data.status === "generating"
                    ? "text-warning"
                    : data.status === "error"
                      ? "text-danger"
                      : "text-[var(--app-muted)]"
              }`}
            >
              {data.status}
            </span>
          </div>

          <div className="h-4 w-px flex-shrink-0 bg-[var(--app-border)]" />

          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--app-muted)]">Sent</span>
            <span className="font-mono text-[11px] text-[var(--app-text)]">
              {fmt(data.sentCount)} / {fmt(data.totalWallets)}
            </span>
          </div>

          <div className="h-4 w-px flex-shrink-0 bg-[var(--app-border)]" />

          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--app-muted)]">BNB spent</span>
            <span className="font-mono text-[11px] text-accent">{fmtBnb(data.bnbSpent)}</span>
          </div>
        </div>
      ) : (
        <div className="flex-1" aria-hidden />
      )}
    </div>
  );
}
