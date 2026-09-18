import { Check, FileSpreadsheet } from "lucide-react";

const DELIVERABLES = [
  "Wallet address list",
  "Token amount per wallet",
  "Transaction hash / TX proof",
  "Transfer status",
  "Transfer date and time",
  "CSV and Excel export format",
];

const NETWORKS = ["BEP20", "ERC20", "Polygon", "Other EVM-compatible chains"];

const SAMPLE_ROWS = [
  {
    no: "1",
    wallet: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
    amount: "1,250.00",
    tx: "0x9f2e4b8c1d7a6e5f3c2b0a8d4e6f1c9b7a5d3e2f1",
    status: "Completed",
    date: "DD/MM/YYYY",
  },
  {
    no: "2",
    wallet: "0x8f3Bb7DDEEf22989Fe12d84EDAbf47AF29f74FbC",
    amount: "875.50",
    tx: "0x7c6d5e4f3a2b1098f7e6d5c4b3a291877665544332211",
    status: "Completed",
    date: "DD/MM/YYYY",
  },
];

function truncateMiddle(str: string, start = 6, end = 4) {
  if (str.length <= start + end + 3) return str;
  return `${str.slice(0, start)}…${str.slice(-end)}`;
}

export function WhatYouWillReceive({ className }: { className?: string }) {
  return (
    <div className={className} aria-labelledby="what-you-receive-heading">
      <div className="mx-auto max-w-[1100px] px-4 text-center">
        <h2 id="what-you-receive-heading" className="text-3xl font-bold tracking-tight text-text-primary md:text-4xl">
          What You Will Receive
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-text-secondary">
          Every AVG package includes a complete wallet and token distribution report
        </p>
      </div>

      <div className="mx-auto mt-12 max-w-[1100px] px-4">
        <div className="corp-card rounded-2xl border border-white/[0.08] bg-surface p-6 shadow-card md:p-8 lg:p-10">
          {/* Excel preview */}
          <div className="flex items-center gap-2 text-left">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-dim text-accent-light">
              <FileSpreadsheet className="h-5 w-5" aria-hidden />
            </div>
            <h3 className="text-lg font-semibold text-text-primary md:text-xl">Excel Report Includes</h3>
          </div>

          <div className="mt-6 overflow-hidden rounded-xl border border-white/[0.06] bg-terminal/90">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-white/[0.08] bg-panel/50">
                    <th scope="col" className="whitespace-nowrap px-4 py-3 font-medium text-text-secondary">
                      S.No
                    </th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3 font-medium text-text-secondary">
                      Wallet Address
                    </th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3 font-medium text-text-secondary">
                      Token Amount
                    </th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3 font-medium text-text-secondary">
                      Transaction Hash
                    </th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3 font-medium text-text-secondary">
                      Status
                    </th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3 font-medium text-text-secondary">
                      Transfer Date
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {SAMPLE_ROWS.map((row) => (
                    <tr key={row.no} className="border-b border-white/[0.06] last:border-0">
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-text-primary">{row.no}</td>
                      <td className="max-w-[140px] px-4 py-3 font-mono text-xs text-text-secondary">
                        {truncateMiddle(row.wallet, 6, 4)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-text-primary">{row.amount}</td>
                      <td className="max-w-[160px] px-4 py-3 font-mono text-xs text-text-secondary">
                        {truncateMiddle(row.tx, 8, 6)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className="font-medium text-[#10B981]">{row.status}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-text-muted">{row.date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Two columns */}
          <div className="mt-10 grid gap-10 border-t border-white/[0.08] pt-10 md:grid-cols-2 md:gap-12">
            <div className="text-left">
              <h4 className="text-base font-semibold text-text-primary md:text-lg">Report Deliverables:</h4>
              <ul className="mt-5 space-y-3">
                {DELIVERABLES.map((item) => (
                  <li key={item} className="flex gap-3 text-sm text-text-secondary md:text-base">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#10B981]/15">
                      <Check className="h-3.5 w-3.5 text-[#10B981]" strokeWidth={3} aria-hidden />
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="text-left">
              <h4 className="text-base font-semibold text-text-primary md:text-lg">AVG Supported Networks:</h4>
              <div className="mt-5 flex flex-wrap gap-2">
                {NETWORKS.map((net) => (
                  <span
                    key={net}
                    className="inline-flex items-center rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-text-secondary md:text-sm"
                  >
                    {net}
                  </span>
                ))}
              </div>
              <p className="mt-6 text-sm text-text-muted">Cross-chain reporting support available</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
