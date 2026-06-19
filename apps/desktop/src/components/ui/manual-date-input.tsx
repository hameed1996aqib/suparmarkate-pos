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

function isValidDateText(value: string) {
  if (!value.trim()) return true;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function formatPersianDate(value: string) {
  if (!isValidDateText(value) || !value.trim()) return "";
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return new Intl.DateTimeFormat("fa-AF-u-ca-persian", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(parsed);
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
  const isValid = isValidDateText(text);
  const persianDate = formatPersianDate(text);

  useEffect(() => {
    installGlobalDateValidationGuard();
  }, []);

  useEffect(() => {
    setText(value || "");
  }, [value]);

  useEffect(() => {
    inputRef.current?.setCustomValidity(
      isValid ? "" : "تاریخ را به فرمت YYYY-MM-DD درست وارد کنید",
    );
  }, [isValid]);

  const handleChange = (next: string) => {
    setText(next);
    if (!next.trim()) {
      onChange("");
      return;
    }
    if (isValidDateText(next)) onChange(next);
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
          title="تاریخ را به فرمت YYYY-MM-DD وارد کنید"
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
          {isValid
            ? `معادل شمسی: ${persianDate}`
            : "فرمت تاریخ باید YYYY-MM-DD باشد"}
        </p>
      ) : null}
    </div>
  );
}
