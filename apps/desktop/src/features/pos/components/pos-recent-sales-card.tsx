import { ExternalLink, Printer, ReceiptText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

import type { Currency, PosShiftSale } from "../types";
import { money } from "../utils";

type PosRecentSalesCardProps = {
  sales: PosShiftSale[];
  currency: Currency | null;
  onPrintReceipt: (url: string | null) => void;
  onOpenReceipt: (url: string | null) => void;
};

export function PosRecentSalesCard({
  sales,
  currency,
  onPrintReceipt,
  onOpenReceipt,
}: PosRecentSalesCardProps) {
  const recentSales = [...sales].reverse().slice(0, 8);

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ReceiptText className="h-5 w-5" />
          فروش‌های اخیر
        </CardTitle>
        <CardDescription>
          فروش‌های ثبت‌شده در شیفت فعلی
        </CardDescription>
      </CardHeader>

      <CardContent>
        {recentSales.length ? (
          <ScrollArea className="max-h-[320px]">
            <div className="space-y-2">
              {recentSales.map((sale) => (
                <div
                  key={sale.id}
                  className="rounded-xl border border-border bg-secondary p-3"
                >
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-bold">{sale.invoiceNo}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(sale.createdAt).toLocaleString("fa-AF")}
                      </div>
                    </div>

                    <strong>{money(sale.total, currency)}</strong>
                  </div>

                  <div className="mb-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <div>دریافت: {money(sale.paidAmount, currency)}</div>
                    <div>برگشت: {money(sale.changeAmount, currency)}</div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={!sale.receiptUrl}
                      onClick={() => onPrintReceipt(sale.receiptUrl || null)}
                      className="gap-1"
                    >
                      <Printer className="h-4 w-4" />
                      چاپ
                    </Button>

                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!sale.receiptUrl}
                      onClick={() => onOpenReceipt(sale.receiptUrl || null)}
                      className="gap-1"
                    >
                      <ExternalLink className="h-4 w-4" />
                      بازکردن
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        ) : (
          <div className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
            هنوز فروشی در این شیفت ثبت نشده است.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
