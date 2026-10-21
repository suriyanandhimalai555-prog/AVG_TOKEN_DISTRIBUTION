/**
 * Managed Wallets — public holder page (F11), route /w/:viewToken.
 *
 * Standalone layout (no Shell, no login). Read-only by design: shows the
 * address, QR, network, native and token balances, and recent deposits.
 * There are no send, transfer, or key-related controls on this page.
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { Check, Copy, ExternalLink, RefreshCw } from "lucide-react";
import { ThemeToggleButton } from "@/components/ThemeToggleButton";
import NetworkBadge from "@/components/managed/NetworkBadge";
import QrCode from "@/components/managed/QrCode";
import { useManagedTheme } from "@/components/managed/theme";
import { fmtDateTime, formatUnits, isMainnet, timeAgo } from "@/components/managed/format";
import { managedApi } from "@/lib/managedApi";
import type { PublicWalletView } from "@/lib/managedApi";
import { bscScanTx, copyToClipboard, shortAddr, shortHash } from "@/lib/utils";

const POLL_MS = 60_000;

type ViewState = "loading" | "ready" | "not-found" | "rate-limited" | "error";

function statusOf(err: unknown): number | undefined {
  return axios.isAxiosError(err) ? err.response?.status : undefined;
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen bg-terminal text-text-primary font-sans">
      <div className="absolute right-4 top-4 z-10">
        <ThemeToggleButton />
      </div>
      <main className="mx-auto flex w-full max-w-2xl flex-col items-stretch px-4 pb-10 pt-16 sm:px-6">{children}</main>
      <footer className="pb-8 text-center text-[11px] uppercase tracking-widest text-text-muted">
        Powered by HolderForge
      </footer>
    </div>
  );
}

function Centered({ title, body }: { title: string; body: string }) {
  return (
    <div className="dash-card mx-auto w-full max-w-md px-6 py-10 text-center">
      <h1 className="text-lg font-semibold text-text-primary">{title}</h1>
      <p className="mt-3 text-sm text-text-muted">{body}</p>
    </div>
  );
}

function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const { ink } = useManagedTheme();

  async function handleCopy() {
    await copyToClipboard(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex items-start gap-2">
      <code className={`min-w-0 flex-1 break-all font-mono text-xs leading-relaxed sm:text-sm ${ink}`} title={address}>
        {address}
      </code>
      <button
        type="button"
        onClick={handleCopy}
        aria-label="Copy address"
        title="Copy address"
        className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-border text-text-muted transition-colors hover:border-accent hover:text-accent"
      >
        {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
      </button>
    </div>
  );
}

function WalletView({
  data,
  refetching,
  onRefresh,
}: {
  data: PublicWalletView;
  refetching: boolean;
  onRefresh: () => void;
}) {
  const t = useManagedTheme();
  const mainnet = isMainnet(data.network);
  // Re-render every 30 s so "Updated X ago" stays honest between polls.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="space-y-4">
      <section className="dash-card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="dash-section-title">Wallet</p>
            <h1 className={`mt-1 truncate text-xl font-semibold ${t.ink}`}>{data.label?.trim() || "Managed wallet"}</h1>
          </div>
          <NetworkBadge network={data.network} />
        </div>

        <div className="mt-5 flex flex-col items-center gap-5 sm:flex-row sm:items-start">
          <div className="flex-shrink-0 rounded-xl bg-white p-2 shadow-sm">
            <QrCode value={data.address} size={152} alt={`QR code for address ${data.address}`} />
          </div>
          <div className="min-w-0 flex-1 self-stretch">
            <p className="dash-section-title">Deposit address</p>
            <div className={`mt-2 rounded-lg p-3 ${t.bgInset}`}>
              <CopyAddress address={data.address} />
            </div>
            <p className="mt-3 text-[11px] text-text-muted">
              Send only {data.native.symbol} or BEP-20 tokens on {mainnet ? "BNB Smart Chain" : "BNB Smart Chain Testnet"} to
              this address.
            </p>
          </div>
        </div>
      </section>

      <section className="dash-card p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <p className="dash-section-title">Balances</p>
          <div className="flex items-center gap-3 text-[11px] text-text-muted">
            <span>{data.updatedAt ? `Updated ${timeAgo(data.updatedAt)}` : "Awaiting first sync"}</span>
            <button
              type="button"
              onClick={onRefresh}
              disabled={refetching}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 font-medium text-text-secondary transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw size={12} className={refetching ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
        </div>

        <div className={`mt-3 flex items-baseline justify-between rounded-lg px-4 py-3 ${t.bgInset}`}>
          <span className={`text-sm font-medium ${t.ink}`}>{data.native.symbol}</span>
          <span className={`font-mono text-lg font-semibold ${t.ink}`}>{formatUnits(data.native.balanceWei, 18, 8)}</span>
        </div>

        {data.tokens.length > 0 ? (
          <ul className="mt-2 divide-y divide-border">
            {data.tokens.map((tok) => (
              <li key={tok.tokenAddress} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className={`text-sm font-medium ${t.ink}`}>{tok.symbol}</p>
                  <p className="truncate text-[11px] text-text-muted">{tok.name}</p>
                </div>
                <span className={`font-mono text-sm ${t.ink}`}>{formatUnits(tok.balanceWei, tok.decimals, 6)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-xs text-text-muted">No token balances yet.</p>
        )}
      </section>

      <section className="dash-card p-5 sm:p-6">
        <p className="dash-section-title">Recent deposits</p>
        {data.deposits.length === 0 ? (
          <p className="mt-3 text-xs text-text-muted">No deposits yet. Incoming transfers appear here once confirmed.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-text-muted">
                <tr>
                  <th className="whitespace-nowrap py-2 pr-3 text-left text-[10px] font-normal uppercase tracking-widest">Time</th>
                  <th className="whitespace-nowrap py-2 pr-3 text-left text-[10px] font-normal uppercase tracking-widest">Asset</th>
                  <th className="whitespace-nowrap py-2 pr-3 text-right text-[10px] font-normal uppercase tracking-widest">Amount</th>
                  <th className="whitespace-nowrap py-2 pr-3 text-left text-[10px] font-normal uppercase tracking-widest">From</th>
                  <th className="whitespace-nowrap py-2 text-left text-[10px] font-normal uppercase tracking-widest">Tx</th>
                </tr>
              </thead>
              <tbody>
                {data.deposits.map((d, i) => {
                  const href = d.explorerUrl || bscScanTx(d.txHash, mainnet);
                  return (
                    <tr key={`${d.txHash}-${i}`} className={i % 2 === 1 ? t.rowZebra : ""}>
                      <td className={`whitespace-nowrap py-2 pr-3 ${t.soft}`}>{fmtDateTime(d.blockTime)}</td>
                      <td className={`whitespace-nowrap py-2 pr-3 font-medium ${t.ink}`}>{d.symbol}</td>
                      <td className={`whitespace-nowrap py-2 pr-3 text-right font-mono ${t.ink}`}>
                        {formatUnits(d.amountWei, d.decimals, 6)}
                      </td>
                      <td className={`whitespace-nowrap py-2 pr-3 font-mono ${t.soft}`} title={d.from}>
                        {shortAddr(d.from)}
                      </td>
                      <td className="whitespace-nowrap py-2">
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-accent hover:underline"
                          title={d.txHash}
                        >
                          {shortHash(d.txHash)}
                          <ExternalLink size={10} />
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default function WalletViewPage() {
  const { viewToken = "" } = useParams<{ viewToken: string }>();

  const q = useQuery({
    queryKey: ["managed", "view", viewToken],
    queryFn: () => managedApi.getPublicWallet(viewToken),
    enabled: viewToken.length > 0,
    retry: false,
    staleTime: 15_000,
    // Polls only while the tab is visible/focused (refetchIntervalInBackground defaults to false).
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  });

  let state: ViewState;
  if (!viewToken) state = "not-found";
  else if (q.data) state = "ready";
  else if (q.isPending) state = "loading";
  else {
    const s = statusOf(q.error);
    state = s === 404 ? "not-found" : s === 429 ? "rate-limited" : "error";
  }

  useEffect(() => {
    document.title = q.data?.label ? `${q.data.label} · HolderForge` : "Managed wallet · HolderForge";
  }, [q.data?.label]);

  return (
    <Frame>
      {state === "loading" && (
        <div className="flex flex-col items-center justify-center gap-4 py-24">
          <div className="h-10 w-10 animate-spin rounded-full border border-accent border-t-transparent" />
          <p className="text-xs uppercase tracking-widest text-text-muted">Loading wallet</p>
        </div>
      )}
      {state === "not-found" && (
        <Centered title="This wallet link is not valid" body="Check the link you were given, or ask the person who shared it for a new one." />
      )}
      {state === "rate-limited" && (
        <Centered title="Too many requests" body="This page is being refreshed too often. Wait a minute and try again." />
      )}
      {state === "error" && (
        <div className="dash-card mx-auto w-full max-w-md px-6 py-10 text-center">
          <h1 className="text-lg font-semibold text-text-primary">Could not load this wallet</h1>
          <p className="mt-3 text-sm text-text-muted">The server did not respond. Try again in a moment.</p>
          <button
            type="button"
            onClick={() => void q.refetch()}
            className="mt-6 inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-xs font-medium text-text-secondary transition-colors hover:border-accent hover:text-accent"
          >
            <RefreshCw size={12} />
            Retry
          </button>
        </div>
      )}
      {state === "ready" && q.data && (
        <WalletView data={q.data} refetching={q.isFetching} onRefresh={() => void q.refetch()} />
      )}
    </Frame>
  );
}
