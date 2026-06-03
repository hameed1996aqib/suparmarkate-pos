import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";

export function MetricCard({
  title,
  label,
  value,
  icon,
  trend,
}: {
  title?: string;
  label?: string;
  value: string;
  icon: ReactNode;
  trend?: string;
}) {
  return (
    <Card className="group overflow-hidden border-border bg-card shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg">
      <CardContent className="relative flex min-h-28 items-center justify-between gap-3 p-4">
        <div className="absolute inset-x-0 top-0 h-1 bg-primary/70" />
        <div className="absolute -end-8 -top-8 size-24 rounded-full bg-primary/10 blur-2xl transition group-hover:bg-primary/20" />
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold uppercase text-muted-foreground">
            {title || label}
          </p>
          <strong className="mt-2 block truncate font-heading text-2xl font-semibold tracking-normal">
            {value}
          </strong>
          {trend && (
            <span className="mt-1 block truncate text-xs text-primary">
              {trend}
            </span>
          )}
        </div>
        <div className="relative flex size-12 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary shadow-inner">
          <div className="[&_svg]:size-6">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}
