import { ArchiveRestore, PauseCircle, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmActionDialog } from "./confirm-action-dialog";

import type { Currency, HeldCart } from "../types";
import { money } from "../utils";

type PosHeldCartsCardProps = {
  heldCarts: HeldCart[];
  currency: Currency | null;
  canHold: boolean;
  onHoldCart: () => void;
  onRestoreHeldCart: (id: string) => void;
  onDeleteHeldCart: (id: string) => void;
};

export function PosHeldCartsCard({
  heldCarts,
  currency,
  canHold,
  onHoldCart,
  onRestoreHeldCart,
  onDeleteHeldCart,
}: PosHeldCartsCardProps) {
  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">فروش‌های معلق</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-3 pt-0">
        <ConfirmActionDialog
          title="معلق‌کردن فروش فعلی"
          description="سبد فعلی ذخیره می‌شود و سبد فروش خالی می‌گردد تا بتوانید فروش مشتری بعدی را شروع کنید."
          confirmText="معلق شود"
          onConfirm={onHoldCart}
          trigger={
            <Button className="h-14 w-full justify-between gap-2 whitespace-normal" disabled={!canHold}>
              <span>نگهداشتن فروش</span>
              <PauseCircle className="h-5 w-5 shrink-0" />
            </Button>
          }
        />

        {heldCarts.length ? (
          <div className="max-h-72 space-y-2 overflow-y-auto pe-1">
            {heldCarts.map((held) => (
              <div key={held.id} className="rounded-xl border border-border bg-secondary p-3">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-bold">{held.name}</div>
                    <div className="text-xs leading-5 text-muted-foreground">
                      تعداد: {held.summary.itemsCount}
                      <br />
                      مجموع: {money(held.summary.total, currency)}
                    </div>
                  </div>

                  <div className="flex shrink-0 gap-2">
                    <Button size="icon" variant="outline" onClick={() => onRestoreHeldCart(held.id)}>
                      <ArchiveRestore className="h-4 w-4" />
                    </Button>

                    <ConfirmActionDialog
                      title="حذف فروش معلق"
                      description="آیا مطمئن هستید که می‌خواهید این فروش معلق حذف شود؟"
                      confirmText="حذف شود"
                      destructive
                      onConfirm={() => onDeleteHeldCart(held.id)}
                      trigger={
                        <Button size="icon" variant="destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      }
                    />
                  </div>
                </div>

                <div className="text-xs text-muted-foreground">
                  {new Date(held.createdAt).toLocaleString("fa-AF")}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
            فروش معلقی وجود ندارد.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
