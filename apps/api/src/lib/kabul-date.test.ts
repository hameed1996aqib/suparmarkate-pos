import { afterEach, describe, expect, it, vi } from "vitest";
import {
  kabulDateKey,
  kabulDateTime,
  kabulExpiryWindow,
  nextKabulDay,
  parseDatabaseDate,
  parseKabulDateInput,
  startOfKabulDay
} from "./kabul-date";

const originalTimeZone = process.env.TZ;

afterEach(() => {
  vi.useRealTimers();
  process.env.TZ = originalTimeZone;
});

describe("Kabul business dates", () => {
  it("keeps 00:43 Kabul on the correct local day", () => {
    const instant = new Date("2026-07-14T20:13:00.000Z");
    expect(kabulDateKey(instant)).toBe("2026-07-15");
  });

  it.each(["Asia/Kabul", "UTC", "America/New_York"])(
    "is independent from the server timezone %s",
    (timeZone) => {
      process.env.TZ = timeZone;
      expect(kabulDateKey(new Date("2026-07-14T20:13:00.000Z"))).toBe(
        "2026-07-15"
      );
    }
  );

  it("creates exact half-open Kabul day boundaries", () => {
    expect(startOfKabulDay("2026-06-30")).toEqual(
      new Date("2026-06-29T19:30:00.000Z")
    );
    expect(nextKabulDay("2026-06-30")).toEqual(
      new Date("2026-06-30T19:30:00.000Z")
    );
    expect(parseKabulDateInput("2026-06-30", true)).toEqual(
      new Date("2026-06-30T19:30:00.000Z")
    );
  });

  it("combines a Kabul calendar date with a wall-clock time", () => {
    expect(kabulDateTime("2026-06-30", "08:15")).toEqual(
      new Date("2026-06-30T03:45:00.000Z")
    );
    expect(kabulDateTime("2026-06-30", "24:00")).toBe("INVALID_DATE");
  });

  it("keeps database date-only values independent from server timezone", () => {
    expect(parseDatabaseDate("2026-06-30")).toEqual(
      new Date("2026-06-30T00:00:00.000Z")
    );
    expect(parseDatabaseDate("2026-02-30")).toBeNull();
  });

  it("treats expiry as valid until the end of the Kabul date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T20:13:00.000Z"));
    const window = kabulExpiryWindow(30);
    expect(window.todayStart).toEqual(new Date("2026-07-14T19:30:00.000Z"));
    expect(window.targetEndExclusive).toEqual(
      new Date("2026-08-14T19:30:00.000Z")
    );
  });
});
