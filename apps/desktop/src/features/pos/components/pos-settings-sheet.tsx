import { Banknote, Building2, Coins, Printer, Server, WarehouseIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

import type { BankAccount, CashRegister, Currency, Warehouse } from "../types";

type PosSettingsSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  apiBaseUrl: string;
  apiBaseUrlOverride: string;
  currencies: Currency[];
  warehouses: Warehouse[];
  cashRegisters: CashRegister[];
  bankAccounts: BankAccount[];
  currency: Currency | null;
  warehouse: Warehouse | null;
  cashAccountId: string;
  bankAccountId: string;
  receiptWidthMm: number;
  onApiBaseUrlOverrideChange: (value: string) => void;
  onCurrencyChange: (value: string) => void;
  onWarehouseChange: (value: string) => void;
  onCashAccountChange: (value: string) => void;
  onBankAccountChange: (value: string) => void;
  onReceiptWidthChange: (value: number) => void;
};

export function PosSettingsSheet({
  open,
  onOpenChange,
  apiBaseUrl,
  apiBaseUrlOverride,
  currencies,
  warehouses,
  cashRegisters,
  bankAccounts,
  currency,
  warehouse,
  cashAccountId,
  bankAccountId,
  receiptWidthMm,
  onApiBaseUrlOverrideChange,
  onCurrencyChange,
  onWarehouseChange,
  onCashAccountChange,
  onBankAccountChange,
  onReceiptWidthChange,
}: PosSettingsSheetProps) {
  const availableCashAccounts = cashRegisters.flatMap((register) =>
    register.accounts
      .filter((account) => !currency?.id || account.currencyId === currency.id)
      .map((account) => ({
        id: account.id,
        label: `${register.name} - ${currency?.code || account.currencyId}`,
        balance: account.balance,
      })),
  );
  const availableBankAccounts = bankAccounts
    .filter(
      (account) =>
        account.isActive !== false &&
        (!currency?.id || account.currencyId === currency.id),
    )
    .map((account) => ({
      id: account.id,
      label: `${account.name} - ${account.currency?.code || currency?.code || account.currencyId}`,
    }));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-[460px] overflow-y-auto sm:w-[540px]" dir="rtl">
        <SheetHeader>
          <SheetTitle>تنظیمات فعال صندوق</SheetTitle>
          <SheetDescription>
            اتصال، کرنسی، گدام، حساب‌های دریافت و اندازه چاپ رسید.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          <SettingSection icon={<Server />} title="اتصال سرور">
            <div className="space-y-2 text-sm">
              <label className="text-muted-foreground">API فعلی</label>
              <code className="block break-all border border-border bg-muted/30 p-3 text-left text-primary" dir="ltr">
                {apiBaseUrl || "-"}
              </code>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">API دستی، اختیاری</label>
              <Input
                value={apiBaseUrlOverride}
                onChange={(event) => onApiBaseUrlOverrideChange(event.target.value)}
                placeholder="مثال: http://192.168.0.253:4000"
                dir="ltr"
              />
              <p className="text-xs leading-6 text-muted-foreground">
                اگر خالی باشد، برنامه خودش IP سیستم را پیدا می‌کند. بعد از تغییر، از منوی فاکتور جاری «ساخت جلسه اتصال جدید» را بزنید.
              </p>
            </div>
          </SettingSection>

          <SettingSection icon={<Coins />} title="کرنسی و گدام">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="کرنسی فروش">
                <Combobox
                  value={currency?.id || ""}
                  placeholder="کرنسی را انتخاب کنید"
                  onValueChange={onCurrencyChange}
                  options={currencies.map((item) => ({
                    value: item.id,
                    label: item.code,
                    description: item.symbol || item.name,
                  }))}
                />
              </Field>
              <Field label="گدام فعال">
                <Combobox
                  value={warehouse?.id || ""}
                  placeholder="گدام را انتخاب کنید"
                  onValueChange={onWarehouseChange}
                  options={warehouses.map((item) => ({
                    value: item.id,
                    label: item.name,
                    meta: item.isDefault ? "پیش‌فرض" : null,
                  }))}
                />
              </Field>
            </div>
          </SettingSection>

          <SettingSection icon={<Banknote />} title="حساب‌های دریافت">
            <Field label="حساب صندوق / دخل">
              <Combobox
                value={cashAccountId || ""}
                placeholder="حساب صندوق را انتخاب کنید"
                onValueChange={onCashAccountChange}
                options={availableCashAccounts.map((account) => ({
                  value: account.id,
                  label: account.label,
                  meta: new Intl.NumberFormat("en-US").format(account.balance || 0),
                }))}
              />
              {!availableCashAccounts.length ? (
                <p className="text-sm text-destructive">
                  برای این کرنسی حساب صندوق نقدی پیدا نشد.
                </p>
              ) : null}
            </Field>

            <Field label="حساب کارت بانکی">
              <Combobox
                value={bankAccountId || ""}
                placeholder="حساب بانکی را انتخاب کنید"
                onValueChange={onBankAccountChange}
                options={availableBankAccounts.map((account) => ({
                  value: account.id,
                  label: account.label,
                }))}
              />
              {!availableBankAccounts.length ? (
                <p className="text-sm text-destructive">
                  برای این کرنسی حساب بانکی فعال پیدا نشد.
                </p>
              ) : null}
            </Field>
          </SettingSection>

          <SettingSection icon={<Printer />} title="چاپ رسید">
            <div className="flex items-center justify-between border border-border bg-muted/20 p-3">
              <span className="text-muted-foreground">اندازه رسید</span>
              <strong>{receiptWidthMm}mm</strong>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={receiptWidthMm === 80 ? "default" : "outline"}
                onClick={() => onReceiptWidthChange(80)}
              >
                80mm
              </Button>
              <Button
                type="button"
                variant={receiptWidthMm === 58 ? "default" : "outline"}
                onClick={() => onReceiptWidthChange(58)}
              >
                58mm
              </Button>
            </div>
          </SettingSection>

          <div className="grid gap-3 sm:grid-cols-2">
            <InfoTile icon={<Building2 />} label="Cart Sync" value="Server-side" />
            <InfoTile icon={<WarehouseIcon />} label="گدام فعال" value={warehouse?.name || "-"} />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SettingSection({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <span className="grid size-9 place-items-center border border-primary/25 bg-primary/10 text-primary [&_svg]:size-4">
          {icon}
        </span>
        <h3 className="font-medium">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <label className="text-sm text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function InfoTile({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border border-border bg-muted/20 p-3 text-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="[&_svg]:size-4">{icon}</span>
        {label}
      </div>
      <strong>{value}</strong>
    </div>
  );
}

