import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { sessionsApi, type Session, type SessionAudit } from "@/lib/api";
import { store } from "@/lib/store";
import { fmt, fmtBnb, fmtTime } from "@/lib/utils";
import StatusBadge from "@/components/ui/StatusBadge";
import { useTheme } from "@/theme/ThemeProvider";

type StatusFilter = "all" | "idle" | "done" | "stopped";

export default function HistoryPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const ink = isDark ? "text-[#fafafa]" : "text-[#282828]";
  const soft = isDark ? "text-[#c4c8d0]" : "text-[#525252]";
  const bgLift = isDark ? "bg-[#111827]" : "bg-white";
  const panelHeader = isDark ? "bg-[#111827]" : "bg-[#f4f4f5]";
  const rowZebra = isDark ? "bg-[#0f172a]/50" : "bg-[#e8ecf2]";
  const rowHover = isDark ? "hover:bg-[#1e293b]" : "hover:bg-[#eef1f4]";
  const activeSessionId = store.getSessionId();

  const { data, isLoading } = useQuery({
    queryKey: ["sessions-history"],
    queryFn: () => sessionsApi.list().then((r) => r.data),
    refetchInterval: 10_000,
  });

  const sessions = data?.sessions ?? [];
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const filteredSessions = useMemo(() => {
    if (statusFilter === "all") return sessions;
    return sessions.filter((s: Session) => s.status === statusFilter);
  }, [sessions, statusFilter]);

  const filterOptions: { value: StatusFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "idle", label: "Idle" },
    { value: "done", label: "Done" },
    { value: "stopped", label: "Stopped" },
  ];

  const { data: historyData } = useQuery({
    queryKey: ["sessions-audit-history"],
    queryFn: () => sessionsApi.history(200).then((r) => r.data),
    refetchInterval: 15_000,
  });
  const audits = historyData?.audits ?? [];

  async function deleteSession(sessionId: string) {
    const confirmed = await new Promise<boolean>((resolve) => {
      const id = toast.custom((t) => (
        <div className={`border border-danger ${bgLift} p-3 w-[360px]`}>
          <p className="text-[11px] font-mono uppercase tracking-widest text-danger">Delete Session?</p>
          <p className={`mt-2 text-[12px] font-mono ${soft}`}>
            This will remove session, wallets, and batch records permanently.
          </p>
          <p className={`mt-1 text-[11px] font-mono ${ink}`}>ID: {sessionId.slice(-16)}</p>
          <div className="mt-3 flex justify-end gap-2">
            <button
              className={`px-3 py-1 border border-border ${soft} hover:border-accent hover:text-accent text-[11px] font-mono uppercase`}
              onClick={() => {
                toast.dismiss(t.id);
                resolve(false);
              }}
            >
              Cancel
            </button>
            <button
              className="px-3 py-1 border border-danger text-danger hover:bg-danger hover:text-white text-[11px] font-mono uppercase"
              onClick={() => {
                toast.dismiss(t.id);
                resolve(true);
              }}
            >
              Delete
            </button>
          </div>
        </div>
      ), { duration: Infinity });
      void id;
    });
    if (!confirmed) return;
    try {
      await sessionsApi.delete(sessionId);
      if (activeSessionId === sessionId) {
        store.clearSessionId();
      }
      toast.success("Session deleted");
      await qc.invalidateQueries({ queryKey: ["sessions-history"] });
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "Failed to delete session";
      toast.error(message);
    }
  }

  function openSession(sessionId: string, target: "results" | "distribute" | "plan") {
    store.setSessionId(sessionId);
    navigate(`/dashboard/${target}`);
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className={`text-xl font-mono font-bold ${ink} uppercase tracking-wide`}>Session History</h1>
        <p className={`mt-1 text-sm ${soft} font-mono`}>
          Open any previous session and continue from where it stopped.
        </p>
      </div>

      <div className="dash-card">
        <div className={`px-4 py-2 border-b border-border flex flex-wrap items-center justify-between gap-3 ${panelHeader}`}>
          <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
            <p className={`text-[10px] font-mono uppercase tracking-widest ${soft}`}>
              ALL SESSIONS — {fmt(sessions.length)}
            </p>
            {statusFilter !== "all" && sessions.length > 0 && (
              <p className={`text-[10px] font-mono uppercase tracking-widest ${ink}`}>
                Showing {fmt(filteredSessions.length)} of {fmt(sessions.length)}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {filterOptions.map(({ value, label }) => {
              const active = statusFilter === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setStatusFilter(value)}
                  className={`rounded border px-2 py-1 text-[10px] font-mono uppercase tracking-wide transition-colors ${
                    active
                      ? "border-accent bg-accent-dim text-accent"
                      : `border-border ${soft} hover:border-accent hover:text-accent`
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="border-b border-border">
                {["SESSION ID", "CREATED", "NETWORK", "WALLETS", "SENT", "FAILED", "BNB", "STATUS", "ACTIONS"].map((h) => (
                  <th key={h} className={`text-left py-2 px-3 text-[10px] uppercase tracking-widest ${soft} font-normal`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={9} className={`py-8 text-center ${soft}`}>Loading sessions...</td>
                </tr>
              )}
              {!isLoading && sessions.length === 0 && (
                <tr>
                  <td colSpan={9} className={`py-8 text-center ${soft}`}>No session history found.</td>
                </tr>
              )}
              {!isLoading && sessions.length > 0 && filteredSessions.length === 0 && (
                <tr>
                  <td colSpan={9} className={`py-8 text-center ${soft}`}>No sessions match this filter.</td>
                </tr>
              )}
              {filteredSessions.map((s, i) => {
                const isActive = activeSessionId === s._id;
                return (
                  <tr key={s._id} className={`border-b border-border/50 ${rowHover} transition-colors ${i % 2 === 1 ? rowZebra : ""}`}>
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-2">
                        <span className={ink}>{s._id.slice(-16)}</span>
                        {isActive && (
                          <span className="text-[10px] border border-accent text-accent px-1.5 py-0.5">ACTIVE</span>
                        )}
                      </div>
                    </td>
                    <td className={`py-2 px-3 ${soft}`}>{fmtTime(s.createdAt)}</td>
                    <td className={`py-2 px-3 ${soft}`}>{s.network}</td>
                    <td className={`py-2 px-3 ${ink}`}>{fmt(s.totalWallets)}</td>
                    <td className="py-2 px-3 text-success">{fmt(s.sentCount)}</td>
                    <td className="py-2 px-3 text-danger">{fmt(s.failedCount)}</td>
                    <td className="py-2 px-3 text-accent">{fmtBnb(s.bnbSpent)}</td>
                    <td className="py-2 px-3"><StatusBadge status={s.status} /></td>
                    <td className="py-2 px-3">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => openSession(s._id, "results")}
                          className={`px-2 py-1 border border-border ${soft} hover:border-accent hover:text-accent`}
                        >
                          RESULTS
                        </button>
                        <button
                          type="button"
                          disabled={s.status === "done"}
                          onClick={() => openSession(s._id, "distribute")}
                          className={`px-2 py-1 border border-border ${soft} hover:border-accent hover:text-accent disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:text-current`}
                        >
                          DISTRIBUTE
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteSession(s._id)}
                          className="px-2 py-1 border border-danger text-danger hover:bg-danger hover:text-white"
                        >
                          DELETE
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="dash-card mt-6">
        <div className={`px-4 py-2 border-b border-border ${panelHeader}`}>
          <p className={`text-[10px] font-mono uppercase tracking-widest ${soft}`}>
            SESSION TIMELINE — backend audit log
          </p>
        </div>
        <div className="max-h-[360px] overflow-y-auto">
          {audits.length === 0 ? (
            <p className={`py-6 px-4 ${soft} font-mono text-xs`}>No audit history yet.</p>
          ) : (
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="border-b border-border">
                  {["TIME", "SESSION ID", "ACTION", "MESSAGE"].map((h) => (
                    <th key={h} className={`text-left py-2 px-3 text-[10px] uppercase tracking-widest ${soft} font-normal`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {audits.map((a: SessionAudit, i) => (
                  <tr key={a._id} className={`border-b border-border/50 ${rowHover} transition-colors ${i % 2 === 1 ? rowZebra : ""}`}>
                    <td className={`py-2 px-3 ${soft}`}>{fmtTime(a.createdAt)}</td>
                    <td className={`py-2 px-3 ${ink}`}>{a.sessionId.slice(-16)}</td>
                    <td className="py-2 px-3 text-accent">{a.action}</td>
                    <td className={`py-2 px-3 ${soft}`}>{a.message ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
