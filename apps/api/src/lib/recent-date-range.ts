import type { Context } from "hono";
import { parseKabulDateInput } from "./kabul-date";

function parseDate(value: string | undefined, endOfDay = false) {
  if (!value) return null;
  const date = parseKabulDateInput(value, endOfDay);
  if (!date || date === "INVALID_DATE") return null;
  if (Number.isNaN(date.getTime())) return null;
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
