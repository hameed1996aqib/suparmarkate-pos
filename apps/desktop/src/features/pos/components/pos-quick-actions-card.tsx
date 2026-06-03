import { FilePlus2, Printer, ReceiptText, RefreshCcw, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmActionDialog } from "./confirm-action-dialog";

type PosQuickActionsCardProps = {
  canPrintLastReceipt: boolean;
  onNewInvoice: () => void;
  onRefreshData: () => void;
  onResetSession: () => void;
  onPrintLastReceipt: () => void;
  onPrintShiftReport: () => void;
  onStartNewShift: () => void;
};

export function PosQuickActionsCard({
  canPrintLastReceipt,
  onNewInvoice,
  onRefreshData,
  onResetSession,
  onPrintLastReceipt,
  onPrintShiftReport,
  onStartNewShift,
}: PosQuickActionsCardProps) {
  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">عملیات سریع</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 p-3 pt-0">
        <Button
          type="button"
          variant="outline"
          onClick={onNewInvoice}
          className="h-14 justify-between gap-3 whitespace-normal border-primary/30 text-sm"
        >
          <span>فاکتور جدید</span>
          <FilePlus2 className="h-5 w-5 shrink-0 text-primary" />
        </Button>

        <ConfirmActionDialog
          title="ساخت جلسه POS جدید"
          description="QR و Session فعلی عوض می‌شود. اگر موبایل وصل است، باید دوباره QR جدید را اسکن کند."
          confirmText="جلسه جدید"
          onConfirm={onResetSession}
          trigger={
            <Button type="button" variant="secondary" className="h-11 justify-between gap-2 whitespace-normal text-sm">
              <span>تازه‌سازی اتصال</span>
              <RefreshCcw className="h-4 w-4 shrink-0" />
            </Button>
          }
        />

        <Button type="button" variant="secondary" onClick={onRefreshData} className="h-11 justify-between gap-2 whitespace-normal text-sm">
          <span>بروزرسانی دیتا</span>
          <RefreshCcw className="h-4 w-4 shrink-0" />
        </Button>

        <Button type="button" variant="secondary" disabled={!canPrintLastReceipt} onClick={onPrintLastReceipt} className="h-11 justify-between gap-2 whitespace-normal text-sm">
          <span>چاپ آخرین رسید</span>
          <Printer className="h-4 w-4 shrink-0" />
        </Button>

        <Button type="button" variant="secondary" onClick={onPrintShiftReport} className="h-11 justify-between gap-2 whitespace-normal text-sm">
          <span>چاپ گزارش شیفت</span>
          <ReceiptText className="h-4 w-4 shrink-0" />
        </Button>

        <ConfirmActionDialog
          title="شروع شیفت جدید"
          description="آمار شیفت فعلی پاک می‌شود و شیفت جدید شروع می‌گردد."
          confirmText="شیفت جدید"
          destructive
          onConfirm={onStartNewShift}
          trigger={
            <Button type="button" variant="outline" className="h-11 justify-between gap-2 whitespace-normal text-sm">
              <span>شیفت جدید</span>
              <RotateCcw className="h-4 w-4 shrink-0" />
            </Button>
          }
        />
      </CardContent>
    </Card>
  );
}
