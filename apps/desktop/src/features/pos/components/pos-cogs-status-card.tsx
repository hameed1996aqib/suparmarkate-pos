import { CheckCircle2, CircleDollarSign, Info, XCircle } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Currency } from "../types";
import { money } from "../utils";

type PosCogsStatusCardProps = {
  status: {
    status: "none" | "posted" | "skipped" | "error";
    message: string;
    total: number;
  };
  currency: Currency | null;
};

const fallbackStatus: PosCogsStatusCardProps["status"] = {
  status: "none",
  message: "",
  total: 0,
};

export function PosCogsStatusCard({
  status = fallbackStatus,
  currency,
}: Partial<PosCogsStatusCardProps> & Pick<PosCogsStatusCardProps, "currency">) {
  const icon =
    status.status === "posted" ? (
      <CheckCircle2 className="h-5 w-5 text-emerald-400" />
    ) : status.status === "error" ? (
      <XCircle className="h-5 w-5 text-destructive" />
    ) : status.status === "skipped" ? (
      <Info className="h-5 w-5 text-amber-400" />
    ) : (
      <CircleDollarSign className="h-5 w-5 text-muted-foreground" />
    );

  const label =
    status.status === "posted"
      ? "COGS ثبت شد"
      : status.status === "skipped"
        ? "COGS ساخته نشد"
        : status.status === "error"
          ? "خطای COGS"
          : "COGS آماده";

  return (
    <Card className="border-border bg-card">
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-3">
          {icon}
          <div>
            <div className="font-bold">وضعیت قیمت تمامشده</div>
            <div className="text-xs text-muted-foreground">
              {status.message || "بعد از ثبت فروش سند COGS اینجا نمایش داده میشود."}
            </div>
          </div>
        </div>

        <div className="text-left">
          <Badge variant={status.status === "posted" ? "default" : "secondary"}>
            {label}
          </Badge>
          {status.total > 0 ? (
            <div className="mt-1 text-sm font-bold">{money(status.total, currency)}</div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
