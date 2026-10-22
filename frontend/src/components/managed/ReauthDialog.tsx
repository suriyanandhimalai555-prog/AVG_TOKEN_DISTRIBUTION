import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Lock, Loader2, Eye, EyeOff } from "lucide-react";
import { managedApi } from "./client";
import { apiErrorMessage } from "./format";
import { isReauthValid, setReauthValidUntil } from "./reauthStore";
import Modal from "./Modal";
import { inputCls, outlineBtn, primaryBtn } from "./theme";

interface ReauthDialogProps {
  open: boolean;
  /** What the password unlocks, shown under the title. */
  reason?: string;
  onSuccess: () => void;
  onCancel: () => void;
}

/**
 * Password re-authentication (POST /reauth). On success the validity window
 * is remembered in memory (reauthStore) so repeated sensitive actions within
 * 10 minutes skip this dialog. Prefer `useReauth()` below over using it directly.
 */
export default function ReauthDialog({ open, reason, onSuccess, onCancel }: ReauthDialogProps) {
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setPassword("");
      setError("");
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  async function submit(e?: React.FormEvent): Promise<void> {
    e?.preventDefault();
    if (!password) {
      setError("Enter your password");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await managedApi.reauth(password);
      setReauthValidUntil(res.validUntil);
      setPassword("");
      onSuccess();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not verify the password"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Confirm your password"
      subtitle={reason ?? "This action needs a recent password check."}
      onClose={busy ? undefined : onCancel}
      size="sm"
      z={70}
      footer={
        <>
          <button type="button" className={outlineBtn} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="managed-reauth-form" className={primaryBtn} disabled={busy}>
            {busy ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Checking…
              </>
            ) : (
              <>
                <Lock size={14} /> Confirm
              </>
            )}
          </button>
        </>
      }
    >
      <form id="managed-reauth-form" onSubmit={(e) => void submit(e)} className="space-y-2">
        <label className="block text-xs font-medium text-text-secondary">Admin password</label>
        <div className="relative">
          <input
            ref={inputRef}
            type={show ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className={`${inputCls} pr-10 ${error ? "!border-danger" : ""}`}
            placeholder="••••••••"
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-text-secondary hover:text-text-primary"
            aria-label={show ? "Hide password" : "Show password"}
          >
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        {error ? <p className="text-xs text-danger">{error}</p> : null}
        <p className="text-[11px] leading-relaxed text-text-secondary">Valid for 10 minutes. Repeated sensitive actions within that window will not ask again.</p>
      </form>
    </Modal>
  );
}

/**
 * Hook: `withReauth(fn)` runs `fn` immediately when a re-auth is still valid,
 * otherwise opens the dialog and runs `fn` after a successful password check.
 * Render `{reauthDialog}` once in the component tree.
 */
export function useReauth(reason?: string): {
  withReauth: (fn: () => void | Promise<void>) => void;
  reauthDialog: ReactNode;
} {
  const [open, setOpen] = useState(false);
  const pendingRef = useRef<(() => void | Promise<void>) | null>(null);

  const withReauth = useCallback((fn: () => void | Promise<void>) => {
    if (isReauthValid()) {
      void fn();
      return;
    }
    pendingRef.current = fn;
    setOpen(true);
  }, []);

  const reauthDialog = (
    <ReauthDialog
      open={open}
      reason={reason}
      onSuccess={() => {
        setOpen(false);
        const fn = pendingRef.current;
        pendingRef.current = null;
        if (fn) void fn();
      }}
      onCancel={() => {
        setOpen(false);
        pendingRef.current = null;
      }}
    />
  );

  return { withReauth, reauthDialog };
}
