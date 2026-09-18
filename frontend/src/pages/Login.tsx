import { useEffect } from "react";
import { useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { parseLandingPlan } from "@/lib/planQuery";
import { api } from "@/lib/api";
import { ThemeToggleButton } from "@/components/ThemeToggleButton";
import toast from "react-hot-toast";

export default function Login() {
  const { user, loading, refetch } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const planParam = params.get("plan");
  const nextUrl = params.get("next");

  useBodyScrollLock(true);

  const parsed = parseLandingPlan(planParam);

  useEffect(() => {
    if (planParam) {
      sessionStorage.setItem("pendingPlan", planParam);
    }
  }, [planParam]);

  useEffect(() => {
    if (!loading && user) {
      if (nextUrl) {
        navigate(decodeURIComponent(nextUrl), { replace: true });
      } else {
        navigate("/dashboard", { replace: true });
      }
    }
  }, [loading, user, navigate, nextUrl]);

  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-terminal font-sans text-text-primary">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  async function submitAuth(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (mode === "register") {
        await api.post("/api/auth/register", { name: name.trim(), email: email.trim(), password });
        toast.success("Account created");
      } else {
        await api.post("/api/auth/login", { email: email.trim(), password });
        toast.success("Signed in");
      }
      await refetch();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        (mode === "register" ? "Registration failed" : "Login failed");
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-terminal p-6 font-sans text-text-primary">
      <div className="absolute right-4 top-4 z-10">
        <ThemeToggleButton />
      </div>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 shadow-card">
        {parsed && (
          <div className="mb-6 rounded-xl border border-border bg-panel/50 p-3 text-sm text-text-primary">
            You selected:{" "}
            <span className="font-semibold text-accent">{parsed.planName}</span> — ${parsed.priceUSD}
          </div>
        )}

        <p className="text-lg font-semibold tracking-tight text-text-primary">AVG Token Services</p>
        <h2 className="mt-6 text-2xl font-bold uppercase tracking-wide text-text-primary">Sign in</h2>
        <p className="mt-2 text-sm text-text-secondary">
          {mode === "register" ? "Create account with email and password." : "Continue with your email account."}
        </p>

        <form onSubmit={submitAuth} className="mt-6 space-y-3">
          {mode === "register" && (
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
              className="app-input"
            />
          )}
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            placeholder="Email"
            className="app-input"
          />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            placeholder="Password"
            className="app-input"
          />
          <button
            type="submit"
            disabled={submitting}
            className="btn-gradient-primary w-full disabled:opacity-50"
          >
            {submitting ? "Please wait…" : mode === "register" ? "Create account" : "Sign in"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => setMode((m) => (m === "login" ? "register" : "login"))}
          className="mt-3 w-full rounded-lg border border-border py-2 text-center text-xs font-medium uppercase text-text-muted transition hover:border-accent hover:text-text-primary"
        >
          {mode === "register" ? "Have account? Sign in" : "Need account? Register"}
        </button>

        <p className="mt-6 text-center text-[11px] text-text-muted">
          Payments accepted in ETH, USDC, BTC, DAI, USDT, and more.
        </p>
        <p className="mt-2 text-center text-[11px] text-text-muted">
          We use secure session login and never share your credentials.
        </p>
      </div>
    </div>
  );
}
