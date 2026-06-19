import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { ManualDateInput } from "@/components/ui/manual-date-input";
import type { ReactNode } from "react";

export type LookupItem = {
  id: string;
  name: string;
  shortName?: string | null;
  code?: string;
  isBase?: boolean;
};

type FieldShellProps = {
  label: string;
  children: ReactNode;
  fullWidth?: boolean;
};

function FieldShell({ label, children, fullWidth = false }: FieldShellProps) {
  return (
    <label
      className={`form-grid-field grid gap-1.5 text-sm ${
        fullWidth ? "form-grid-field-full md:col-span-full" : ""
      }`}
    >
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export function TextField({
  label,
  value,
  type = "text",
  fullWidth = false,
  onChange,
}: {
  label: string;
  value: string;
  type?: string;
  fullWidth?: boolean;
  onChange: (value: string) => void;
}) {
  const isLongText =
    type === "textarea" || /یادداشت|شرح|توضیح|نوت/.test(label);

  return (
    <FieldShell label={label} fullWidth={fullWidth || isLongText}>
      {isLongText ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={4}
          className="min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
        />
      ) : type === "date" ? (
        <ManualDateInput value={value} onChange={onChange} />
      ) : (
        <Input
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </FieldShell>
  );
}

export function NumberField({
  label,
  value,
  fullWidth = false,
  onChange,
}: {
  label: string;
  value: number;
  fullWidth?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <FieldShell label={label} fullWidth={fullWidth}>
      <Input
        type="number"
        value={String(value)}
        onChange={(event) => onChange(Number(event.target.value || 0))}
      />
    </FieldShell>
  );
}

export function LookupSelect({
  label,
  value,
  options,
  emptyLabel,
  fullWidth = false,
  onChange,
}: {
  label: string;
  value: string;
  options: LookupItem[];
  emptyLabel?: string;
  fullWidth?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <FieldShell label={label} fullWidth={fullWidth}>
      <Combobox
        value={value}
        placeholder={emptyLabel || "انتخاب کنید"}
        onValueChange={onChange}
        options={[
          ...(emptyLabel ? [{ value: "", label: emptyLabel }] : []),
          ...options.map((option) => ({
            value: option.id,
            label: option.code || option.shortName || option.name,
            description:
              option.code || option.shortName
                ? option.name
                : option.shortName || option.code,
          })),
        ]}
      />
    </FieldShell>
  );
}
