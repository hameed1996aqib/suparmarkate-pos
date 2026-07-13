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

export function addDaysToIsoDate(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}
