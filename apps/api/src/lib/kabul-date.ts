export const KABUL_TIME_ZONE = "Asia/Kabul";
export const BUSINESS_TIME_ZONE = KABUL_TIME_ZONE;

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const KABUL_OFFSET_MS = (4 * 60 + 30) * 60 * 1000;

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

export function kabulNow() {
  return new Date();
}

export function kabulDateKey(date = kabulNow()) {
  const { year, month, day } = kabulDateParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export const kabulDateString = kabulDateKey;

function parseDateOnly(value: string) {
  if (!DATE_ONLY_RE.test(value)) return "INVALID_DATE" as const;

  const [year, month, day] = value.split("-").map(Number);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return "INVALID_DATE" as const;
  }

  const start = new Date(
    Date.UTC(year, month - 1, day, 0, 0, 0, 0) - KABUL_OFFSET_MS,
  );

  if (Number.isNaN(start.getTime()) || kabulDateKey(start) !== value) {
    return "INVALID_DATE" as const;
  }

  return start;
}

export function startOfKabulDay(value: string | Date = kabulDateKey()) {
  return parseDateOnly(value instanceof Date ? kabulDateKey(value) : value);
}

export function nextKabulDay(value: string | Date = kabulDateKey()) {
  const start = startOfKabulDay(value);
  return start === "INVALID_DATE"
    ? start
    : new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

export function kabulDateTime(value: string | Date, time: string) {
  const source = value instanceof Date ? kabulDateKey(value) : value;
  const start = startOfKabulDay(source);
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());
  if (start === "INVALID_DATE" || !match) return "INVALID_DATE" as const;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] || 0);
  if (hours > 23 || minutes > 59 || seconds > 59) {
    return "INVALID_DATE" as const;
  }

  return new Date(
    start.getTime() +
      hours * 60 * 60 * 1000 +
      minutes * 60 * 1000 +
      seconds * 1000
  );
}

export function parseDatabaseDate(value: string | null | undefined) {
  if (!value || !DATE_ONLY_RE.test(value)) return null;
  const start = startOfKabulDay(value);
  if (start === "INVALID_DATE") return null;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function parseKabulDateInput(
  value: string | null | undefined,
  endExclusive = false,
) {
  if (!value) return null;

  if (DATE_ONLY_RE.test(value)) {
    return endExclusive ? nextKabulDay(value) : startOfKabulDay(value);
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "INVALID_DATE" : date;
}

export function kabulDayRange(value?: string) {
  const source = value && DATE_ONLY_RE.test(value) ? value : kabulDateKey();
  const start = parseKabulDateInput(source);
  const end = parseKabulDateInput(source, true);

  if (start === "INVALID_DATE" || end === "INVALID_DATE" || !start || !end) {
    const fallbackSource = kabulDateKey();
    return {
      source: fallbackSource,
      start: startOfKabulDay(fallbackSource) as Date,
      end: nextKabulDay(fallbackSource) as Date,
    };
  }

  return { source, start, end };
}

export function kabulExpiryWindow(days: number) {
  const safeDays = Math.max(0, Math.trunc(days));
  const { start } = kabulDayRange();
  return {
    todayStart: start,
    targetEndExclusive: new Date(
      start.getTime() + (safeDays + 1) * 24 * 60 * 60 * 1000
    )
  };
}

export function kabulDateRange(from?: string, to?: string) {
  const today = kabulDateKey();
  const fromSource = from && DATE_ONLY_RE.test(from) ? from : today;
  const toSource = to && DATE_ONLY_RE.test(to) ? to : fromSource;
  const start = parseKabulDateInput(fromSource);
  const end = parseKabulDateInput(toSource, true);

  if (
    start === "INVALID_DATE" ||
    end === "INVALID_DATE" ||
    !start ||
    !end ||
    start >= end
  ) {
    const fallback = kabulDayRange();
    return { from: fallback.source, to: fallback.source, start: fallback.start, end: fallback.end };
  }

  return { from: fromSource, to: toSource, start, end };
}

export function formatKabulDateTime(
  value: Date | string,
  options: Intl.DateTimeFormatOptions = {},
) {
  return new Intl.DateTimeFormat("fa-AF-u-ca-persian", {
    timeZone: KABUL_TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
    ...options,
  }).format(new Date(value));
}
