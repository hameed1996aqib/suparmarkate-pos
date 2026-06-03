import { CalendarDays } from "lucide-react";
import { useRef } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type DatePickerProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
};

export function DatePicker({
  value,
  onChange,
  placeholder = "تاریخ را انتخاب کنید",
  className,
}: DatePickerProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const formatted = value
    ? new Intl.DateTimeFormat("fa-AF", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }).format(new Date(value))
    : placeholder;

  return (
    <div className={cn("relative", className)}>
      <Button
        type="button"
        variant="outline"
        className="h-10 w-full justify-between"
        onClick={() => {
          const input = inputRef.current;
          if (!input) return;
          if (typeof input.showPicker === "function") input.showPicker();
          else input.click();
        }}
      >
        <span className={cn("truncate", !value && "text-muted-foreground")}>
          {formatted}
        </span>
        <CalendarDays className="size-4 text-muted-foreground" />
      </Button>
      <Input
        ref={inputRef}
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="pointer-events-none absolute inset-0 opacity-0"
        tabIndex={-1}
      />
    </div>
  );
}
