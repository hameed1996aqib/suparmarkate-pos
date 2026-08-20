export const KABUL_TIME_ZONE = "Asia/Kabul";

function kabulDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: KABUL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value || "";

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
  };
}

export function kabulDateString(date = new Date()) {
  const { year, month, day } = kabulDateParts(date);
  return `${year}-${month}-${day}`;
}

export function kabulMonthStartString(date = new Date()) {
  const { year, month } = kabulDateParts(date);
  return `${year}-${month}-01`;
}

export function kabulTimeString(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: KABUL_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: "hour" | "minute") =>
    parts.find((part) => part.type === type)?.value || "00";
  return `${value("hour")}:${value("minute")}`;
}

export function addDaysToIsoDate(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function formatKabulDateTime(value: Date | string) {
  return new Intl.DateTimeFormat("fa-AF-u-ca-persian", {
    timeZone: KABUL_TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatKabulDate(value: Date | string) {
  return new Intl.DateTimeFormat("fa-AF-u-ca-persian", {
    timeZone: KABUL_TIME_ZONE,
    dateStyle: "medium",
  }).format(new Date(value));
}
