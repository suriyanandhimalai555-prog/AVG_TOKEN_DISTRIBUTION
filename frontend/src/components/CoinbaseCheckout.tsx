import { useState } from "react";
import axios from "axios";
import { api } from "@/lib/api";

const COINS = ["ETH", "USDC", "BTC", "DAI", "USDT", "DOGE", "LTC"] as const;

export interface CoinbaseCheckoutProps {
  productLine: string;
  planKey: string;
  planName: string;
  priceUSD: number;
  compact?: boolean;
  onInitiated: (hostedUrl: string, chargeId: string) => void;
  onError: (message: string) => void;
}

export default function CoinbaseCheckout({
  productLine,
  planKey,
  planName,
  priceUSD,
  compact = false,
  onInitiated,
  onError,
}: CoinbaseCheckoutProps) {
  const [loading, setLoading] = useState(false);

  async function initiatePayment(): Promise<void> {
    setLoading(true);
    try {
      const BASE = api.defaults.baseURL ?? "";
      const res = await axios.post(
        `${BASE}/api/payments/create-charge`,
        { productLine, planKey },
        { withCredentials: true }
      );

      const { hostedUrl, chargeId, internalOrderId } = res.data as {
        hostedUrl: string;
        chargeId: string;
        internalOrderId: string;
      };

      sessionStorage.setItem("pendingChargeId", chargeId);
      sessionStorage.setItem("pendingOrderId", internalOrderId);
      sessionStorage.setItem(
        "pendingPlanMeta",
        JSON.stringify({ productLine, planKey, planName, priceUSD })
      );

      onInitiated(hostedUrl, chargeId);
      window.location.href = hostedUrl;
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } }).response?.data?.error ??
        "Failed to create charge";
      onError(msg);
      setLoading(false);
    }
  }

  return (
    <div className={compact ? "" : "mt-4"}>
      {!compact && (
        <div className="flex gap-2 flex-wrap mb-4">
          {COINS.map((coin) => (
            <span
              key={coin}
              className="px-2 py-0.5 border border-[#1f1f23] text-[11px] font-mono text-[#6b6b6b] rounded-none"
            >
              {coin}
            </span>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => void initiatePayment()}
        disabled={loading}
        className="w-full border border-[#00d4aa] text-[#00d4aa] font-mono uppercase tracking-widest py-3 rounded-none hover:bg-[#00d4aa] hover:text-[#0a0a0b] transition-all duration-200 disabled:opacity-50"
      >
        {loading ? "CREATING CHARGE..." : `PAY $${priceUSD} WITH CRYPTO →`}
      </button>

      {!compact && (
        <p className="text-[11px] text-[#6b6b6b] font-mono mt-3 text-center">
          Powered by Coinbase Commerce · Self-custody · No credit card needed
        </p>
      )}
    </div>
  );
}
