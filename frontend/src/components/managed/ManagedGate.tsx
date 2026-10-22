/**
 * Route guard for every Managed Wallets admin page.
 *
 * The admin role is checked by the parent ProtectedRoute (requireAdmin). This
 * guard covers the server side: it renders the page only when the backend has
 * the feature mounted, the key vault loaded and the migration applied, and
 * otherwise explains exactly what is missing instead of showing a broken page.
 */
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Circle, Loader2, PowerOff, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { MANAGED_HEALTH_QUERY_KEY } from "@/lib/managedApi";
import { useManagedEnabled } from "./client";
import { useManagedTheme } from "./theme";

function Shell({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  const t = useManagedTheme();
  return (
    <section className="dash-card mx-auto mt-6 max-w-2xl p-6 sm:p-8">
      <div className="flex items-center gap-3">
        {icon}
        <h1 className={`text-lg font-semibold ${t.ink}`}>{title}</h1>
      </div>
      <div className={`mt-4 space-y-3 text-sm leading-relaxed ${t.soft}`}>{children}</div>
    </section>
  );
}

function Step({ done, label, hint }: { done: boolean; label: string; hint: ReactNode }) {
  const t = useManagedTheme();
  return (
    <li className="flex gap-3">
      {done ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
      ) : (
        <Circle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
      )}
      <div>
        <p className={`font-medium ${done ? t.soft : t.ink}`}>{label}</p>
        {!done && <div className="mt-1 text-xs">{hint}</div>}
      </div>
    </li>
  );
}

export default function ManagedGate({ children }: { children: ReactNode }) {
  const managed = useManagedEnabled();
  const qc = useQueryClient();
  const recheck = () => void qc.invalidateQueries({ queryKey: MANAGED_HEALTH_QUERY_KEY });

  if (managed.loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-xs uppercase tracking-widest text-text-muted">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Checking Managed Wallets
      </div>
    );
  }

  if (managed.ready) return <>{children}</>;

  const recheckButton = (
    <button type="button" onClick={recheck} className="btn-outline-blue mt-2 inline-flex items-center gap-2 px-4 py-2 text-xs">
      <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Check again
    </button>
  );

  if (managed.switchedOff) {
    return (
      <Shell icon={<PowerOff className="h-5 w-5 text-text-muted" aria-hidden />} title="Managed Wallets is switched off on this server">
        <p>
          The backend you are connected to does not serve Managed Wallets. Either the server has
          <code className="mx-1 font-mono">MANAGED_WALLETS_ENABLED=false</code>
          or it runs a version from before this feature.
        </p>
        <p>
          On localhost, check that the frontend points at your local backend: start it with
          <code className="mx-1 font-mono">VITE_API_URL= npm run dev</code>
          so it does not use the production URL from <code className="font-mono">frontend/.env</code>.
        </p>
        <div className="flex flex-wrap gap-3">
          {recheckButton}
          <Link to="/admin" className="btn-outline-blue mt-2 inline-flex items-center px-4 py-2 text-xs">
            Back to admin
          </Link>
        </div>
      </Shell>
    );
  }

  if (managed.error || !managed.health) {
    return (
      <Shell icon={<AlertTriangle className="h-5 w-5 text-danger" aria-hidden />} title="Could not reach Managed Wallets">
        <p>The status check failed. The backend may be down or unreachable from this page.</p>
        {recheckButton}
      </Shell>
    );
  }

  const { keyVault, migrated } = managed.health;
  return (
    <Shell icon={<AlertTriangle className="h-5 w-5 text-warning" aria-hidden />} title="Managed Wallets needs one-time server setup">
      <p>You have admin access. The server must finish these steps before pools can be used.</p>
      <ol className="space-y-3">
        <Step
          done={keyVault === "ok"}
          label="Encryption key loaded"
          hint={
            <>
              Generate one with <code className="font-mono">npm run managed:gen-key</code> in <code className="font-mono">backend/</code>,
              store it offline, set it as <code className="font-mono">WALLET_ENCRYPTION_KEY</code> on the server, then restart the backend.
            </>
          }
        />
        <Step
          done={migrated}
          label="Database migration applied"
          hint={
            <>
              Run <code className="font-mono">node dist/migrate.js</code> in the backend (locally:{" "}
              <code className="font-mono">npm run migrate:dev</code>).
            </>
          }
        />
      </ol>
      {recheckButton}
    </Shell>
  );
}
