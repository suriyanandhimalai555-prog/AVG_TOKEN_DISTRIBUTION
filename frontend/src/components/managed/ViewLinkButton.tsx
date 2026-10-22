import { useState } from "react";
import toast from "react-hot-toast";
import { Link2, Check, Loader2 } from "lucide-react";
import { copyToClipboard } from "@/lib/utils";
import { managedApi } from "./client";
import { apiErrorMessage } from "./format";
import { ghostBtn } from "./theme";

interface ViewLinkButtonProps {
  walletId: string;
  /** Pass when already known (wallet detail); otherwise fetched on click. */
  viewUrl?: string;
  label?: string;
  className?: string;
}

/**
 * Copies the holder's view link. The URL always comes from the API
 * (wallet.viewUrl); it is never composed client side.
 */
export default function ViewLinkButton({ walletId, viewUrl, label = "Copy view link", className }: ViewLinkButtonProps) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleClick(): Promise<void> {
    setBusy(true);
    try {
      const url = viewUrl ?? (await managedApi.getWallet(walletId)).wallet.viewUrl;
      await copyToClipboard(url);
      setCopied(true);
      toast.success("View link copied");
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not fetch the view link"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={() => void handleClick()} disabled={busy} className={className ?? ghostBtn} title="Copy the read-only holder link">
      {busy ? <Loader2 size={12} className="animate-spin" /> : copied ? <Check size={12} className="text-success" /> : <Link2 size={12} />}
      {label}
    </button>
  );
}
