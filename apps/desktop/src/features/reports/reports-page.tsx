import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  FileBarChart,
  Package,
  Printer,
  RefreshCcw,
  ShoppingBag,
  Timer,
  TrendingDown,
  TrendingUp,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DenseTable } from "@/features/admin/components/dense-table";
import { MetricCard } from "@/features/admin/components/metric-card";
import { money as formatMoney } from "@/features/admin/format";
import type { DataRow } from "@/features/admin/types";
import { API_BASE_URL } from "@/lib/api-config";
import { useBaseCurrencyCode } from "@/lib/use-base-currency";
import { CompanyPrintHeader, type PrintCompany } from "@/features/printing/company-print-header";

type EmployeePeriod = "day" | "week" | "month";

type DailyReportRow = {
  id: string;
  name: string;
  saleCount: number;
  totalSales: number;
  paidSales: number;
  remainingSales: number;
  moneyIn: number;
  moneyOut: number;
  cashIn: number;
  bankIn: number;
  netCashFlow: number;
};

type DailyCashierReport = {
  date: string;
  summary: {
    saleCount: number;
    transactionCount: number;
    totalSales: number;
    paidSales: number;
    remainingSales: number;
    moneyIn: number;
    moneyOut: number;
    netCashFlow: number;
  };
  byCashier: DailyReportRow[];
  byDevice: DailyReportRow[];
  recentTransactions: Array<Record<string, unknown>>;
};

type EmployeePerformanceRow = DailyReportRow & {
  employeeId?: string | null;
  userId?: string | null;
  position?: string | null;
  workedHours: number;
  overtimeHours: number;
  presentDays: number;
  halfDays: number;
  absentDays: number;
  lateDays: number;
  averageInvoice: number;
};

type EmployeePerformanceReport = {
  period: EmployeePeriod;
  date: string;
  summary: {
    employeeCount: number;
    saleCount: number;
    totalSales: number;
    moneyIn: number;
    moneyOut: number;
    workedHours: number;
  };
  rows: EmployeePerformanceRow[];
};

type ManagementReport = {
  summary: Record<string, number>;
  topProducts: Array<Record<string, unknown>>;
  receivables: Array<Record<string, unknown>>;
  payables: Array<Record<string, unknown>>;
  lowStock: Array<Record<string, unknown>>;
  expiringLots: Array<Record<string, unknown>>;
  recentSales: Array<Record<string, unknown>>;
  recentPurchases: Array<Record<string, unknown>>;
  incomeExpenses: Array<Record<string, unknown>>;
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function monthStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
}

function formatDate(value: unknown) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("fa-AF", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(String(value)));
}

function n(value: unknown) {
  return Number(value || 0);
}

function reportRowsToDataRows(
  rows: DailyReportRow[],
  money: (value: number | string) => string,
): DataRow[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    saleCount: row.saleCount,
    totalSales: money(row.totalSales),
    paidSales: money(row.paidSales),
    remainingSales: money(row.remainingSales),
    cashIn: money(row.cashIn),
    bankIn: money(row.bankIn),
    moneyOut: money(row.moneyOut),
    netCashFlow: money(row.netCashFlow),
  }));
}

