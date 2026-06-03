export function toDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function recentDateRange(days = 30) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { from: toDateInput(from), to: toDateInput(to) };
}

export function dateRangeQuery(from: string, to: string) {
  return new URLSearchParams({ from, to }).toString();
}
