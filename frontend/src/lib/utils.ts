// ─── Formatting ───────────────────────────────────────────────────────────────

export function fmt(n: number | string | undefined | null): string {
  if (n === undefined || n === null) return "—";
  return Number(n).toLocaleString();
}

export function fmtBnb(n: number | undefined | null): string {
  if (n === undefined || n === null) return "—";
  return n.toFixed(6) + " BNB";
}

export function fmtDuration(startedAt?: string, completedAt?: string): string {
  if (!startedAt) return "—";
  const end = completedAt ? new Date(completedAt) : new Date();
  const ms = end.getTime() - new Date(startedAt).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem.toString().padStart(2, "0")}s`;
}

export function fmtTime(ts?: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function fmtGas(gasUsed?: string | null): string {
  if (!gasUsed) return "—";
  return Number(gasUsed).toLocaleString();
}

// ─── Address helpers ──────────────────────────────────────────────────────────

export function shortAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function shortHash(hash: string): string {
  if (!hash || hash.length < 14) return hash;
  return `${hash.slice(0, 10)}...${hash.slice(-6)}`;
}

export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const el = document.createElement("textarea");
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    document.body.removeChild(el);
  }
}

// ─── Validation ───────────────────────────────────────────────────────────────

export function isValidAddress(v: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(v);
}

export function isValidPrivateKey(v: string): boolean {
  return /^(0x)?[a-fA-F0-9]{64}$/.test(v);
}

export function isValidRpcUrl(v: string): boolean {
  return v.startsWith("https://") || v.startsWith("http://");
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

export function getStoredSessionId(): string | null {
  return localStorage.getItem("sessionId");
}

export function setStoredSessionId(id: string): void {
  localStorage.setItem("sessionId", id);
}

export function getStoredPrivateKey(): string | null {
  return sessionStorage.getItem("pk");
}

export function setStoredPrivateKey(pk: string): void {
  sessionStorage.setItem("pk", pk);
}

export function clearStoredPrivateKey(): void {
  sessionStorage.removeItem("pk");
}

// ─── BSCScan links ────────────────────────────────────────────────────────────

export function bscScanTx(hash: string, mainnet = true): string {
  const base = mainnet ? "https://bscscan.com" : "https://testnet.bscscan.com";
  return `${base}/tx/${hash}`;
}

export function bscScanAddr(addr: string, mainnet = true): string {
  const base = mainnet ? "https://bscscan.com" : "https://testnet.bscscan.com";
  return `${base}/address/${addr}`;
}

// ─── Progress ─────────────────────────────────────────────────────────────────

export function pct(value: number, total: number): number {
  if (total === 0) return 0;
  return Math.min(100, Math.round((value / total) * 100));
}
