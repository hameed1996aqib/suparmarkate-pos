import { useEffect, useMemo, useRef, useState } from "react";
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

type ReportActivityKind = "sales" | "purchases" | "income-expenses";

type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

type ActivityPages = Record<ReportActivityKind, number>;

const firstActivityPages: ActivityPages = {
  sales: 1,
  purchases: 1,
  "income-expenses": 1,
};

type DailyReportRow = {
  id: string;
  name: string;
  saleCount: number;
  totalSales: number;
  paidSales: number;
  remainingSales: number;
  discountTotal: number;
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
    discountTotal: number;
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
  period: "range" | "day" | "week" | "month";
  date: string;
  summary: {
    employeeCount: number;
    saleCount: number;
    totalSales: number;
    discountTotal: number;
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

type CurrencyUsageReport = {
  rows: Array<Record<string, unknown>>;
  totalsByCurrency: Array<Record<string, unknown>>;
};

type LossSalesReport = {
  summary: Record<string, number>;
  categories: Array<Record<string, unknown>>;
  products: Array<Record<string, unknown>>;
};

type MissingCostSalesReport = {
  summary: Record<string, number>;
  products: Array<Record<string, unknown>>;
  items: Array<Record<string, unknown>>;
};

function kabulDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kabul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function today() {
  return kabulDateString();
}

function monthStart() {
  return `${today().slice(0, 8)}01`;
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

function currencyUsageTypeLabel(value: unknown) {
  const labels: Record<string, string> = {
    SALE: "فروش",
    PURCHASE: "خرید",
    SALE_RETURN: "برگشت فروش",
    PURCHASE_RETURN: "برگشت خرید",
    MONEY_IN_RECEIPT: "دریافت",
    MONEY_OUT_PAYMENT: "پرداخت",
    MONEY_IN_INCOME: "عواید",
    MONEY_OUT_EXPENSE: "مصارف",
    MONEY_IN_TRANSFER: "انتقال ورودی",
    MONEY_OUT_TRANSFER: "انتقال خروجی",
  };
  return labels[String(value)] || String(value || "-");
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
    discountTotal: money(row.discountTotal),
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
  const [dailyReport, setDailyReport] = useState<DailyCashierReport | null>(null);
  const [managementReport, setManagementReport] = useState<ManagementReport | null>(null);
  const [employeeReport, setEmployeeReport] = useState<EmployeePerformanceReport | null>(null);
  const [currencyUsageReport, setCurrencyUsageReport] = useState<CurrencyUsageReport | null>(null);
  const [lossSalesReport, setLossSalesReport] = useState<LossSalesReport | null>(null);
  const [missingCostReport, setMissingCostReport] = useState<MissingCostSalesReport | null>(null);
  const [activityRows, setActivityRows] = useState<
    Record<ReportActivityKind, Array<Record<string, unknown>>>
  >({ sales: [], purchases: [], "income-expenses": [] });
  const [activityPages, setActivityPages] =
    useState<ActivityPages>(firstActivityPages);
  const [activityPagination, setActivityPagination] = useState<
    Partial<Record<ReportActivityKind, PaginationMeta>>
  >({});
  const [selectedLossCategoryId, setSelectedLossCategoryId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [company, setCompany] = useState<PrintCompany | null>(null);
  const reportsRequestSeqRef = useRef(0);
  const activityRequestSeqRef = useRef<Record<ReportActivityKind, number>>({
    sales: 0,
    purchases: 0,
    "income-expenses": 0,
  });
  const activeRangeRef = useRef(`${from}:${to}`);
  activeRangeRef.current = `${from}:${to}`;

  const activityUrl = (kind: ReportActivityKind, page: number) => {
    const params = new URLSearchParams({
      from,
      to,
      kind,
      page: String(page),
      limit: "20",
    });
    return `${API_BASE_URL}/api/reports/activity?${params.toString()}`;
  };

  const loadReports = async (pages: ActivityPages = activityPages) => {
    if (!from || !to) {
      setIsLoading(false);
      toast.warning("تاریخ از و تا را انتخاب کنید");
      return;
    }
    if (from > to) {
      setIsLoading(false);
      toast.warning("تاریخ از نمی‌تواند بعد از تاریخ تا باشد");
      return;
    }

    const requestSeq = reportsRequestSeqRef.current + 1;
    reportsRequestSeqRef.current = requestSeq;
    activityRequestSeqRef.current.sales += 1;
    activityRequestSeqRef.current.purchases += 1;
    activityRequestSeqRef.current["income-expenses"] += 1;
    setIsLoading(true);
    try {
      const rangeQuery = new URLSearchParams({ from, to }).toString();
      const [
        dailyRes,
        managementRes,
        employeeRes,
        currencyUsageRes,
        lossSalesRes,
        missingCostRes,
        salesRes,
        purchasesRes,
        incomeExpensesRes,
      ] = await Promise.all([
        fetch(`${API_BASE_URL}/api/reports/daily-cashier?${rangeQuery}`),
        fetch(`${API_BASE_URL}/api/reports/management?${rangeQuery}`),
        fetch(`${API_BASE_URL}/api/reports/employee-performance?${rangeQuery}`),
        fetch(`${API_BASE_URL}/api/reports/currency-usage?${rangeQuery}`),
        fetch(`${API_BASE_URL}/api/reports/loss-sales?${rangeQuery}`),
        fetch(`${API_BASE_URL}/api/reports/missing-cost-sales?${rangeQuery}`),
        fetch(activityUrl("sales", pages.sales)),
        fetch(activityUrl("purchases", pages.purchases)),
        fetch(activityUrl("income-expenses", pages["income-expenses"])),
      ]);
      const [
        dailyJson,
        managementJson,
        employeeJson,
        currencyUsageJson,
        lossSalesJson,
        missingCostJson,
        salesJson,
        purchasesJson,
        incomeExpensesJson,
      ] = await Promise.all([
        dailyRes.json().catch(() => null),
        managementRes.json().catch(() => null),
        employeeRes.json().catch(() => null),
        currencyUsageRes.json().catch(() => null),
        lossSalesRes.json().catch(() => null),
        missingCostRes.json().catch(() => null),
        salesRes.json().catch(() => null),
        purchasesRes.json().catch(() => null),
        incomeExpensesRes.json().catch(() => null),
      ]);

      if (!dailyRes.ok) throw new Error(dailyJson?.message || "خواندن گزارش روزانه ناکام شد");
      if (!managementRes.ok) throw new Error(managementJson?.message || "خواندن گزارش مدیریتی ناکام شد");
      if (!employeeRes.ok) throw new Error(employeeJson?.message || "خواندن گزارش کارکرد کارمند ناکام شد");

      if (!currencyUsageRes.ok) throw new Error(currencyUsageJson?.message || "خواندن گزارش نرخ ارز ناکام شد");
      if (!lossSalesRes.ok) throw new Error(lossSalesJson?.message || "خواندن گزارش فروش زیر قیمت تمام‌شده ناکام شد");
      if (!missingCostRes.ok) throw new Error(missingCostJson?.message || "خواندن گزارش کیفیت مفاد ناکام شد");
      if (!salesRes.ok) throw new Error(salesJson?.message || "خواندن جدول فروشات ناکام شد");
      if (!purchasesRes.ok) throw new Error(purchasesJson?.message || "خواندن جدول خریدها ناکام شد");
      if (!incomeExpensesRes.ok) throw new Error(incomeExpensesJson?.message || "خواندن جدول عواید و مصارف ناکام شد");

      if (requestSeq !== reportsRequestSeqRef.current) return;

      setDailyReport(dailyJson.data);
      setManagementReport(managementJson.data);
      setEmployeeReport(employeeJson.data);
      setCurrencyUsageReport(currencyUsageJson.data);
      setLossSalesReport(lossSalesJson.data);
      setMissingCostReport(missingCostJson.data);
      setActivityRows({
        sales: Array.isArray(salesJson?.data) ? salesJson.data : [],
        purchases: Array.isArray(purchasesJson?.data) ? purchasesJson.data : [],
        "income-expenses": Array.isArray(incomeExpensesJson?.data)
          ? incomeExpensesJson.data
          : [],
      });
      setActivityPagination({
        sales: salesJson?.pagination,
        purchases: purchasesJson?.pagination,
        "income-expenses": incomeExpensesJson?.pagination,
      });
    } catch (error) {
      if (requestSeq !== reportsRequestSeqRef.current) return;
      toast.error(error instanceof Error ? error.message : "خواندن گزارش ناکام شد");
    } finally {
      if (requestSeq === reportsRequestSeqRef.current) {
        setIsLoading(false);
      }
    }
  };

  const loadActivityPage = async (kind: ReportActivityKind, page: number) => {
    const rangeKey = `${from}:${to}`;
    const requestSeq = activityRequestSeqRef.current[kind] + 1;
    activityRequestSeqRef.current[kind] = requestSeq;
    try {
      const response = await fetch(activityUrl(kind, page));
      const json = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(json?.message || "خواندن صفحه گزارش ناکام شد");
      }
      if (
        requestSeq !== activityRequestSeqRef.current[kind] ||
        rangeKey !== activeRangeRef.current
      ) {
        return;
      }

      setActivityRows((current) => ({
        ...current,
        [kind]: Array.isArray(json?.data) ? json.data : [],
      }));
      setActivityPagination((current) => ({
        ...current,
        [kind]: json?.pagination,
      }));
      setActivityPages((current) => ({ ...current, [kind]: page }));
    } catch (error) {
      if (
        requestSeq !== activityRequestSeqRef.current[kind] ||
        rangeKey !== activeRangeRef.current
      ) {
        return;
      }
      toast.error(
        error instanceof Error ? error.message : "خواندن صفحه گزارش ناکام شد",
      );
    }
  };

  useEffect(() => {
    setActivityPages(firstActivityPages);
    void loadReports(firstActivityPages);
  }, [from, to]);

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/settings/company`)
      .then((response) => response.json())
      .then((json) => setCompany(json.data || null))
      .catch(() => setCompany(null));
  }, []);

  const summary = managementReport?.summary || {};
  const employeeSummary = employeeReport?.summary;
  const lossSummary = lossSalesReport?.summary || {};
  const missingCostSummary = missingCostReport?.summary || {};

  useEffect(() => {
    const categories = lossSalesReport?.categories || [];
    if (!categories.length) {
      setSelectedLossCategoryId("");
      return;
    }

    if (!categories.some((item) => String(item.categoryId) === selectedLossCategoryId)) {
      setSelectedLossCategoryId(String(categories[0]?.categoryId || ""));
    }
  }, [lossSalesReport, selectedLossCategoryId]);

  const currencyUsageTotalRows = useMemo<DataRow[]>(
    () =>
      (currencyUsageReport?.totalsByCurrency || []).map((item) => {
        const code = String(item.currencyCode || "-");
        return {
          id: String(item.currencyId || code),
          currency: code,
          documentCount: n(item.documentCount),
          originalAmount: formatMoney(n(item.originalAmount), code),
          baseAmount: money(n(item.baseAmount)),
        };
      }),
    [currencyUsageReport, money],
  );

  const currencyUsageRows = useMemo<DataRow[]>(
    () =>
      (currencyUsageReport?.rows || []).map((item, index) => {
        const code = String(item.currencyCode || "-");
        const rate = n(item.exchangeRate);
        return {
          id: `${item.currencyId || code}-${item.documentType || index}-${rate}`,
          documentType: currencyUsageTypeLabel(item.documentType),
          currency: code,
          exchangeRate: rate.toLocaleString("fa-AF", { maximumFractionDigits: 8 }),
          documentCount: n(item.documentCount),
          originalAmount: formatMoney(n(item.originalAmount), code),
          baseAmount: money(n(item.baseAmount)),
          firstAt: formatDate(item.firstAt),
          lastAt: formatDate(item.lastAt),
        };
      }),
    [currencyUsageReport, money],
  );

  const lossCategoryRows = useMemo<DataRow[]>(
    () =>
      (lossSalesReport?.categories || []).map((item) => ({
        id: String(item.categoryId || "uncategorized"),
        categoryName: String(item.categoryName || "بدون کتگوری"),
        productCount: n(item.productCount),
        invoiceCount: n(item.invoiceCount),
        lineCount: n(item.lineCount),
        quantityBase: n(item.quantityBase),
        salesBase: money(n(item.salesBase)),
        costBase: money(n(item.costBase)),
        lossBase: money(n(item.lossBase)),
      })),
    [lossSalesReport, money],
  );

  const selectedLossCategory = useMemo(
    () =>
      (lossSalesReport?.categories || []).find(
        (item) => String(item.categoryId) === selectedLossCategoryId,
      ),
    [lossSalesReport, selectedLossCategoryId],
  );

  const lossProductRows = useMemo<DataRow[]>(
    () =>
      (lossSalesReport?.products || [])
        .filter((item) => String(item.categoryId || "uncategorized") === selectedLossCategoryId)
        .map((item) => ({
          id: String(item.productId),
          productName: String(item.productName || "-"),
          barcode: String(item.barcode || "-"),
          invoiceCount: n(item.invoiceCount),
          lineCount: n(item.lineCount),
          quantityBase: `${n(item.quantityBase)} ${String(item.unitName || "").trim()}`.trim(),
          salesBase: money(n(item.salesBase)),
          costBase: money(n(item.costBase)),
          lossBase: money(n(item.lossBase)),
        })),
    [lossSalesReport, selectedLossCategoryId, money],
  );

  const missingCostProductRows = useMemo<DataRow[]>(
    () =>
      (missingCostReport?.products || []).map((item) => ({
        id: String(item.productId),
        productName: String(item.productName || "-"),
        barcode: String(item.barcode || "-"),
        categoryName: String(item.categoryName || "-"),
        invoiceCount: n(item.invoiceCount),
        lineCount: n(item.lineCount),
        quantityBase: `${n(item.quantityBase)} ${String(item.unitName || "").trim()}`.trim(),
        salesBase: money(n(item.salesBase)),
      })),
    [missingCostReport, money],
  );

  const missingCostItemRows = useMemo<DataRow[]>(
    () =>
      (missingCostReport?.items || []).map((item) => ({
        id: String(item.saleItemId),
        invoiceNo: String(item.invoiceNo || "-"),
        saleDate: formatDate(item.saleDate),
        cashierName: String(item.cashierName || "-"),
        productName: String(item.productName || "-"),
        barcode: String(item.barcode || "-"),
        categoryName: String(item.categoryName || "-"),
        quantityBase: `${n(item.quantityBase)} ${String(item.unitName || "").trim()}`.trim(),
        salesBase: money(n(item.salesBase)),
        status: "قیمت تمام‌شده ثبت نشده",
      })),
    [missingCostReport, money],
  );

  const topProductRows = useMemo<DataRow[]>(
    () =>
      (managementReport?.topProducts || []).map((item) => ({
        id: String(item.id),
        name: String(item.name || "-"),
        quantity: `${n(item.quantity)} ${String(item.unit || "").trim()}`.trim(),
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
      activityRows.sales.map((item) => ({
        id: String(item.id),
        invoiceNo: String(item.invoiceNo || "-"),
        date: formatDate(item.date),
        customer: String(item.customer || "-"),
        cashier: String(item.cashier || "-"),
        total: money(n(item.total)),
        paid: money(n(item.paid)),
        remaining: money(n(item.remaining)),
      })),
    [activityRows.sales],
  );

  const purchaseRows = useMemo<DataRow[]>(
    () =>
      activityRows.purchases.map((item) => ({
        id: String(item.id),
        invoiceNo: String(item.invoiceNo || "-"),
        date: formatDate(item.date),
        supplier: String(item.supplier || "-"),
        total: money(n(item.total)),
        paid: money(n(item.paid)),
        remaining: money(n(item.remaining)),
      })),
    [activityRows.purchases],
  );

  const incomeExpenseRows = useMemo<DataRow[]>(
    () =>
      activityRows["income-expenses"].map((item) => ({
        id: String(item.id),
        date: formatDate(item.date),
        type: item.type === "INCOME" ? "عواید" : "مصرف",
        category: String(item.category || "-"),
        account: String(item.account || "-"),
        user: String(item.user || "-"),
        amount: money(n(item.amount)),
        note: String(item.note || "-"),
      })),
    [activityRows],
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
        discountTotal: money(row.discountTotal),
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
            <div className="grid gap-1">
              <span className="text-xs text-muted-foreground">از تاریخ</span>
              <DatePicker
                value={from}
                onChange={(value) => {
                  setFrom(value);
                  if (value && to && value > to) setTo(value);
                }}
                className="w-48"
              />
            </div>
            <div className="grid gap-1">
              <span className="text-xs text-muted-foreground">تا تاریخ</span>
              <DatePicker
                value={to}
                onChange={(value) => {
                  setTo(value);
                  if (value && from && value < from) setFrom(value);
                }}
                className="w-48"
              />
            </div>
            <Button
              variant="outline"
              onClick={() => void loadReports(activityPages)}
              disabled={isLoading || !from || !to || from > to}
            >
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
          <MetricCard label="فروش بدون قیمت تمام‌شده" value={`${n(missingCostSummary.lineCount)}`} icon={<AlertTriangle />} />
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
            <TabsTrigger value="daily">کارکرد فروشنده‌ها</TabsTrigger>
            <TabsTrigger value="employee">کارکرد کارمند</TabsTrigger>
            <TabsTrigger value="top">پرفروش‌ترین</TabsTrigger>
            <TabsTrigger value="lossSales">فروش زیر قیمت</TabsTrigger>
            <TabsTrigger value="missingCost">کیفیت مفاد</TabsTrigger>
            <TabsTrigger value="receivables">طلب</TabsTrigger>
            <TabsTrigger value="payables">بدهی</TabsTrigger>
            <TabsTrigger value="lowStock">کمبود موجودی</TabsTrigger>
            <TabsTrigger value="expiring">انقضا</TabsTrigger>
            <TabsTrigger value="sales">فروشات بازه</TabsTrigger>
            <TabsTrigger value="purchases">خریدهای بازه</TabsTrigger>
            <TabsTrigger value="incomeExpense">عواید و مصارف</TabsTrigger>
            <TabsTrigger value="currencyUsage">نرخ معاملات</TabsTrigger>
          </TabsList>

          <TabsContent value="daily">
            <ReportTable
              title="کارکرد فروشنده‌ها در بازه انتخاب‌شده"
              columns={[
                { key: "name", label: "فروشنده" },
                { key: "saleCount", label: "فاکتور" },
                { key: "totalSales", label: "فروش" },
                { key: "discountTotal", label: "تخفیف" },
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
                    فروش، دریافت/پرداخت و حاضری هر کارمند در بازه از تاریخ تا تاریخ انتخاب‌شده.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <DenseTable
                  columns={[
                    { key: "name", label: "کارمند" },
                    { key: "position", label: "وظیفه" },
                    { key: "saleCount", label: "فاکتور" },
                    { key: "totalSales", label: "فروش" },
                    { key: "discountTotal", label: "تخفیف" },
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

          <TabsContent value="lossSales" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="کتگوری‌های دارای ضرر"
                value={`${n(lossSummary.categoryCount)}`}
                icon={<AlertTriangle />}
              />
              <MetricCard
                label="اجناس زیر قیمت"
                value={`${n(lossSummary.productCount)}`}
                icon={<Package />}
              />
              <MetricCard
                label="فروش این اجناس"
                value={money(n(lossSummary.salesBase))}
                icon={<ShoppingBag />}
              />
              <MetricCard
                label="ضرر مجموعی"
                value={money(n(lossSummary.lossBase))}
                icon={<TrendingDown />}
              />
            </div>
            <ReportTable
              title="کتگوری‌هایی که در آن جنس زیر قیمت تمام‌شده فروش شده"
              columns={[
                { key: "categoryName", label: "کتگوری" },
                { key: "productCount", label: "تعداد جنس" },
                { key: "invoiceCount", label: "تعداد فاکتور" },
                { key: "lineCount", label: "تعداد فروش" },
                { key: "quantityBase", label: "مقدار مجموعی" },
                { key: "salesBase", label: "مجموع فروش" },
                { key: "costBase", label: "مجموع تمام‌شده" },
                { key: "lossBase", label: "مجموع ضرر" },
              ]}
              rows={lossCategoryRows}
              onEdit={(row) => setSelectedLossCategoryId(String(row.id || ""))}
              editLabel="دیدن اجناس"
            />
            <ReportTable
              title={`اجناس زیر قیمت در ${String(selectedLossCategory?.categoryName || "کتگوری انتخاب‌شده")}`}
              columns={[
                { key: "productName", label: "جنس" },
                { key: "barcode", label: "بارکود" },
                { key: "invoiceCount", label: "تعداد فاکتور" },
                { key: "lineCount", label: "تعداد فروش" },
                { key: "quantityBase", label: "مقدار فروش‌شده" },
                { key: "salesBase", label: "مجموع فروش" },
                { key: "costBase", label: "مجموع تمام‌شده" },
                { key: "lossBase", label: "ضرر" },
              ]}
              rows={lossProductRows}
            />
          </TabsContent>

          <TabsContent value="missingCost" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="فاکتورهای مشکوک"
                value={`${n(missingCostSummary.invoiceCount)}`}
                icon={<AlertTriangle />}
              />
              <MetricCard
                label="خطوط بدون قیمت تمام‌شده"
                value={`${n(missingCostSummary.lineCount)}`}
                icon={<FileBarChart />}
              />
              <MetricCard
                label="اجناس متاثر"
                value={`${n(missingCostSummary.productCount)}`}
                icon={<Package />}
              />
              <MetricCard
                label="فروش متاثر"
                value={money(n(missingCostSummary.salesBase))}
                icon={<ShoppingBag />}
              />
            </div>
            <Card className="border-destructive/30 bg-destructive/5">
              <CardContent className="py-3 text-sm text-destructive">
                این گزارش فروش‌هایی را نشان می‌دهد که قیمت تمام‌شده ندارند یا صفر ثبت شده‌اند؛
                تا زمان ترمیم این ردیف‌ها، مفاد داشبورد می‌تواند بیشتر از واقعیت نمایش داده شود.
              </CardContent>
            </Card>
            <ReportTable
              title="خلاصه اجناس بدون قیمت تمام‌شده"
              columns={[
                { key: "productName", label: "جنس" },
                { key: "barcode", label: "بارکود" },
                { key: "categoryName", label: "کتگوری" },
                { key: "invoiceCount", label: "فاکتور" },
                { key: "lineCount", label: "خط فروش" },
                { key: "quantityBase", label: "مقدار" },
                { key: "salesBase", label: "فروش متاثر" },
              ]}
              rows={missingCostProductRows}
            />
            <ReportTable
              title="جزئیات فاکتورهای مشکوک"
              columns={[
                { key: "invoiceNo", label: "فاکتور" },
                { key: "saleDate", label: "تاریخ" },
                { key: "cashierName", label: "فروشنده" },
                { key: "productName", label: "جنس" },
                { key: "barcode", label: "بارکود" },
                { key: "categoryName", label: "کتگوری" },
                { key: "quantityBase", label: "مقدار" },
                { key: "salesBase", label: "فروش متاثر" },
                { key: "status", label: "حالت" },
              ]}
              rows={missingCostItemRows}
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
              title="تمام فروشات بازه انتخاب‌شده"
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
              pagination={activityPagination.sales}
              onPageChange={(page) => void loadActivityPage("sales", page)}
            />
          </TabsContent>

          <TabsContent value="purchases">
            <ReportTable
              title="تمام خریدهای بازه انتخاب‌شده"
              columns={[
                { key: "invoiceNo", label: "فاکتور" },
                { key: "date", label: "تاریخ" },
                { key: "supplier", label: "فروشنده" },
                { key: "total", label: "مجموع" },
                { key: "paid", label: "پرداخت" },
                { key: "remaining", label: "باقی" },
              ]}
              rows={purchaseRows}
              pagination={activityPagination.purchases}
              onPageChange={(page) => void loadActivityPage("purchases", page)}
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
              pagination={activityPagination["income-expenses"]}
              onPageChange={(page) =>
                void loadActivityPage("income-expenses", page)
              }
            />
          </TabsContent>

          <TabsContent value="currencyUsage" className="space-y-4">
            <ReportTable
              title="خلاصه معاملات بر اساس ارز"
              columns={[
                { key: "currency", label: "ارز" },
                { key: "documentCount", label: "تعداد سند" },
                { key: "originalAmount", label: "مبلغ همان ارز" },
                { key: "baseAmount", label: `معادل ${baseCurrencyCode}` },
              ]}
              rows={currencyUsageTotalRows}
            />
            <ReportTable
              title="جزئیات معاملات بر اساس نرخ"
              columns={[
                { key: "documentType", label: "نوع سند" },
                { key: "currency", label: "ارز" },
                { key: "exchangeRate", label: "نرخ به بیس" },
                { key: "documentCount", label: "تعداد" },
                { key: "originalAmount", label: "مبلغ همان ارز" },
                { key: "baseAmount", label: `معادل ${baseCurrencyCode}` },
                { key: "firstAt", label: "اولین معامله" },
                { key: "lastAt", label: "آخرین معامله" },
              ]}
              rows={currencyUsageRows}
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
  onEdit,
  editLabel,
  pagination,
  onPageChange,
}: {
  title: string;
  columns: Array<{ key: string; label: string }>;
  rows: DataRow[];
  onEdit?: (row: DataRow) => void;
  editLabel?: string;
  pagination?: PaginationMeta;
  onPageChange?: (page: number) => void;
}) {
  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <DenseTable
          columns={columns}
          rows={rows}
          onEdit={onEdit}
          editLabel={editLabel}
          pagination={pagination}
          onPageChange={onPageChange}
        />
      </CardContent>
    </Card>
  );
}
