import { type ReactNode } from "react";
import { X } from "lucide-react";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { useManagedTheme } from "./theme";

interface ModalProps {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose?: () => void;
  /** Hide the close control (e.g. the mnemonic modal before acknowledgement). */
  closable?: boolean;
  footer?: ReactNode;
  children: ReactNode;
  size?: "sm" | "md" | "lg";
  /** Stack above other modals (re-auth over a dialog). */
  z?: number;
}

/** Dash-card modal shell matching the confirm modal in SetupPage. */
export default function Modal({ open, title, subtitle, onClose, closable = true, footer, children, size = "md", z = 50 }: ModalProps) {
  const { ink, bgInset, hoverInset } = useManagedTheme();
  useBodyScrollLock(open);
  if (!open) return null;
  const width = size === "sm" ? "max-w-sm" : size === "lg" ? "max-w-3xl" : "max-w-lg";
  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm dark:bg-black/70"
      style={{ zIndex: z }}
      onMouseDown={(e) => {
        if (closable && onClose && e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`dash-card flex max-h-[92vh] w-full ${width} flex-col overflow-hidden shadow-2xl`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h3 className={`font-display text-base font-semibold ${ink}`}>{title}</h3>
            {subtitle ? <p className="mt-0.5 text-[11px] leading-snug text-text-secondary">{subtitle}</p> : null}
          </div>
          {closable && onClose ? (
            <button
              type="button"
              onClick={onClose}
              className={`shrink-0 rounded-lg p-1.5 text-text-secondary transition-colors ${hoverInset} hover:text-text-primary`}
              aria-label="Close"
            >
              <X size={16} />
            </button>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-xs">{children}</div>
        {footer ? <div className={`flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3 ${bgInset}`}>{footer}</div> : null}
      </div>
    </div>
  );
}
