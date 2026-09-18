import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { shortAddr, copyToClipboard } from "@/lib/utils";
import { useTheme } from "@/theme/ThemeProvider";

interface AddressCellProps {
  address: string;
  full?: boolean;
}

export default function AddressCell({ address, full = false }: AddressCellProps) {
  const [copied, setCopied] = useState(false);
  const { theme } = useTheme();
  const ink = theme === "dark" ? "text-[#fafafa]" : "text-[#282828]";

  async function handleCopy() {
    await copyToClipboard(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <span className="group inline-flex items-center gap-1.5">
      <span
        className={`font-mono text-sm cursor-pointer hover:text-accent transition-colors ${ink}`}
        title={address}
        onClick={handleCopy}
      >
        {full ? address : shortAddr(address)}
      </span>
      <button
        onClick={handleCopy}
        className="opacity-0 group-hover:opacity-100 transition-opacity text-text-muted hover:text-accent"
      >
        {copied ? <Check size={11} className="text-success" /> : <Copy size={11} />}
      </button>
    </span>
  );
}
