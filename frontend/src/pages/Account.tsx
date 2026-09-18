import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { findPlan } from "@shared/plans";
import type { AuthSubscription } from "@/lib/authTypes";
import { ThemeToggleButton } from "@/components/ThemeToggleButton";

interface PayRow {
  chargeId: string;
  chargeCode: string;
  amount: number;
  cryptoType?: string;
  txHash?: string;
  status: string;
  planKey: string;
  productLine: string;
  createdAt: string;
  paidAt?: string;
}

function initials(name: string | undefined | null): string {
  const p = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "?";
  return `${p[0][0]}${p[1]?.[0] ?? ""}`.toUpperCase();
}

function txUrl(hash: string): string {
  if (hash.startsWith("0x")) return `https://etherscan.io/tx/${hash}`;
  return `https://bscscan.com/tx/${hash}`;
}

export default function AccountPage() {
  const navigate = useNavigate();
  const [sub, setSub] = useState<AuthSubscription | null>(null);
  const [user, setUser] = useState<{ name: string; email: string; avatar?: string } | null>(null);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<PayRow[]>([]);
  const [total, setTotal] = useState(0);
  const limit = 10;

  useEffect(() => {
    void (async () => {
      try {
        const { data } = await api.get<{ user: typeof user; subscription: AuthSubscription | null }>(
          "/api/auth/me"
        );
        setUser(data.user);
        setSub(data.subscription ?? null);
      } catch {
        toast.error("Could not load account");
      }
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const { data } = await api.get<{ payments: PayRow[]; total: number; page: number; limit: number }>(
          `/api/payments/history?page=${page}&limit=${limit}`
        );
        setRows(data.payments);
        setTotal(data.total);
      } catch {
        toast.error("Could not load payment history");
      }
    })();
  }, [page]);

  async function signOut(): Promise<void> {
    try {
      await api.post("/api/auth/logout");
      navigate("/");
      window.location.reload();
    } catch {
      toast.error("Logout failed");
    }
  }

  const planDoc = sub ? findPlan(sub.productLine, sub.planKey) : null;
  const planLabel = planDoc ? `${planDoc.name} — ${sub!.productLine.replace("_", " ")}` : "No plan";

  const pages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="relative min-h-screen bg-terminal text-text-primary font-sans p-6 max-w-6xl mx-auto">
      <div className="absolute right-4 top-6 z-10">
        <ThemeToggleButton />
      </div>
      <div className="grid md:grid-cols-5 gap-6">
        <div className="md:col-span-3 border border-border p-6 rounded-none">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full overflow-hidden border border-border bg-panel flex items-center justify-center text-[#00d4aa] font-bold">
              {user?.avatar ? <img src={user.avatar} alt="" className="w-full h-full object-cover" /> : initials(user?.name ?? "?")}
            </div>
            <div>
              <p className="font-bold text-lg">{user?.name}</p>
              <p className="text-sm text-text-muted">{user?.email}</p>
            </div>
          </div>
          <hr className="border-border my-6" />
          <p className="text-[10px] text-text-muted uppercase tracking-widest">Current plan</p>
          <p className="text-lg mt-2 uppercase tracking-wide">{planLabel}</p>
          {sub && (
            <span
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 border rounded-full text-xs mt-3 ${
                sub.status === "ACTIVE"
                  ? "border-[#22c55e] text-[#22c55e]"
                  : sub.status === "PENDING"
                  ? "border-[#f59e0b] text-[#f59e0b]"
                  : "border-[#ef4444] text-[#ef4444]"
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
              {sub.status}
            </span>
          )}
          {sub && (
            <>
              <p className="text-sm mt-4 text-text-primary">
                Wallet limit: {sub.walletLimit.toLocaleString()}
              </p>
              <p className="text-[11px] text-text-muted mt-1">
                {sub.productLine === "TOKEN_HOLDER"
                  ? `Valid until: ${sub.expiresAt ? new Date(sub.expiresAt).toLocaleDateString() : "—"}`
                  : `Renews: ${sub.expiresAt ? new Date(sub.expiresAt).toLocaleDateString() : "—"}`}
              </p>
            </>
          )}
          <Link
            to="/onboarding"
            className="mt-8 block w-full text-center py-3 border border-[#00d4aa] text-[#00d4aa] uppercase text-xs hover:bg-[#00d4aa] hover:text-white"
          >
            UPGRADE PLAN →
          </Link>
          <button
            type="button"
            onClick={() => void signOut()}
            className="mt-3 block w-full text-center py-2 border border-transparent text-text-muted text-xs uppercase hover:text-text-primary"
          >
            SIGN OUT
          </button>
        </div>

        <div className="md:col-span-2 border border-border p-6 rounded-none">
          <p className="text-[10px] text-text-muted uppercase tracking-widest">Payment history</p>
          {rows.length === 0 ? (
            <p className="mt-10 text-center text-text-muted text-xs">No payment history yet.</p>
          ) : (
            <>
              <div className="mt-6 overflow-x-auto">
                <table className="w-full text-[11px] font-mono text-left border-collapse">
                  <thead className="text-text-muted uppercase tracking-wider">
                    <tr className="border-b border-border">
                      <th className="py-2 px-2">Date</th>
                      <th className="py-2 px-2">Plan</th>
                      <th className="py-2 px-2">$</th>
                      <th className="py-2 px-2">Crypto</th>
                      <th className="py-2 px-2">TX</th>
                      <th className="py-2 px-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r.chargeId} className={i % 2 === 1 ? "bg-panel" : ""}>
                        <td className="py-2 px-2 text-text-secondary">
                          {new Date(r.createdAt).toLocaleDateString()}
                        </td>
                        <td className="py-2 px-2">{r.planKey}</td>
                        <td className="py-2 px-2">${r.amount}</td>
                        <td className="py-2 px-2">{r.cryptoType ?? "—"}</td>
                        <td className="py-2 px-2 truncate max-w-[80px]">
                          {r.txHash ? (
                            <a href={txUrl(r.txHash)} target="_blank" rel="noopener noreferrer" className="text-[#00d4aa] underline">
                              {r.txHash.slice(0, 6)}…
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-2 px-2">
                          <span
                            className={
                              r.status === "CONFIRMED"
                                ? "text-[#22c55e]"
                                : r.status === "FAILED" || r.status === "EXPIRED"
                                ? "text-[#ef4444]"
                                : "text-[#f59e0b]"
                            }
                          >
                            {r.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-between items-center mt-4 text-[10px] text-text-muted uppercase">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="border border-border px-3 py-1 disabled:opacity-30"
                >
                  ← Prev
                </button>
                <span>
                  {page} / {pages}
                </span>
                <button
                  type="button"
                  disabled={page >= pages}
                  onClick={() => setPage((p) => p + 1)}
                  className="border border-border px-3 py-1 disabled:opacity-30"
                >
                  Next →
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
