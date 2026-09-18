import { useState } from "react";
import { ExternalLink, Copy, Check } from "lucide-react";
import { shortHash, copyToClipboard, bscScanTx } from "@/lib/utils";

interface TxHashLinkProps {
  hash?: string | null;
  mainnet?: boolean;
}

export default function TxHashLink({ hash, mainnet = true }: TxHashLinkProps) {
  const [copied, setCopied] = useState(false);

  if (!hash) return <span className="font-mono text-text-muted text-xs">—</span>;

  async function handleCopy(e: React.MouseEvent) {
    e.preventDefault();
    await copyToClipboard(hash!);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <span className="group inline-flex items-center gap-1.5">
      <a
        href={bscScanTx(hash, mainnet)}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-sm text-accent hover:underline"
        title={hash}
      >
        {shortHash(hash)}
      </a>
      <ExternalLink size={10} className="text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
      <button onClick={handleCopy} className="opacity-0 group-hover:opacity-100 transition-opacity text-text-muted hover:text-accent">
        {copied ? <Check size={10} className="text-success" /> : <Copy size={10} />}
      </button>
    </span>
  );
}
