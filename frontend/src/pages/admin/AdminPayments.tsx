import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import RouteErrorFallback from "@/components/RouteErrorFallback";

interface PopulatedUser {
  _id?: string;
  email?: string;
  name?: string;
}

interface PayRow {
  _id?: string;
  createdAt?: string;
  amount: number;
  coinbaseCryptoType?: string;
  coinbaseChargeId?: string;
  coinbaseChargeCode?: string;
  planKey?: string;
  coinbaseTxHash?: string;
  status: string;
  userId?: PopulatedUser;
}

export default function AdminPayments() {
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<string>("ALL");
  const limit = 20;

  const statusFilter = tab === "ALL" ? "" : tab;

  const queryKey = ["admin-pay", page, statusFilter];

  const { data, isLoading, error, refetch } = useQuery({
    queryKey,
    queryFn: () =>
      api
        .get<{ payments: PayRow[]; total: number }>(
          `/api/admin/payments?page=${page}&limit=${limit}&status=${encodeURIComponent(statusFilter)}`
        )
        .then((r) => r.data),
  });

  const csv = useMemo(() => {
    const rows = (data?.payments ?? []).map(
      (p) =>
        [
          new Date(p.createdAt ?? "").toISOString(),
          p.userId?.email ?? "",
          p.planKey,
          String(p.amount),
          p.coinbaseCryptoType ?? "",
          p.coinbaseChargeId ?? "",
          p.status,
        ].join(",")
    );
    return ["DATE,EMAIL,PLAN,AMOUNT,CRYPTO,CHARGE,STATUS", ...rows].join("\n");
  }, [data]);

  if (error) return <RouteErrorFallback message="Unable to load payments." onRetry={() => refetch()} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-[11px] text-[#6b6b6b] uppercase tracking-widest">Admin · Payments</p>
        <button
          type="button"
          onClick={() => {
            const blob = new Blob([csv], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "payments.csv";
            a.click();
            URL.revokeObjectURL(url);
          }}
          className="text-[10px] uppercase px-4 py-2 border border-accent text-accent hover:bg-accent hover:text-black"
        >
          Export CSV
        </button>
      </div>

      <div className="flex flex-wrap gap-2 text-[11px] font-mono uppercase">
        {(["ALL", "CONFIRMED", "PENDING", "NEW", "FAILED", "EXPIRED"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setPage(1);
              setTab(t);
            }}
            className={`px-4 py-1 border rounded-none transition-colors ${
              tab === t ? "border-[#00d4aa] text-[#00d4aa]" : "border-[#1f1f23] text-[#6b6b6b]"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="font-mono text-[11px] text-[#6b6b6b] py-16 text-center uppercase">Loading…</p>
      ) : (
        <div className="overflow-x-auto border border-[#1f1f23] rounded-none">
          <table className="w-full text-[11px] font-mono text-left border-collapse">
            <thead className="bg-[#111113] text-[#6b6b6b] uppercase tracking-wider">
              <tr>
                <th className="py-3 px-2">DATE</th>
                <th className="py-3 px-2">EMAIL</th>
                <th className="py-3 px-2">PLAN</th>
                <th className="py-3 px-2">AMOUNT</th>
                <th className="py-3 px-2">CRYPTO</th>
                <th className="py-3 px-2">CHARGE</th>
                <th className="py-3 px-2">STATUS</th>
              </tr>
            </thead>
            <tbody>
              {(data?.payments ?? []).map((p, i) => (
                <tr key={p._id ?? p.coinbaseChargeId} className={`border-t border-[#1f1f23] ${i % 2 ? "bg-[#111113]" : ""}`}>
                  <td className="py-2 px-2 text-[#9a9a9a]">
                    {p.createdAt ? new Date(p.createdAt).toLocaleDateString() : "—"}
                  </td>
                  <td className="py-2 px-2">{p.userId?.email ?? "—"}</td>
                  <td className="py-2 px-2">{p.planKey}</td>
                  <td className="py-2 px-2">${p.amount}</td>
                  <td className="py-2 px-2">{p.coinbaseCryptoType ?? "—"}</td>
                  <td className="py-2 px-2 truncate max-w-[120px]">
                    {p.coinbaseChargeCode ? (
                      <a
                        href={`https://commerce.coinbase.com/charges/${p.coinbaseChargeCode}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#00d4aa] underline"
                      >
                        {p.coinbaseChargeCode.slice(0, 12)}…
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2 px-2">{p.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex justify-between text-[11px] text-[#6b6b6b] font-mono">
        <span>Total {data?.total ?? 0}</span>
        <div className="flex gap-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="border border-[#1f1f23] px-3 py-1 rounded-none disabled:opacity-25"
          >
            Prev
          </button>
          <button
            disabled={page * limit >= (data?.total ?? 0)}
            onClick={() => setPage((p) => p + 1)}
            className="border border-[#1f1f23] px-3 py-1 rounded-none disabled:opacity-25"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
