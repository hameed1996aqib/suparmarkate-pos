import { API_BASE_URL } from "@/lib/api-config";
import type {
  DashboardCurrency,
  DashboardPeriod,
  DashboardSummary,
} from "./types";

export async function getDashboardSummary(
  period: DashboardPeriod,
  currencyId?: string,
) {
  const params = new URLSearchParams({ period });
  if (currencyId) params.set("currencyId", currencyId);

  const response = await fetch(
    `${API_BASE_URL}/api/dashboard/summary?${params.toString()}`,
  );
  const json = await response.json().catch(() => null);

  if (!response.ok || !json?.data) {
    throw new Error(json?.message || "خواندن داشبورد ناکام شد");
  }

  return json.data as DashboardSummary;
}

export async function getDashboardCurrencies() {
  const response = await fetch(`${API_BASE_URL}/api/currencies`);
  const json = await response.json().catch(() => null);

  if (!response.ok || !json?.data) {
    throw new Error(json?.message || "خواندن کرنسی‌ها ناکام شد");
  }

  return json.data as DashboardCurrency[];
}
