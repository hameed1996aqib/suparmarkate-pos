import { addDaysToIsoDate, kabulDateString } from "@/lib/kabul-date";

export function toDateInput(date: Date) {
  return kabulDateString(date);
}

export function recentDateRange(days = 30) {
  const to = kabulDateString();
  const from = addDaysToIsoDate(to, -days);
  return { from, to };
}

export function dateRangeQuery(from: string, to: string) {
  return new URLSearchParams({ from, to }).toString();
}
