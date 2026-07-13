import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { kabulDateString } from "@/lib/kabul-date";
import { cn } from "@/lib/utils";

type DatePickerProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
};

type JalaliDate = {
  year: number;
  month: number;
  day: number;
};

type PopupPosition = {
  top: number;
  left: number;
  width: number;
};

const jalaliMonths = [
  "حمل",
  "ثور",
  "جوزا",
  "سرطان",
  "اسد",
  "سنبله",
  "میزان",
  "عقرب",
  "قوس",
  "جدی",
  "دلو",
  "حوت",
];

const weekDays = ["ش", "ی", "د", "س", "چ", "پ", "ج"];
const persianNumber = new Intl.NumberFormat("fa-AF", { useGrouping: false });

function div(a: number, b: number) {
  return Math.trunc(a / b);
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function isoDate(year: number, month: number, day: number) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function jalaliToGregorian(jy: number, jm: number, jd: number) {
  const jalaliYear = jy + 1595;
  let days =
    -355668 +
    365 * jalaliYear +
    div(jalaliYear, 33) * 8 +
    div((jalaliYear % 33) + 3, 4) +
    jd +
    (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);

  let gy = 400 * div(days, 146097);
  days %= 146097;

  if (days > 36524) {
    gy += 100 * div(days - 1, 36524);
    days = (days - 1) % 36524;
    if (days >= 365) days += 1;
  }

  gy += 4 * div(days, 1461);
  days %= 1461;

  if (days > 365) {
    gy += div(days - 1, 365);
    days = (days - 1) % 365;
  }

  let gd = days + 1;
  const monthDays = [
    0,
    31,
    (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0 ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  let gm = 1;

  while (gm <= 12 && gd > monthDays[gm]) {
    gd -= monthDays[gm];
    gm += 1;
  }

  return { year: gy, month: gm, day: gd };
}

function gregorianToJalali(gy: number, gm: number, gd: number): JalaliDate {
  const gregorianDays = [
    0,
    31,
    (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0 ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  let days =
    355666 +
    365 * gy +
    div(gy + 3, 4) -
    div(gy + 99, 100) +
    div(gy + 399, 400) +
    gd;

  for (let index = 1; index < gm; index += 1) {
    days += gregorianDays[index];
  }

  let jy = -1595 + 33 * div(days, 12053);
  days %= 12053;
  jy += 4 * div(days, 1461);
  days %= 1461;

  if (days > 365) {
    jy += div(days - 1, 365);
    days = (days - 1) % 365;
  }

  const jm = days < 186 ? 1 + div(days, 31) : 7 + div(days - 186, 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return { year: jy, month: jm, day: jd };
}

function dateToJalali(date: Date): JalaliDate {
  return gregorianToJalali(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
  );
}

function isoToJalali(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return null;
  return dateToJalali(date);
}

function jalaliToIso(value: JalaliDate) {
  const gregorian = jalaliToGregorian(value.year, value.month, value.day);
  return isoDate(gregorian.year, gregorian.month, gregorian.day);
}

function jalaliMonthLength(year: number, month: number) {
  if (month <= 6) return 31;
  if (month <= 11) return 30;
  const current = jalaliToGregorian(year, 12, 29);
  const next = jalaliToGregorian(year + 1, 1, 1);
  const dayCount =
    (Date.UTC(next.year, next.month - 1, next.day) -
      Date.UTC(current.year, current.month - 1, current.day)) /
    86400000;
  return dayCount === 2 ? 30 : 29;
}

function startOffset(year: number, month: number) {
  const gregorian = jalaliToGregorian(year, month, 1);
  const date = new Date(
    Date.UTC(gregorian.year, gregorian.month - 1, gregorian.day),
  );
  return (date.getUTCDay() + 1) % 7;
}

function addJalaliMonths(value: JalaliDate, delta: number): JalaliDate {
  const zeroBased = value.year * 12 + (value.month - 1) + delta;
  const year = Math.floor(zeroBased / 12);
  const month = (zeroBased % 12) + 1;
  return {
    year,
    month,
    day: Math.min(value.day, jalaliMonthLength(year, month)),
  };
}

function formatJalali(value: JalaliDate) {
  return `${persianNumber.format(value.day)} ${jalaliMonths[value.month - 1]} ${persianNumber.format(value.year)}`;
}

function todayJalali() {
  const [year, month, day] = kabulDateString().split("-").map(Number);
  return gregorianToJalali(year, month, day);
}

export function DatePicker({
  value,
  onChange,
  placeholder = "تاریخ را انتخاب کنید",
  className,
}: DatePickerProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const selected = value ? isoToJalali(value) : null;
  const today = todayJalali();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<JalaliDate>(selected || today);
  const [popupPosition, setPopupPosition] = useState<PopupPosition>({
    top: 0,
    left: 0,
    width: 288,
  });

  useEffect(() => {
    if (selected) setView(selected);
  }, [value]);

  useEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();
      const popupWidth = 288;
      const popupHeight = popupRef.current?.offsetHeight || 360;
      const viewportPadding = 8;
      const left = Math.min(
        Math.max(viewportPadding, rect.right - popupWidth),
        window.innerWidth - popupWidth - viewportPadding,
      );
      const hasSpaceBelow = rect.bottom + popupHeight + viewportPadding <= window.innerHeight;
      const top = hasSpaceBelow
        ? rect.bottom + 8
        : Math.max(viewportPadding, rect.top - popupHeight - 8);

      setPopupPosition({ top, left, width: popupWidth });
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (wrapperRef.current?.contains(target)) return;
      if (popupRef.current?.contains(target)) return;
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    updatePosition();
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;

    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    setPopupPosition((current) => ({
      ...current,
      top: rect.bottom + 8,
      left: Math.min(Math.max(8, rect.right - current.width), window.innerWidth - current.width - 8),
    }));
  }, [open]);

  const days = useMemo(() => {
    const cells: Array<{ day: number | null; key: string }> = [];
    const offset = startOffset(view.year, view.month);
    const monthLength = jalaliMonthLength(view.year, view.month);

    for (let index = 0; index < offset; index += 1) {
      cells.push({ day: null, key: `empty-${index}` });
    }

    for (let day = 1; day <= monthLength; day += 1) {
      cells.push({ day, key: `day-${day}` });
    }

    while (cells.length % 7 !== 0) {
      cells.push({ day: null, key: `tail-${cells.length}` });
    }

    return cells;
  }, [view.month, view.year]);

  const selectDay = (day: number) => {
    onChange(jalaliToIso({ year: view.year, month: view.month, day }));
    setOpen(false);
  };

  return (
    <div
      ref={wrapperRef}
      className={cn("relative", className)}
      dir="rtl"
    >
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        aria-expanded={open}
        className="h-10 w-full justify-between"
        onClick={() => {
          if (!selected) setView(todayJalali());
          setOpen((current) => !current);
        }}
      >
        <span className={cn("truncate", !selected && "text-muted-foreground")}>
          {selected ? formatJalali(selected) : placeholder}
        </span>
        <CalendarDays className="size-4 text-muted-foreground" />
      </Button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={popupRef}
              dir="rtl"
              style={{
                position: "fixed",
                top: popupPosition.top,
                left: popupPosition.left,
                width: popupPosition.width,
              }}
              className="z-[9999] rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-xl"
            >
          <div className="mb-3 flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setView((current) => addJalaliMonths(current, -1))}
              aria-label="ماه قبل"
            >
              <ChevronRight className="size-4" />
            </Button>
            <div className="text-center text-sm font-semibold">
              {jalaliMonths[view.month - 1]} {persianNumber.format(view.year)}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setView((current) => addJalaliMonths(current, 1))}
              aria-label="ماه بعد"
            >
              <ChevronLeft className="size-4" />
            </Button>
          </div>

          <div className="mb-1 grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
            {weekDays.map((day) => (
              <div key={day} className="py-1">
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {days.map((cell) => {
              const isSelected =
                Boolean(selected) &&
                selected?.year === view.year &&
                selected.month === view.month &&
                selected.day === cell.day;
              const isToday =
                today.year === view.year &&
                today.month === view.month &&
                today.day === cell.day;

              return cell.day ? (
                <Button
                  key={cell.key}
                  type="button"
                  variant={isSelected ? "default" : "ghost"}
                  size="icon-sm"
                  className={cn(
                    "h-8 w-full rounded-md",
                    isToday &&
                      !isSelected &&
                      "border border-primary/50 text-primary",
                  )}
                  onClick={() => selectDay(cell.day as number)}
                >
                  {persianNumber.format(cell.day)}
                </Button>
              ) : (
                <div key={cell.key} className="h-8" />
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              پاک کردن
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setView(today);
                onChange(jalaliToIso(today));
                setOpen(false);
              }}
            >
              امروز
            </Button>
          </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
