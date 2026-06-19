export const KABUL_TIME_ZONE = "Asia/Kabul";

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function kabulDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: KABUL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value || 0);

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
  };
}

export function kabulDateString(date = new Date()) {
  const { year, month, day } = kabulDateParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseKabulDateInput(value: string | null | undefined, endOfDay = false) {
  if (!value) return null;

  if (!DATE_ONLY_RE.test(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "INVALID_DATE" : date;
  }

  const [year, month, day] = value.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, day, -4, -30, 0, 0));

  if (Number.isNaN(start.getTime())) return "INVALID_DATE";

  return endOfDay ? new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1) : start;
}

export function kabulDayRange(value?: string) {
  const source = value && DATE_ONLY_RE.test(value) ? value : kabulDateString();
  const start = parseKabulDateInput(source);
  const end = parseKabulDateInput(source, true);

  if (start === "INVALID_DATE" || end === "INVALID_DATE" || !start || !end) {
    return {
      source: kabulDateString(),
      start: parseKabulDateInput(kabulDateString()) as Date,
      end: parseKabulDateInput(kabulDateString(), true) as Date,
    };
  }

  return { source, start, end };
}

export function kabulDateRange(from?: string, to?: string) {
  const today = kabulDateString();
  const fromSource = from && DATE_ONLY_RE.test(from) ? from : today;
  const toSource = to && DATE_ONLY_RE.test(to) ? to : fromSource;
  const start = parseKabulDateInput(fromSource);
  const end = parseKabulDateInput(toSource, true);

  if (start === "INVALID_DATE" || end === "INVALID_DATE" || !start || !end) {
    const fallback = kabulDayRange();
    return { from: fallback.source, to: fallback.source, start: fallback.start, end: fallback.end };
  }

  return { from: fromSource, to: toSource, start, end };
}
