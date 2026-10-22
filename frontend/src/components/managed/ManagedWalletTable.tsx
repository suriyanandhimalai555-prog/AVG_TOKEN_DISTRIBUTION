import { UserPlus, RefreshCw, Send } from "lucide-react";
import type { ManagedWalletWithBalances, Network } from "@/lib/managedTypes";
import AddressCell from "@/components/ui/AddressCell";
import BalanceChips from "./BalanceChips";
import ViewLinkButton from "./ViewLinkButton";
import { formatUnits, isZeroWei, timeAgo } from "./format";
import type { AssetOption } from "./AssetSelect";
import TokenIcon from "./TokenIcon";
import { ghostBtn, tdCls, thCls, useManagedTheme } from "./theme";

interface ManagedWalletTableProps {
  wallets: ManagedWalletWithBalances[];
  network: Network;
  loading?: boolean;
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onToggleAll: (ids: string[], select: boolean) => void;
  onAssign: (wallet: ManagedWalletWithBalances) => void;
  onTransfer: (wallet: ManagedWalletWithBalances) => void;
  onRotate: (wallet: ManagedWalletWithBalances) => void;
  readOnly?: boolean;
  /** When set, the Balances column shows only this token for every wallet. */
  asset?: AssetOption | null;
}

const COLUMNS = ["", "#", "Address", "Label", "Holder", "Balances", "Last deposit", "Actions"];

/** F2 table: index, address, label, holder, balance chips, last deposit, actions. */
export default function ManagedWalletTable({
  wallets,
  loading = false,
  selected,
  onToggle,
  onToggleAll,
  onAssign,
  onTransfer,
  onRotate,
  readOnly = false,
  asset = null,
}: ManagedWalletTableProps) {
  const { ink, soft, rowZebra, rowHover } = useManagedTheme();
  const ids = wallets.map((w) => w.id);
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
  const someSelected = ids.some((id) => selected.has(id));

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="border-b border-border">
            {COLUMNS.map((h, i) => (
              <th key={`${h}-${i}`} className={`${thCls} ${soft} ${h === "Balances" && asset ? "text-right" : ""}`}>
                {i === 0 ? (
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    className="accent-accent"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = !allSelected && someSelected;
                    }}
                    onChange={(e) => onToggleAll(ids, e.target.checked)}
                  />
                ) : h === "Balances" && asset ? (
                  `${asset.symbol} balance`
                ) : (
                  h
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && wallets.length === 0 ? (
            <tr>
              <td colSpan={COLUMNS.length} className={`py-10 text-center text-[11px] uppercase tracking-widest ${soft}`}>
                Loading wallets…
              </td>
            </tr>
          ) : wallets.length === 0 ? (
            <tr>
              <td colSpan={COLUMNS.length} className={`py-10 text-center text-[11px] ${soft}`}>
                No wallets yet. Generate some to hand out addresses.
              </td>
            </tr>
          ) : (
            wallets.map((w, i) => {
              const disabled = w.status === "DISABLED";
              return (
                <tr key={w.id} className={`border-b border-border/50 ${i % 2 ? rowZebra : ""} ${rowHover} ${disabled ? "opacity-60" : ""}`}>
                  <td className={tdCls}>
                    <input type="checkbox" className="accent-accent" checked={selected.has(w.id)} onChange={() => onToggle(w.id)} aria-label={`Select wallet ${w.derivationIndex}`} />
                  </td>
                  <td className={`${tdCls} tabular-nums ${soft}`}>{w.derivationIndex}</td>
                  <td className={tdCls}>
                    <AddressCell address={w.address} />
                    {disabled ? <span className="ml-1.5 rounded-full border border-border px-1.5 text-[9px] uppercase text-text-muted">disabled</span> : null}
                  </td>
                  <td className={`${tdCls} ${ink}`}>{w.label ?? <span className="text-text-muted">—</span>}</td>
                  <td className={`${tdCls} max-w-[180px]`}>
                    {w.holderName || w.holderEmail ? (
                      <div className="flex flex-col leading-tight">
                        <span className={`truncate ${ink}`}>{w.holderName ?? "—"}</span>
                        {w.holderEmail ? <span className="truncate text-[10px] text-text-muted">{w.holderEmail}</span> : null}
                      </div>
                    ) : (
                      <span className="text-text-muted">Unassigned</span>
                    )}
                  </td>
                  <td className={`${tdCls} ${asset ? "text-right" : ""}`}>
                    {asset ? <SingleBalance wallet={w} asset={asset} /> : <BalanceChips balances={w.balances} />}
                  </td>
                  <td className={`${tdCls} whitespace-nowrap ${soft}`} title={w.lastDepositAt ?? undefined}>
                    {timeAgo(w.lastDepositAt)}
                  </td>
                  <td className={`${tdCls} whitespace-nowrap`}>
                    <div className="flex items-center gap-1">
                      <button type="button" className={ghostBtn} onClick={() => onAssign(w)} disabled={readOnly} title="Assign holder">
                        <UserPlus size={12} /> Assign
                      </button>
                      <ViewLinkButton walletId={w.id} label="Copy link" />
                      <button type="button" className={ghostBtn} onClick={() => onRotate(w)} disabled={readOnly} title="Rotate the view link (old link stops working)">
                        <RefreshCw size={12} /> Rotate
                      </button>
                      <button type="button" className={ghostBtn} onClick={() => onTransfer(w)} disabled={readOnly || disabled} title="Transfer out of this wallet">
                        <Send size={12} /> Transfer
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Balance of one selected token for a wallet; a missing row means zero. */
function SingleBalance({ wallet, asset }: { wallet: ManagedWalletWithBalances; asset: AssetOption }) {
  const { ink } = useManagedTheme();
  const entry = wallet.balances.find((b) => b.asset.toLowerCase() === asset.asset);
  const wei = entry?.balanceWei ?? "0";
  const zero = isZeroWei(wei);
  const decimals = entry?.decimals ?? asset.decimals;
  return (
    <span className={`inline-flex items-center justify-end gap-1.5 tabular-nums ${zero ? "text-text-muted" : `font-semibold ${ink}`}`} title={`${formatUnits(wei, decimals, decimals)} ${asset.symbol}`}>
      <TokenIcon asset={asset.asset} symbol={asset.symbol} size={16} className={zero ? "opacity-60" : ""} />
      {formatUnits(wei, decimals, 6)} <span className="text-[10px] font-semibold uppercase text-accent">{asset.symbol}</span>
    </span>
  );
}
