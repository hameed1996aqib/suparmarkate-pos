import {
  BadgeDollarSign,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  Printer,
  Wallet,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import type { Currency } from "../types";
import { money } from "../utils";
import { ConfirmActionDialog } from "./confirm-action-dialog";

type PosSummaryCardProps = {
  itemsCount: number;
  subtotal: number;
  invoiceDiscount: number;
  payableTotal: number;
  paidAmount: number;
  remainingAmount: number;
  changeAmount: number;
  currency: Currency | null;
  lastSaleId: string | null;
  lastReceiptUrl: string | null;
  canSubmitSale: boolean;
  disabledReason: string;
  onInvoiceDiscountChange: (value: number) => void;
  onPaidAmountChange: (value: number) => void;
  onSubmitSale: () => void;
  onPrintLastReceipt: () => void;
  onOpenLastReceipt: () => void;
};

function uniqueAmounts(values: number[]) {
  return Array.from(new Set(values.filter((value) => Number.isFinite(value) && value >= 0)));
}

export function PosSummaryCard({
  itemsCount,
  subtotal,
  invoiceDiscount,
  payableTotal,
  paidAmount,
  remainingAmount,
  changeAmount,
  currency,
  lastSaleId,
  lastReceiptUrl,
  canSubmitSale,
  disabledReason,
  onInvoiceDiscountChange,
  onPaidAmountChange,
  onSubmitSale,
  onPrintLastReceipt,
  onOpenLastReceipt,
}: PosSummaryCardProps) {
  const rounded50 = Math.ceil(payableTotal / 50) * 50;
  const rounded100 = Math.ceil(payableTotal / 100) * 100;
  const quickAmounts = uniqueAmounts([payableTotal, rounded50, rounded100]).slice(0, 3);

  return (
    <Card className="border-border bg-card">
      <CardHeader className="border-b border-border pb-3">
        <CardTitle className="text-base">پرداخت و تسویه</CardTitle>
      </CardHeader>

      <CardContent className="space-y-3 pt-4">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-secondary p-3">
            <span className="text-xs text-muted-foreground">تعداد اقلام</span>
            <strong className="mt-1 block text-lg">{itemsCount}</strong>
          </div>
          <div className="rounded-xl bg-secondary p-3">
            <span className="text-xs text-muted-foreground">جمع مبلغ</span>
            <strong className="mt-1 block text-lg">
              {money(subtotal, currency)}
            </strong>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-2">
          <label className="text-sm text-muted-foreground">تخفیف کلی فاکتور</label>
          <Input
            type="number"
            min={0}
            max={subtotal}
            value={invoiceDiscount}
            onChange={(event) => onInvoiceDiscountChange(Number(event.target.value))}
            className="h-11 text-base font-bold"
          />
          </div>

          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">مبلغ دریافتی</label>
            <Input
              type="number"
              min={0}
              value={paidAmount}
              onChange={(event) => onPaidAmountChange(Number(event.target.value))}
              className="h-11 text-base font-bold"
            />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-primary/30 bg-primary/10 p-4">
          <span className="text-muted-foreground">قابل پرداخت</span>
          <strong className="text-2xl text-primary">
            {money(payableTotal, currency)}
          </strong>
        </div>

        {quickAmounts.length ? (
          <div className="grid grid-cols-3 gap-2">
            {quickAmounts.map((amount) => (
              <Button
                key={amount}
                type="button"
                variant={paidAmount === amount ? "default" : "secondary"}
                onClick={() => onPaidAmountChange(amount)}
              >
                {money(amount, currency)}
              </Button>
            ))}
          </div>
        ) : null}

        {remainingAmount > 0 ? (
          <div className="flex items-center justify-between rounded-xl border border-destructive/40 bg-destructive/10 p-4">
            <span className="text-muted-foreground">باقی‌مانده</span>
            <strong className="text-xl text-destructive">
              {money(remainingAmount, currency)}
            </strong>
          </div>
        ) : (
          <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
            <span className="text-muted-foreground">برگشت پول</span>
            <strong className="text-xl text-emerald-400">
              {money(changeAmount, currency)}
            </strong>
          </div>
        )}

        <ConfirmActionDialog
          title="ثبت فروش"
          description="آیا مطمئن هستید که می‌خواهید این فروش ثبت شود؟ بعد از ثبت، موجودی کم می‌شود، پرداخت ذخیره می‌شود و رسید چاپ می‌گردد."
          confirmText="ثبت فروش"
          onConfirm={onSubmitSale}
          trigger={
            <Button className="h-14 w-full gap-2 text-base" disabled={!canSubmitSale}>
              <BadgeDollarSign className="h-5 w-5" />
              ثبت فروش و چاپ رسید
            </Button>
          }
        />

        {!canSubmitSale && disabledReason ? (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {disabledReason}
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
          <Button type="button" variant="secondary" className="h-12 gap-2">
            <Wallet className="h-4 w-4" />
            نقدی
          </Button>

          <Button type="button" variant="secondary" className="h-12 gap-2">
            <CreditCard className="h-4 w-4" />
            کارت
          </Button>

          <Button
            type="button"
            variant="secondary"
            disabled={!lastReceiptUrl}
            onClick={onPrintLastReceipt}
            className="h-12 gap-2"
          >
            <Printer className="h-4 w-4" />
            چاپ
          </Button>

          <Button
            type="button"
            variant="outline"
            disabled={!lastReceiptUrl}
            onClick={onOpenLastReceipt}
            className="h-12 gap-2"
          >
            <ExternalLink className="h-4 w-4" />
            رسید
          </Button>
        </div>

        {lastSaleId ? (
          <div className="flex items-center justify-center gap-2 text-sm text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
            آخرین فروش ثبت شد
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
