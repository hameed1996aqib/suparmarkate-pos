import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  Boxes,
  CircleDollarSign,
  CreditCard,
  Package,
  RefreshCcw,
  ShoppingBag,
  Truck,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MetricCard } from "@/features/admin/components/metric-card";
import { getDashboardCurrencies, getDashboardSummary } from "./api";
import {
  CashierSalesChart,
  CategorySalesChart,
  SalesPurchasesChart,
} from "./dashboard-charts";
import type {
  DashboardCurrency,
  DashboardPeriod,
  DashboardSummary,
} from "./types";

const ALL_CURRENCIES = "__all__";

const periods: Array<{ key: DashboardPeriod; label: string }> = [
  { key: "today", label: "امروز" },
  { key: "week", label: "این هفته" },
  { key: "month", label: "این ماه" },
  { key: "fourMonths", label: "چهار ماه اخیر" },
];

const formatNumber = new Intl.NumberFormat("fa-AF", {
  maximumFractionDigits: 0,
});

export function DashboardPage() {
  const [period, setPeriod] = useState<DashboardPeriod>("today");
  const [currencyId, setCurrencyId] = useState(ALL_CURRENCIES);
  const [currencies, setCurrencies] = useState<DashboardCurrency[]>([]);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const currencyOptions = useMemo(
    () => [
      {
        value: ALL_CURRENCIES,
        label: "همه ارزها",
        description: "نمایش مجموع بر اساس کرنسی پایه",
      },
      ...currencies
        .filter((currency) => currency.isActive !== false)
        .map((currency) => ({
          value: currency.id,
          label: `${currency.code} - ${currency.name}`,
          description: currency.isBase ? "کرنسی پایه" : "فیلتر معاملات همین ارز",
          meta: currency.symbol || currency.code,
        })),
    ],
    [currencies],
  );

  const selectedCurrency = currencies.find((item) => item.id === currencyId);
  const baseCode = summary?.currency?.displayCode || "AFN";
  const filterLabel =
    currencyId === ALL_CURRENCIES
      ? `همه ارزها، معادل ${baseCode}`
      : `${selectedCurrency?.code || summary?.currency?.filterCode || ""}، معادل ${baseCode}`;
  const money = (value: number) => `${formatNumber.format(value || 0)} ${baseCode}`;

  async function loadCurrencies() {
    try {
      setCurrencies(await getDashboardCurrencies());
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "خواندن کرنسی‌ها ناکام شد",
      );
    }
  }

  async function load() {
    setLoading(true);
    try {
      setSummary(
        await getDashboardSummary(
          period,
          currencyId === ALL_CURRENCIES ? undefined : currencyId,
        ),
      );
    } catch (error) {
      setSummary(null);
      toast.error(
        error instanceof Error ? error.message : "خواندن داشبورد ناکام شد",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCurrencies();
  }, []);

  useEffect(() => {
    void load();
  }, [period, currencyId]);

  if (!summary && loading) {
    return (
      <div className="py-20 text-center text-sm text-muted-foreground">
        در حال محاسبه داشبورد...
      </div>
    );
  }

  if (!summary) {
    return (
      <Card className="border-destructive/40 bg-card">
        <CardContent className="flex items-center justify-between gap-4 p-5">
          <span>داده‌های داشبورد از سرور خوانده نشد.</span>
          <Button className="gap-2" onClick={() => void load()}>
            <RefreshCcw className="size-4" />
            تلاش دوباره
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { overview, documents, inventory, cashFlow } = summary;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-semibold">
            داشبورد مدیریتی
          </h1>
          <p className="text-sm text-muted-foreground">
            خلاصه زنده فروشگاه بر اساس معاملات ثبت‌شده
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Combobox
            className="w-56"
            value={currencyId}
            options={currencyOptions}
            onValueChange={setCurrencyId}
            placeholder="فیلتر ارز"
            searchPlaceholder="جستجوی ارز..."
            emptyText="ارزی پیدا نشد"
          />
          <Tabs
            value={period}
            onValueChange={(value) => setPeriod(value as DashboardPeriod)}
          >
            <TabsList>
              {periods.map((item) => (
                <TabsTrigger key={item.key} value={item.key}>
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Button
            size="icon"
            variant="outline"
            onClick={() => void load()}
            title="تازه‌سازی"
          >
            <RefreshCcw className={loading ? "size-4 animate-spin" : "size-4"} />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border border-border bg-muted/20 px-3 py-2 text-sm">
        <span className="text-muted-foreground">فیلتر ارز داشبورد</span>
        <Badge variant="outline">{filterLabel}</Badge>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          title="فروش دوره"
          value={money(overview.sales)}
          trend={`${documents.sales} فاکتور`}
          icon={<ShoppingBag />}
        />
        <MetricCard
          title="خرید دوره"
          value={money(overview.purchases)}
          trend={`${documents.purchases} فاکتور`}
          icon={<Truck />}
        />
        <MetricCard
          title="مفاد خالص دوره"
          value={money(overview.netProfit)}
          trend={`عواید ${money(overview.income)}`}
          icon={<CircleDollarSign />}
        />
        <MetricCard
          title="موجودی فعلی گدام"
          value={money(overview.inventoryValue)}
          trend={`${inventory.products} جنس فعال`}
          icon={<Boxes />}
        />
        <MetricCard
          title="مانده فعلی صندوق و بانک"
          value={money(overview.treasury)}
          trend={`جریان خالص ${money(cashFlow.net)}`}
          icon={<WalletCards />}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="طلب فعلی مشتریان"
          value={money(overview.receivables)}
          trend={`${summary.parties.customers} مشتری`}
          icon={<UsersRound />}
        />
        <MetricCard
          title="بدهی فعلی فروشندگان"
          value={money(overview.payables)}
          trend={`${summary.parties.suppliers} فروشنده`}
          icon={<CreditCard />}
        />
        <MetricCard
          title="مصارف دوره"
          value={money(overview.expenses)}
          trend={`ضایعات ${money(overview.wasteValue)}`}
          icon={<Banknote />}
        />
        <MetricCard
          title="فاکتورهای باقی‌دار فعلی"
          value={formatNumber.format(
            documents.pendingSales + documents.pendingPurchases,
          )}
          trend={`${documents.pendingSales} فروش / ${documents.pendingPurchases} خرید`}
          icon={<AlertTriangle />}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <SalesPurchasesChart
          rows={summary.salesPurchasesTrend}
          currencyCode={baseCode}
        />
        <CashierSalesChart
          rows={summary.salesByCashier}
          currencyCode={baseCode}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1.1fr]">
        <CategorySalesChart
          rows={summary.salesByCategory}
          currencyCode={baseCode}
        />
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle>اجناس پرفروش</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {summary.topProducts.length ? (
              summary.topProducts.map((item, index) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between border-b border-border py-2 last:border-0"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Badge variant="outline">{index + 1}</Badge>
                    <Package className="size-4 shrink-0 text-primary" />
                    <span className="truncate">{item.name}</span>
                  </div>
                  <div className="text-end">
                    <strong className="block">{money(item.sales)}</strong>
                    <span className="text-xs text-muted-foreground">
                      {formatNumber.format(item.quantity)} واحد
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <p className="py-8 text-center text-muted-foreground">
                فروشی ثبت نشده است
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[.9fr_1.1fr]">
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle>هشدارهای عملیاتی</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {[
              ["ناموجودی", inventory.outOfStock, "destructive"],
              ["کمبود موجودی", inventory.lowStock, "destructive"],
              ["نزدیک انقضا", inventory.expiringSoon, "secondary"],
              ["تاریخ‌گذشته", inventory.expired, "destructive"],
              ["موجودی خیلی زیاد", inventory.highStock, "outline"],
              ["ضایعات", money(overview.wasteValue), "outline"],
            ].map(([label, value, variant]) => (
              <div
                key={String(label)}
                className="flex items-center justify-between border border-border bg-muted/20 p-3"
              >
                <span>{label}</span>
                <Badge
                  variant={variant as "destructive" | "secondary" | "outline"}
                >
                  {value}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle>فعالیت‌های اخیر</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {summary.recentActivities.length ? (
              summary.recentActivities.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 border-b border-border py-2 last:border-0"
                >
                  <div>
                    <p className="font-medium">{item.action}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.entityType || "سیستم"}
                    </p>
                  </div>
                  <div className="text-end text-xs text-muted-foreground">
                    <p>{item.user}</p>
                    <p>{new Date(item.createdAt).toLocaleString("fa-AF")}</p>
                  </div>
                </div>
              ))
            ) : (
              <p className="py-8 text-center text-muted-foreground">
                فعالیتی ثبت نشده است
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
