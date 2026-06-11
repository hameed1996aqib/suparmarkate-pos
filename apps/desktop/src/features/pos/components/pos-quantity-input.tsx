import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";

type PosQuantityInputProps = {
  value: number;
  className?: string;
  onCommit: (value: number) => void;
};

export function normalizePosQuantity(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0.001;
  return Math.max(0.001, Math.round(value * 1000) / 1000);
}

function formatQuantity(value: number) {
  return normalizePosQuantity(value).toLocaleString("en-US", {
    maximumFractionDigits: 3,
    useGrouping: false,
  });
}

function parseQuantity(value: string) {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d*\.?\d*$/.test(normalized)) return null;
  if (!normalized || normalized === "." || normalized.endsWith(".")) return null;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? normalizePosQuantity(parsed) : null;
}

export function PosQuantityInput({
  value,
  className,
  onCommit,
}: PosQuantityInputProps) {
  const [text, setText] = useState(formatQuantity(value));
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setText(formatQuantity(value));
    }
  }, [isFocused, value]);

  function commit(nextText = text) {
    const parsed = parseQuantity(nextText);

    if (parsed === null) {
      setText(formatQuantity(value));
      return;
    }

    setText(formatQuantity(parsed));

    if (parsed !== value) {
      onCommit(parsed);
    }
  }

  return (
    <Input
      className={className}
      inputMode="decimal"
      value={text}
      onBlur={() => {
        commit();
        setIsFocused(false);
      }}
      onChange={(event) => {
        const nextText = event.target.value.replace(",", ".");

        if (!/^\d*\.?\d*$/.test(nextText)) return;

        setText(nextText);

        const parsed = parseQuantity(nextText);
        if (parsed !== null && parsed !== value) {
          onCommit(parsed);
        }
      }}
      onFocus={() => setIsFocused(true)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
      }}
    />
  );
}