export function ReportsPage() {
  const baseCurrencyCode = useBaseCurrencyCode();
  const money = (value: number | string) => formatMoney(value, baseCurrencyCode);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [employeePeriod, setEmployeePeriod] = useState<EmployeePeriod>("day");
  const [dailyReport, setDailyReport] = useState<DailyCashierReport | null>(null);
  const [managementReport, setManagementReport] = useState<ManagementReport | null>(null);
  const [employeeReport, setEmployeeReport] = useState<EmployeePerformanceReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [company, setCompany] = useState<PrintCompany | null>(null);

  const loadReports = async () => {
    setIsLoading(true);
    try {
      const [dailyRes, managementRes, employeeRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/reports/daily-cashier?date=${to}`),
        fetch(`${API_BASE_URL}/api/reports/management?from=${from}&to=${to}`),
        fetch(`${API_BASE_URL}/api/reports/employee-performance?period=${employeePeriod}&date=${to}`),
      ]);
      const [dailyJson, managementJson, employeeJson] = await Promise.all([
        dailyRes.json().catch(() => null),
        managementRes.json().catch(() => null),
        employeeRes.json().catch(() => null),
      ]);

      if (!dailyRes.ok) throw new Error(dailyJson?.message || "خواندن گزارش روزانه ناکام شد");
      if (!managementRes.ok) throw new Error(managementJson?.message || "خواندن گزارش مدیریتی ناکام شد");
      if (!employeeRes.ok) throw new Error(employeeJson?.message || "خواندن گزارش کارکرد کارمند ناکام شد");

      setDailyReport(dailyJson.data);
      setManagementReport(managementJson.data);
      setEmployeeReport(employeeJson.data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "خواندن گزارش ناکام شد");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadReports();
  }, [from, to, employeePeriod]);

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/settings/company`)
      .then((response) => response.json())
      .then((json) => setCompany(json.data || null))
      .catch(() => setCompany(null));
  }, []);

  const summary = managementReport?.summary || {};
  const employeeSummary = employeeReport?.summary;

  const topProductRows = useMemo<DataRow[]>(
    () =>
      (managementReport?.topProducts || []).map((item) => ({
        id: String(item.id),
        name: String(item.name || "-"),
        quantity: n(item.quantity),
        totalSales: money(n(item.totalSales)),
        cogs: money(n(item.cogs)),
        profit: money(n(item.profit)),
      })),
    [managementReport],
  );

  const receivableRows = useMemo<DataRow[]>(
    () =>
      (managementReport?.receivables || []).map((item) => ({
        id: String(item.id),
        name: String(item.name || "-"),
        currency: String(item.currency || "-"),
        amount: money(n(item.receivable)),
      })),
    [managementReport],
  );

  const payableRows = useMemo<DataRow[]>(
    () =>
      (managementReport?.payables || []).map((item) => ({
        id: String(item.id),
        name: String(item.name || "-"),
        currency: String(item.currency || "-"),
        amount: money(n(item.payable)),
      })),
    [managementReport],
  );

  const lowStockRows = useMemo<DataRow[]>(
    () =>
      (managementReport?.lowStock || []).map((item) => ({
        id: String(item.id),
        product: String(item.product || "-"),
        warehouse: String(item.warehouse || "-"),
        quantity: `${n(item.quantity)} ${item.unit || ""}`,
        minStock: n(item.minStock),
      })),
    [managementReport],
  );

  const expiringRows = useMemo<DataRow[]>(
    () =>
      (managementReport?.expiringLots || []).map((item) => ({
        id: String(item.id),
        product: String(item.product || "-"),
        warehouse: String(item.warehouse || "-"),
        expiryDate: formatDate(item.expiryDate),
        quantity: n(item.quantity),
      })),
    [managementReport],
  );

  const saleRows = useMemo<DataRow[]>(
    () =>
      (managementReport?.recentSales || []).map((item) => ({
        id: String(item.id),
        invoiceNo: String(item.invoiceNo || "-"),
        date: formatDate(item.date),
        customer: String(item.customer || "-"),
        cashier: String(item.cashier || "-"),
        total: money(n(item.total)),
        paid: money(n(item.paid)),
        remaining: money(n(item.remaining)),
      })),
    [managementReport],
  );

  const purchaseRows = useMemo<DataRow[]>(
    () =>
      (managementReport?.recentPurchases || []).map((item) => ({
        id: String(item.id),
        invoiceNo: String(item.invoiceNo || "-"),
        date: formatDate(item.date),
        supplier: String(item.supplier || "-"),
        total: money(n(item.total)),
        paid: money(n(item.paid)),
        remaining: money(n(item.remaining)),
      })),
    [managementReport],
  );

  const incomeExpenseRows = useMemo<DataRow[]>(
    () =>
      (managementReport?.incomeExpenses || []).map((item) => ({
        id: String(item.id),
        date: formatDate(item.date),
        type: item.type === "INCOME" ? "عواید" : "مصرف",
        category: String(item.category || "-"),
        account: String(item.account || "-"),
        user: String(item.user || "-"),
        amount: money(n(item.amount)),
        note: String(item.note || "-"),
      })),
    [managementReport],
  );

  const employeeRows = useMemo<DataRow[]>(
    () =>
      (employeeReport?.rows || []).map((row) => ({
        id: row.id,
        name: row.name,
        position: row.position || "-",
        saleCount: row.saleCount,
        totalSales: money(row.totalSales),
        paidSales: money(row.paidSales),
        remainingSales: money(row.remainingSales),
        moneyIn: money(row.moneyIn),
        moneyOut: money(row.moneyOut),
        netCashFlow: money(row.netCashFlow),
        averageInvoice: money(row.averageInvoice),
        presentDays: row.presentDays,
        halfDays: row.halfDays,
        absentDays: row.absentDays,
        lateDays: row.lateDays,
        workedHours: row.workedHours,
        overtimeHours: row.overtimeHours,
      })),
    [employeeReport],
  );

  return (
    <div className="app-print-page space-y-4">
      <CompanyPrintHeader company={company} title="گزارشات رسمی فروشگاه" />
      <Card className="border-border bg-card">
        <CardHeader className="gap-3 lg:grid lg:grid-cols-[1fr_auto]">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileBarChart className="size-5 text-primary" />
              گزارشات رسمی فروشگاه
            </CardTitle>
            <CardDescription>
              فروش، خرید، مفاد، طلب، بدهی، موجودی، عواید/مصارف و کارکرد کارمندان.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DatePicker value={from} onChange={setFrom} className="w-48" />
            <DatePicker value={to} onChange={setTo} className="w-48" />
            <Button variant="outline" onClick={() => void loadReports()} disabled={isLoading}>
              <RefreshCcw className="size-4" />
              تازه‌سازی
            </Button>
            <Button variant="outline" onClick={() => window.print()} disabled={isLoading}>
              <Printer className="size-4" />
              چاپ
            </Button>
          </div>
        </CardHeader>
      </Card>

      <section className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground">ارقام بازه انتخاب‌شده</p>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <MetricCard label="فروش خالص دوره" value={money(n(summary.netSales))} icon={<ShoppingBag />} />
          <MetricCard label="مفاد خالص دوره" value={money(n(summary.netProfit))} icon={<TrendingUp />} />
          <MetricCard label="مصارف دوره" value={money(n(summary.expenseTotal))} icon={<TrendingDown />} />
          <MetricCard label="خرید خالص دوره" value={money(n(summary.netPurchases))} icon={<Package />} />
          <MetricCard label="برگشت فروش دوره" value={money(n(summary.salesReturnTotal))} icon={<TrendingDown />} />
        </div>
      </section>

      <section className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground">وضعیت فعلی فروشگاه</p>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <MetricCard label="طلب فعلی مشتریان" value={money(n(summary.receivables))} icon={<WalletCards />} />
          <MetricCard label="بدهی فعلی فروشندگان" value={money(n(summary.payables))} icon={<WalletCards />} />
          <MetricCard label="هشدار فعلی موجودی" value={`${lowStockRows.length + expiringRows.length}`} icon={<AlertTriangle />} />
        </div>
      </section>

      <section className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground">خلاصه کارمندان در دوره انتخاب‌شده کارکرد</p>
        <div className="grid gap-4 md:grid-cols-2">
          <MetricCard label="کارمندان" value={`${employeeSummary?.employeeCount || 0}`} icon={<UsersRound />} />
          <MetricCard label="ساعت کاری" value={`${employeeSummary?.workedHours || 0}`} icon={<Timer />} />
        </div>
      </section>

      {isLoading ? (
        <Card className="border-border bg-card">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            در حال آماده‌سازی گزارش...
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="daily" className="space-y-4">
          <TabsList className="flex h-auto flex-wrap justify-start gap-2">
            <TabsTrigger value="daily">کارکرد روزانه فروشنده</TabsTrigger>
            <TabsTrigger value="employee">کارکرد کارمند</TabsTrigger>
            <TabsTrigger value="top">پرفروش‌ترین</TabsTrigger>
            <TabsTrigger value="receivables">طلب</TabsTrigger>
            <TabsTrigger value="payables">بدهی</TabsTrigger>
            <TabsTrigger value="lowStock">کمبود موجودی</TabsTrigger>
            <TabsTrigger value="expiring">انقضا</TabsTrigger>
            <TabsTrigger value="sales">فروشات اخیر</TabsTrigger>
            <TabsTrigger value="purchases">خریدهای اخیر</TabsTrigger>
            <TabsTrigger value="incomeExpense">عواید و مصارف</TabsTrigger>
          </TabsList>

          <TabsContent value="daily">
            <ReportTable
              title="کارکرد روزانه فروشنده‌ها"
              columns={[
                { key: "name", label: "فروشنده" },
                { key: "saleCount", label: "فاکتور" },
                { key: "totalSales", label: "فروش" },
                { key: "paidSales", label: "دریافت فروش" },
                { key: "remainingSales", label: "باقی" },
                { key: "cashIn", label: "نقد" },
                { key: "bankIn", label: "بانک" },
                { key: "moneyOut", label: "خروجی" },
                { key: "netCashFlow", label: "خالص" },
              ]}
              rows={reportRowsToDataRows(dailyReport?.byCashier || [], money)}
            />
          </TabsContent>

          <TabsContent value="employee" className="space-y-3">
            <Card className="border-border bg-card">
              <CardHeader className="gap-3 lg:flex lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <CardTitle className="text-base">خلاصه کارکرد کارمندان</CardTitle>
                  <CardDescription>
                    فروش، دریافت/پرداخت و حاضری هر کارمند در روز، هفته یا ماه انتخاب‌شده.
                  </CardDescription>
                </div>
                <div className="flex rounded-lg border border-border bg-muted/40 p-1">
                  {[
                    ["day", "روز"],
                    ["week", "هفته"],
                    ["month", "ماه"],
                  ].map(([value, label]) => (
                    <Button
                      key={value}
                      type="button"
                      size="sm"
                      variant={employeePeriod === value ? "default" : "ghost"}
                      onClick={() => setEmployeePeriod(value as EmployeePeriod)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </CardHeader>
              <CardContent>
                <DenseTable
                  columns={[
                    { key: "name", label: "کارمند" },
                    { key: "position", label: "وظیفه" },
                    { key: "saleCount", label: "فاکتور" },
                    { key: "totalSales", label: "فروش" },
                    { key: "paidSales", label: "دریافت فروش" },
                    { key: "remainingSales", label: "باقی" },
                    { key: "moneyIn", label: "ورودی پول" },
                    { key: "moneyOut", label: "خروجی پول" },
                    { key: "netCashFlow", label: "خالص" },
                    { key: "averageInvoice", label: "میانگین فاکتور" },
                    { key: "presentDays", label: "حاضر" },
                    { key: "halfDays", label: "نیم‌حاضر" },
                    { key: "absentDays", label: "غایب" },
                    { key: "lateDays", label: "دیرکرد" },
                    { key: "workedHours", label: "ساعت کاری" },
                    { key: "overtimeHours", label: "اضافه‌کاری" },
                  ]}
                  rows={employeeRows}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="top">
            <ReportTable
              title="پرفروش‌ترین اجناس"
              columns={[
                { key: "name", label: "جنس" },
                { key: "quantity", label: "مقدار" },
                { key: "totalSales", label: "فروش" },
                { key: "cogs", label: "قیمت تمام‌شده" },
                { key: "profit", label: "مفاد" },
              ]}
              rows={topProductRows}
            />
          </TabsContent>

          <TabsContent value="receivables">
            <ReportTable
              title="طلب مشتریان"
              columns={[
                { key: "name", label: "مشتری" },
                { key: "currency", label: "کرنسی" },
                { key: "amount", label: "طلب" },
              ]}
              rows={receivableRows}
            />
          </TabsContent>

          <TabsContent value="payables">
            <ReportTable
              title="بدهی فروشندگان"
              columns={[
                { key: "name", label: "فروشنده" },
                { key: "currency", label: "کرنسی" },
                { key: "amount", label: "بدهی" },
              ]}
              rows={payableRows}
            />
          </TabsContent>

          <TabsContent value="lowStock">
            <ReportTable
              title="کمبود موجودی"
              columns={[
                { key: "product", label: "جنس" },
                { key: "warehouse", label: "گدام" },
                { key: "quantity", label: "موجودی" },
                { key: "minStock", label: "حداقل" },
              ]}
              rows={lowStockRows}
            />
          </TabsContent>

          <TabsContent value="expiring">
            <ReportTable
              title="نزدیک انقضا"
              columns={[
                { key: "product", label: "جنس" },
                { key: "warehouse", label: "گدام" },
                { key: "expiryDate", label: "انقضا" },
                { key: "quantity", label: "مقدار" },
              ]}
              rows={expiringRows}
            />
          </TabsContent>

          <TabsContent value="sales">
            <ReportTable
              title="فروشات اخیر بازه"
              columns={[
                { key: "invoiceNo", label: "فاکتور" },
                { key: "date", label: "تاریخ" },
                { key: "customer", label: "مشتری" },
                { key: "cashier", label: "فروشنده" },
                { key: "total", label: "مجموع" },
                { key: "paid", label: "دریافت" },
                { key: "remaining", label: "باقی" },
              ]}
              rows={saleRows}
            />
          </TabsContent>

          <TabsContent value="purchases">
            <ReportTable
              title="خریدهای اخیر بازه"
              columns={[
                { key: "invoiceNo", label: "فاکتور" },
                { key: "date", label: "تاریخ" },
                { key: "supplier", label: "فروشنده" },
                { key: "total", label: "مجموع" },
                { key: "paid", label: "پرداخت" },
                { key: "remaining", label: "باقی" },
              ]}
              rows={purchaseRows}
            />
          </TabsContent>

          <TabsContent value="incomeExpense">
            <ReportTable
              title="عواید و مصارف بازه"
              columns={[
                { key: "date", label: "تاریخ" },
                { key: "type", label: "نوع" },
                { key: "category", label: "کتگوری" },
                { key: "account", label: "حساب" },
                { key: "user", label: "کاربر" },
                { key: "amount", label: "مبلغ" },
                { key: "note", label: "یادداشت" },
              ]}
              rows={incomeExpenseRows}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function ReportTable({
  title,
  columns,
  rows,
}: {
  title: string;
  columns: Array<{ key: string; label: string }>;
  rows: DataRow[];
}) {
  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <DenseTable columns={columns} rows={rows} />
      </CardContent>
    </Card>
  );
}
