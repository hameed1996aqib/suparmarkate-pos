import type { Context } from "hono";

function parseDate(value: string | undefined, endOfDay = false) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    date.setHours(23, 59, 59, 999);
  }
  return date;
}

export function getRecentDateRange(c: Context, days = 30) {
  const to = parseDate(c.req.query("to"), true) ?? new Date();
  const from =
    parseDate(c.req.query("from")) ??
    new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

  return {
    gte: from,
    lte: to
  };
}
