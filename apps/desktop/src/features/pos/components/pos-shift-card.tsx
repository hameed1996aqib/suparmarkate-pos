import { Printer, RotateCcw, TimerReset } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmActionDialog } from "./confirm-action-dialog";

import type { Currency, PosShiftSummary } from "../types";
import { money } from "../utils";

type PosShiftCardProps = {
  shift: PosShiftSummary;
  stats: {
    invoiceCount: number;
    totalSales: number;
    totalPaid: number;
    totalChange: number;
    netCash: number;
  };
  currency: Currency | null;
  onPrintShift: () => void;
  onStartNewShift: () => void;
};

export function PosShiftCard({
  shift,
  stats,
  currency,
  onPrintShift,
  onStartNewShift,
}: PosShiftCardProps) {
  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TimerReset className="h-5 w-5" />
          گزارش شیفت
        </CardTitle>
        <CardDescription>
          شروع شیفت: {new Date(shift.openedAt).toLocaleString("fa-AF")}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="grid gap-2 text-sm">
          <div className="flex justify-between rounded-lg bg-secondary p-3">
            <span className="text-muted-foreground">تعداد فاکتور</span>
            <strong>{stats.invoiceCount}</strong>
          </div>

          <div className="flex justify-between rounded-lg bg-secondary p-3">
            <span className="text-muted-foreground">مجموع فروش</span>
            <strong>{money(stats.totalSales, currency)}</strong>
          </div>

          <div className="flex justify-between rounded-lg bg-secondary p-3">
            <span className="text-muted-foreground">دریافت نقدی</span>
            <strong>{money(stats.totalPaid, currency)}</strong>
          </div>

          <div className="flex justify-between rounded-lg bg-secondary p-3">
            <span className="text-muted-foreground">برگشت پول</span>
            <strong>{money(stats.totalChange, currency)}</strong>
          </div>

          <div className="flex justify-between rounded-lg bg-primary/15 p-3">
            <span className="text-muted-foreground">نقد داخل صندوق</span>
            <strong>{money(stats.netCash, currency)}</strong>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onPrintShift}
            className="gap-2"
          >
            <Printer className="h-4 w-4" />
            چاپ شیفت
          </Button>

          <ConfirmActionDialog
            title="شروع شیفت جدید"
            description="آیا مطمئن هستید؟ آمار شیفت فعلی پاک می‌شود و شیفت جدید شروع می‌گردد."
            confirmText="شروع شیفت جدید"
            destructive
            onConfirm={onStartNewShift}
            trigger={
              <Button type="button" variant="outline" className="gap-2">
                <RotateCcw className="h-4 w-4" />
                شیفت جدید
              </Button>
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}
