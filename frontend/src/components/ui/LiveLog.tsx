import { useEffect, useRef, useState, useCallback } from "react";
import { X } from "lucide-react";
import { bscScanTx, shortHash } from "@/lib/utils";
import { useTheme } from "@/theme/ThemeProvider";

export interface LogLine {
  timestamp: string;
  batchIndex?: number;
  totalBatches?: number;
  walletCount?: number;
  txHash?: string | null;
  status?: "pending" | "confirmed" | "failed";
  gasUsed?: string | null;
  message?: string;
  level?: "info" | "warn" | "error";
  type?: "batch" | "log";
}

interface LiveLogProps {
  sessionId: string;
  onBatch?: (line: LogLine) => void;
}

const MAX_LINES = 500;
const STATUS_COLOR: Record<string, string> = {
  confirmed: "text-success",
  pending: "text-warning",
  failed: "text-danger",
};

export default function LiveLog({ sessionId, onBatch }: LiveLogProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const logShell = isDark ? "bg-[#0b0f1f]" : "bg-white";
  const logHeader = isDark ? "bg-[#111827]" : "bg-[#f4f4f5]";
  const ink = isDark ? "text-[#fafafa]" : "text-[#282828]";
  const soft = isDark ? "text-[#c4c8d0]" : "text-[#525252]";

  const [lines, setLines] = useState<LogLine[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  const addLine = useCallback((line: LogLine) => {
    setLines((prev) => {
      const next = [...prev, line];
      return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
    });
  }, []);

  useEffect(() => {
    if (!sessionId) return;

    setLines([]);

    const baseUrl = import.meta.env.VITE_API_URL?.trim() ?? "";
    const sseUrl = `${baseUrl}/api/progress?sessionId=${encodeURIComponent(sessionId)}`;
    const es = new EventSource(sseUrl, { withCredentials: true });
    esRef.current = es;

    es.addEventListener("batch", (e: MessageEvent) => {
      const data = JSON.parse(e.data) as LogLine;
      addLine({ ...data, type: "batch" });
      onBatch?.(data);
    });

    es.addEventListener("log", (e: MessageEvent) => {
      const data = JSON.parse(e.data) as { message?: string; ts?: string; level?: "warn" | "error" | "info" };
      addLine({
        type: "log",
        timestamp: data.ts ?? new Date().toISOString(),
        message: data.message ?? "",
        level: data.level ?? "info",
      });
    });

    es.addEventListener("error", () => {
      // SSE connection error — will auto-reconnect
    });

    return () => {
      es.close();
    };
  }, [sessionId, addLine, onBatch]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  }

  function clearLog() {
    setLines([]);
  }

  return (
    <div className={`border border-border flex flex-col ${logShell}`} style={{ height: "360px" }}>
      {/* Header */}
      <div className={`flex items-center justify-between px-3 py-2 border-b border-border ${logHeader}`}>
        <span className={`text-[10px] font-mono uppercase tracking-widest ${soft}`}>
          LIVE LOG — {lines.length} lines
        </span>
        <div className="flex items-center gap-3">
          {!autoScroll && (
            <button
              onClick={() => {
                setAutoScroll(true);
                containerRef.current?.scrollTo({ top: 99999, behavior: "smooth" });
              }}
              className="text-[10px] font-mono text-accent hover:underline"
            >
              SCROLL TO BOTTOM
            </button>
          )}
          <button onClick={clearLog} className={`${soft} hover:text-danger transition-colors`}>
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Log content */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className={`flex-1 overflow-y-auto p-3 font-mono text-[12px] leading-5 ${ink}`}
      >
        {lines.length === 0 && (
          <p className={soft}>Waiting for distribution events...</p>
        )}
        {lines.map((line, i) => (
          <div key={i} className="flex items-start gap-2 animate-fade-in">
            <span className={`${soft} flex-shrink-0`}>[{line.timestamp?.slice(11, 19) ?? "—"}]</span>
            {line.type === "batch" ? (
              <>
                <span className={soft}>
                  Batch {line.batchIndex}/{line.totalBatches} | {line.walletCount} wallets |
                </span>
                {line.txHash ? (
                  <a
                    href={bscScanTx(line.txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline"
                  >
                    TX: {shortHash(line.txHash)}
                  </a>
                ) : (
                  <span className={soft}>TX: —</span>
                )}
                {line.gasUsed && (
                  <span className={soft}>| GAS: {Number(line.gasUsed).toLocaleString()}</span>
                )}
                <span className={`font-bold ${STATUS_COLOR[line.status ?? ""] ?? soft}`}>
                  | {(line.status ?? "pending").toUpperCase()}
                </span>
              </>
            ) : (
              <span
                className={
                  line.level === "error"
                    ? "text-danger"
                    : line.level === "warn"
                      ? "text-warning"
                      : soft
                }
              >
                {line.message || "…"}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
