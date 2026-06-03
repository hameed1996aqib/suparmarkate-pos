import { RefreshCcw, UserRound, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

import type { CustomerOption } from "../types";

type PosCustomerCardProps = {
  value: string;
  searchTerm: string;
  customers: CustomerOption[];
  selectedCustomerId?: string | null;
  saleNote: string;
  isLoading: boolean;
  onChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  onSelectCustomer: (customer: CustomerOption) => void;
  onClearCustomer: () => void;
  onSaleNoteChange: (value: string) => void;
  onRefreshCustomers: () => void;
};

export function PosCustomerCard({
  value,
  searchTerm,
  customers,
  selectedCustomerId,
  saleNote,
  isLoading,
  onChange,
  onSearchChange,
  onSelectCustomer,
  onClearCustomer,
  onSaleNoteChange,
  onRefreshCustomers,
}: PosCustomerCardProps) {
  const customerLabel = value.trim();

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <UserRound className="h-5 w-5" />
              مشتری
            </CardTitle>
            <CardDescription>
              مشتری دستی یا انتخاب از لیست مشتریان سیستم
            </CardDescription>
          </div>

          <Badge variant={customerLabel ? "default" : "secondary"}>
            {customerLabel ? "مشتری مشخص" : "مشتری نقدی"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="نام یا شماره مشتری دستی..."
            className="h-11"
          />

          <Button
            type="button"
            variant="secondary"
            size="icon"
            disabled={!value}
            onClick={onClearCustomer}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex gap-2">
          <Input
            value={searchTerm}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="جستجوی مشتری از سیستم..."
            className="h-10"
          />

          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={onRefreshCustomers}
          >
            <RefreshCcw className="h-4 w-4" />
          </Button>
        </div>

        <ScrollArea className="max-h-[160px] rounded-xl border border-border">
          <div className="space-y-2 p-2">
            {isLoading ? (
              <div className="p-3 text-sm text-muted-foreground">
                در حال دریافت مشتریان...
              </div>
            ) : customers.length ? (
              customers.map((customer) => (
                <button
                  key={customer.id}
                  type="button"
                  onClick={() => onSelectCustomer(customer)}
                  className={
                    selectedCustomerId === customer.id
                      ? "w-full rounded-lg bg-primary/20 p-3 text-right text-sm"
                      : "w-full rounded-lg bg-secondary p-3 text-right text-sm hover:bg-secondary/80"
                  }
                >
                  <div className="font-bold">{customer.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {customer.phone || customer.email || "بدون شماره"}
                  </div>
                </button>
              ))
            ) : (
              <div className="p-3 text-center text-sm text-muted-foreground">
                مشتری پیدا نشد. می‌توانید دستی وارد کنید.
              </div>
            )}
          </div>
        </ScrollArea>

        <Input
          value={saleNote}
          onChange={(event) => onSaleNoteChange(event.target.value)}
          placeholder="یادداشت فروش، اختیاری..."
          className="h-10"
        />

        <div className="rounded-xl bg-secondary p-3 text-sm">
          <span className="text-muted-foreground">رسید برای: </span>
          <strong>{customerLabel || "مشتری نقدی"}</strong>
        </div>
      </CardContent>
    </Card>
  );
}
