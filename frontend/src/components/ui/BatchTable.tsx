import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import StatusBadge from "./StatusBadge";
import TxHashLink from "./TxHashLink";
import { fmt, fmtGas, fmtTime } from "@/lib/utils";
import { useTheme } from "@/theme/ThemeProvider";

interface Batch {
  _id: string;
  batchIndex: number;
  walletCount: number;
  txHash?: string;
  gasUsed?: string;
  status: "pending" | "confirmed" | "failed";
  createdAt: string;
  confirmedAt?: string;
}

interface BatchTableProps {
  sessionId: string;
}

const PAGE_SIZE = 20;

export default function BatchTable({ sessionId }: BatchTableProps) {
  const [page, setPage] = useState(0);
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const ink = isDark ? "text-[#fafafa]" : "text-[#282828]";
  const soft = isDark ? "text-[#c4c8d0]" : "text-[#525252]";
  const rowZebra = isDark ? "bg-[#0f172a]/50" : "bg-[#e8ecf2]";
  const rowHover = isDark ? "hover:bg-[#1e293b]" : "hover:bg-[#eef1f4]";

  const { data } = useQuery({
    queryKey: ["batches", sessionId, page],
    queryFn: () =>
      api
        .get<{ batches: Batch[]; total: number }>(
          `/api/batches?sessionId=${sessionId}&skip=${page * PAGE_SIZE}&limit=${PAGE_SIZE}`
        )
        .then((r) => r.data),
    enabled: !!sessionId,
    refetchInterval: 5000,
  });

  const batches = data?.batches ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="border-b border-border">
              {["BATCH", "WALLETS", "TX HASH", "GAS", "STATUS", "TIME"].map((h) => (
                <th key={h} className={`text-left py-2 px-3 text-[10px] uppercase tracking-widest ${soft} font-normal`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {batches.length === 0 && (
              <tr>
                <td colSpan={6} className={`py-8 text-center ${soft}`}>
                  No batches yet.
                </td>
              </tr>
            )}
            {batches.map((batch, i) => (
              <tr
                key={batch._id}
                className={`border-b border-border/50 ${rowHover} transition-colors ${
                  i % 2 === 1 ? rowZebra : ""
                }`}
              >
                <td className={`py-2 px-3 ${ink}`}>#{fmt(batch.batchIndex)}</td>
                <td className={`py-2 px-3 ${ink}`}>{fmt(batch.walletCount)}</td>
                <td className="py-2 px-3">
                  <TxHashLink hash={batch.txHash} />
                </td>
                <td className={`py-2 px-3 ${soft}`}>{fmtGas(batch.gasUsed)}</td>
                <td className="py-2 px-3">
                  <StatusBadge status={batch.status} />
                </td>
                <td className={`py-2 px-3 ${soft}`}>{fmtTime(batch.confirmedAt ?? batch.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 px-3">
          <span className={`text-[10px] font-mono ${soft}`}>
            Page {page + 1} of {totalPages} ({fmt(total)} total)
          </span>
          <div className="flex gap-2">
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              className={`px-3 py-1 border border-border text-[10px] font-mono ${soft} hover:border-accent hover:text-accent disabled:opacity-30 transition-colors`}
            >
              PREV
            </button>
            <button
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
              className={`px-3 py-1 border border-border text-[10px] font-mono ${soft} hover:border-accent hover:text-accent disabled:opacity-30 transition-colors`}
            >
              NEXT
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
