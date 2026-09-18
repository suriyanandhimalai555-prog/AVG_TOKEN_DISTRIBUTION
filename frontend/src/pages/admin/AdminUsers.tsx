import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import RouteErrorFallback from "@/components/RouteErrorFallback";
import { useAuth } from "@/hooks/useAuth";

interface UserDoc {
  _id: string;
  email: string;
  name: string;
  role: "USER" | "ADMIN";
  createdAt?: string;
  subscription?: { status?: string; walletLimit?: number; planKey?: string };
}

export default function AdminUsers() {
  const { user: me } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const limit = 15;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin-users", page, search],
    queryFn: () =>
      api
        .get<{ users: UserDoc[]; total: number }>(
          `/api/admin/users?page=${page}&limit=${limit}&search=${encodeURIComponent(search)}`
        )
        .then((r) => r.data),
  });

  if (error) return <RouteErrorFallback message="Unable to load users." onRetry={() => refetch()} />;

  async function patchUser(id: string, body: Record<string, unknown>): Promise<void> {
    await api.patch(`/api/admin/users/${id}`, body);
    await refetch();
  }

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-[#6b6b6b] uppercase tracking-widest">Admin · Users</p>
      <input
        value={search}
        onChange={(e) => {
          setPage(1);
          setSearch(e.target.value);
        }}
        placeholder="Search email..."
        className="w-full max-w-xs bg-[#111113] border border-[#1f1f23] px-3 py-2 text-sm font-mono text-[#e8e8e8] outline-none focus:border-accent"
      />
      {isLoading ? (
        <p className="text-[11px] text-[#6b6b6b] font-mono">Loading users…</p>
      ) : (
        <>
          <div className="overflow-x-auto border border-[#1f1f23]">
            <table className="w-full text-[11px] font-mono text-left">
              <thead className="bg-[#111113] text-[#6b6b6b] uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-2">Email</th>
                  <th className="py-3 px-2">Name</th>
                  <th className="py-3 px-2">Plan</th>
                  <th className="py-3 px-2">Status</th>
                  <th className="py-3 px-2">Wallet cap</th>
                  <th className="py-3 px-2">Joined</th>
                  <th className="py-3 px-2">Actions</th>
                </tr>
              </thead>
              <tbody className="text-[#cfcfcf]">
                {(data?.users ?? []).map((u, i) => (
                  <Fragment key={u._id}>
                    <tr
                      className={`border-t border-[#1f1f23] cursor-pointer hover:bg-accent-dim ${
                        i % 2 ? "bg-[#111113]/35" : ""
                      }`}
                      onClick={() => setExpanded((x) => (x === u._id ? null : u._id))}
                    >
                      <td className="py-2 px-2">{u.email}</td>
                      <td className="py-2 px-2">{u.name}</td>
                      <td className="py-2 px-2">{u.subscription?.planKey ?? "—"}</td>
                      <td className="py-2 px-2">{u.subscription?.status ?? "—"}</td>
                      <td className="py-2 px-2">{u.subscription?.walletLimit ?? "—"}</td>
                      <td className="py-2 px-2 text-[#6b6b6b]">
                        {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}
                      </td>
                      <td className="py-2 px-2">
                        {u.role === "USER" && (
                          <button
                            type="button"
                            className="mr-2 text-[10px] uppercase border border-accent text-accent px-2 py-0.5 hover:bg-accent hover:text-black"
                            onClick={(ev) => {
                              ev.stopPropagation();
                              void patchUser(u._id, { role: "ADMIN" });
                            }}
                          >
                            Set admin
                          </button>
                        )}
                        {u.role === "ADMIN" && me && u._id !== me._id && (
                          <button
                            type="button"
                            className="text-[10px] uppercase border border-danger text-danger px-2 py-0.5"
                            onClick={(ev) => {
                              ev.stopPropagation();
                              void patchUser(u._id, { role: "USER" });
                            }}
                          >
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                    {expanded === u._id && (
                      <tr className="bg-[#0a0a0b]/90">
                        <td colSpan={7} className="p-4 border border-[#1f1f23] align-top">
                          <ExpandedRow uid={u._id} initial={u.subscription?.status ?? ""} onSave={patchUser} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between items-center text-[11px] text-[#6b6b6b] font-mono">
            <span>Total {data?.total ?? 0}</span>
            <div className="flex gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="border border-[#1f1f23] px-3 py-1 disabled:opacity-30"
              >
                Prev
              </button>
              <button
                disabled={page * limit >= (data?.total ?? 0)}
                onClick={() => setPage((p) => p + 1)}
                className="border border-[#1f1f23] px-3 py-1 disabled:opacity-30"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ExpandedRow({
  uid,
  initial,
  onSave,
}: {
  uid: string;
  initial: string;
  onSave: (id: string, body: Record<string, unknown>) => Promise<void>;
}) {
  const [status, setStatus] = useState(initial || "ACTIVE");

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="text-[10px] text-[#6b6b6b] uppercase">Subscription status</label>
      <select
        className="bg-[#111113] border border-[#1f1f23] text-xs px-2 py-1 font-mono text-[#e8e8e8]"
        value={status || "ACTIVE"}
        onChange={(e) => setStatus(e.target.value)}
      >
        <option value="ACTIVE">ACTIVE</option>
        <option value="PENDING">PENDING</option>
        <option value="EXPIRED">EXPIRED</option>
        <option value="CANCELLED">CANCELLED</option>
      </select>
      <button
        type="button"
        className="text-[10px] uppercase px-4 py-1 border border-accent text-accent hover:bg-accent hover:text-black"
        onClick={() => void onSave(uid, { subscriptionStatus: status })}
      >
        Save
      </button>
    </div>
  );
}
