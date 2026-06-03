import type { Currency } from "./types";

export function money(value: number, currency?: Currency | null) {
  const label = currency?.symbol || currency?.code || "";

  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(Number(value || 0))} ${label}`;
}

export function getApiBaseUrl() {
  return window.electronAPI?.getLanApiBaseUrl(4000) || "http://localhost:4000";
}
