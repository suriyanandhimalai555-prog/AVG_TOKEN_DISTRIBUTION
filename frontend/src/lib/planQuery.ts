import { findPlan } from "@shared/plans";

export function parseLandingPlan(planParam: string | null): {
  productLine: "TOKEN_HOLDER" | "DEX_AUTOMATION";
  planKey: string;
  planName: string;
  priceUSD: number;
} | null {
  if (!planParam?.trim()) return null;
  if (planParam.startsWith("TOKEN_HOLDER_")) {
    const planKey = planParam.replace("TOKEN_HOLDER_", "");
    const plan = findPlan("TOKEN_HOLDER", planKey);
    if (!plan || !("priceUSD" in plan)) return null;
    const p = plan as typeof plan & { name: string; priceUSD: number };
    return { productLine: "TOKEN_HOLDER", planKey, planName: p.name, priceUSD: p.priceUSD };
  }
  if (planParam.startsWith("DEX_")) {
    const planKey = planParam.replace("DEX_", "");
    const plan = findPlan("DEX_AUTOMATION", planKey);
    if (!plan || !("priceUSD" in plan)) return null;
    const p = plan as typeof plan & { name: string; priceUSD: number };
    return { productLine: "DEX_AUTOMATION", planKey, planName: p.name, priceUSD: p.priceUSD };
  }
  return null;
}
