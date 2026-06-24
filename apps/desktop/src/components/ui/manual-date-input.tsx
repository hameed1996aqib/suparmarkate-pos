import { CalendarDays } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type ManualDateInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
};

type ParsedDate =
  | {
      ok: true;
      inputKind: "gregorian" | "jalali";
      isoDate: string;
      gregorianDate: Date;
      year: number;
      month: number;
      day: number;
    }
  | { ok: false; reason: string };

const persianDigitMap: Record<string, string> = {
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9",
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
};

function normalizeDateText(value: string) {
  return value
    .trim()
    .replace(/[۰-۹٠-٩]/g, (digit) => persianDigitMap[digit] || digit)
    .replace(/[./\s]+/g, "-");
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function toIsoDate(year: number, month: number, day: number) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function isValidGregorianDate(year: number, month: number, day: number) {
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function div(a: number, b: number) {
  return Math.trunc(a / b);
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

  const parsed = new Date(Date.UTC(gy, gm - 1, gd));
  return {
    year: parsed.getUTCFullYear(),
    month: parsed.getUTCMonth() + 1,
    day: parsed.getUTCDate(),
  };
}

function isValidJalaliDate(year: number, month: number, day: number) {
  if (month < 1 || month > 12 || day < 1) return false;
  if (month <= 6) return day <= 31;
  if (month <= 11) return day <= 30;

  try {
    const current = jalaliToGregorian(year, 12, 29);
    const next = jalaliToGregorian(year + 1, 1, 1);
    const days =
      (Date.UTC(next.year, next.month - 1, next.day) -
        Date.UTC(current.year, current.month - 1, current.day)) /
      86400000;
    return day <= (days === 2 ? 30 : 29);
  } catch {
    return false;
  }
}

function parseManualDate(value: string): ParsedDate {
  const normalized = normalizeDateText(value);
  if (!normalized) {
    return { ok: false, reason: "تاریخ را وارد کنید" };
  }

  const completeDatePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!completeDatePattern.test(normalized)) {
    return { ok: false, reason: "تاریخ را کامل به فرمت YYYY-MM-DD وارد کنید" };
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) {
    return { ok: false, reason: "فرمت تاریخ باید YYYY-MM-DD باشد" };
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return { ok: false, reason: "تاریخ معتبر نیست" };
  }

  if (year >= 1500) {
    if (!isValidGregorianDate(year, month, day)) {
      return { ok: false, reason: "تاریخ میلادی معتبر نیست" };
    }

    const gregorianDate = new Date(Date.UTC(year, month - 1, day));
    return {
      ok: true,
      inputKind: "gregorian",
      isoDate: toIsoDate(year, month, day),
      gregorianDate,
      year,
      month,
      day,
    };
  }

  if (!isValidJalaliDate(year, month, day)) {
    return { ok: false, reason: "تاریخ هجری شمسی معتبر نیست" };
  }

  const gregorian = jalaliToGregorian(year, month, day);
  const gregorianDate = new Date(
    Date.UTC(gregorian.year, gregorian.month - 1, gregorian.day),
  );

  return {
    ok: true,
    inputKind: "jalali",
    isoDate: toIsoDate(gregorian.year, gregorian.month, gregorian.day),
    gregorianDate,
    year,
    month,
    day,
  };
}

function isValidDateText(value: string) {
  if (!value.trim()) return true;
  return parseManualDate(value).ok;
}

function formatPersianDate(date: Date) {
  return new Intl.DateTimeFormat("fa-AF-u-ca-persian", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function shouldBypassDateValidation(button: HTMLButtonElement) {
  const text = `${button.textContent || ""} ${button.getAttribute("aria-label") || ""}`;
  return /لغو|بستن|انصراف|Cancel|Close/i.test(text);
}

let globalDateValidationGuardInstalled = false;

function installGlobalDateValidationGuard() {
  if (globalDateValidationGuardInstalled || typeof document === "undefined") {
    return;
  }

  globalDateValidationGuardInstalled = true;

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const button = target.closest("button");
      if (!(button instanceof HTMLButtonElement)) return;
      if (shouldBypassDateValidation(button)) return;

      const scope = button.closest('[role="dialog"], form');
      if (!scope) return;

      const invalidInput = scope.querySelector<HTMLInputElement>(
        'input[data-manual-date-input="true"][aria-invalid="true"]',
      );

      if (!invalidInput) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      invalidInput.focus();
      invalidInput.reportValidity();
    },
    true,
  );

  document.addEventListener(
    "submit",
    (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      const invalidInput = form.querySelector<HTMLInputElement>(
        'input[data-manual-date-input="true"][aria-invalid="true"]',
      );
      if (!invalidInput) return;

      event.preventDefault();
      event.stopPropagation();
      invalidInput.focus();
      invalidInput.reportValidity();
    },
    true,
  );
}

export function ManualDateInput({
  value,
  onChange,
  placeholder = "YYYY-MM-DD",
  className,
}: ManualDateInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [text, setText] = useState(value || "");
  const parsed = text.trim() ? parseManualDate(text) : null;
  const isValid = !text.trim() || parsed?.ok === true;
  const helperText =
    parsed?.ok === true
      ? parsed.inputKind === "jalali"
        ? `تاریخ میلادی ثبت‌شونده: ${parsed.isoDate}`
        : `معادل شمسی: ${formatPersianDate(parsed.gregorianDate)}`
      : parsed?.reason || "فرمت تاریخ باید YYYY-MM-DD باشد";

  useEffect(() => {
    installGlobalDateValidationGuard();
  }, []);

  useEffect(() => {
    setText(value || "");
  }, [value]);

  useEffect(() => {
    inputRef.current?.setCustomValidity(
      isValid ? "" : "تاریخ را درست وارد کنید. نمونه: 2026-06-23 یا 1405-04-02",
    );
  }, [isValid]);

  const handleChange = (next: string) => {
    setText(next);

    if (!next.trim()) {
      onChange("");
      return;
    }

    const nextParsed = parseManualDate(next);
    if (nextParsed.ok) onChange(nextParsed.isoDate);
  };

  return (
    <div className={cn("grid gap-1", className)}>
      <div className="relative">
        <Input
          ref={inputRef}
          data-manual-date-input="true"
          dir="ltr"
          inputMode="numeric"
          value={text}
          placeholder={placeholder}
          onChange={(event) => handleChange(event.target.value)}
          aria-invalid={!isValid}
          title="تاریخ را به فرمت YYYY-MM-DD وارد کنید. سال 1500 به بالا میلادی و کمتر از 1500 هجری شمسی حساب می‌شود."
          className={cn(
            "pe-9 text-left font-mono",
            isValid &&
              text.trim() &&
              "border-emerald-500 focus-visible:ring-emerald-500/40",
            !isValid && "border-destructive focus-visible:ring-destructive",
          )}
        />
        <CalendarDays className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      </div>
      {text.trim() ? (
        <p
          className={cn(
            "text-xs",
            isValid
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-destructive",
          )}
        >
          {helperText}
        </p>
      ) : null}
    </div>
  );
}
