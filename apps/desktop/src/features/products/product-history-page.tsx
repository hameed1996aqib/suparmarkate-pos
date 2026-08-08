import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpFromLine,
  Boxes,
  History,
  PackageCheck,
  Printer,
  RefreshCcw,
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MetricCard } from "@/features/admin/components/metric-card";
import {
  CompanyPrintHeader,
  type PrintCompany,
} from "@/features/printing/company-print-header";
import { API_BASE_URL } from "@/lib/api-config";
import { kabulDateString } from "@/lib/kabul-date";

type MovementDirection = "IN" | "OUT";

type ProductMovement = {
  id: string;
  type: string;
  direction: MovementDirection;
  quantity: number;
  signedQuantity: number;
  unitCost: number | null;
  baseUnitCost: number | null;
  totalBaseCost: number;
  exchangeRate: number;
  currencyCode: string | null;
  warehouseName: string;
  lotId: string | null;
  expiryDate: string | null;
  referenceType: string | null;
  referenceId: string | null;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
  isCancelled: boolean;
};

type ProductHistoryData = {
  product: {
    id: string;
    name: string;
    barcode: string | null;
    sku: string | null;
    categoryName: string | null;
    baseUnitName: string;
  };
  summary: {
    opening: number;
    totalIn: number;
    totalOut: number;
    closing: number;
  };
  movements: ProductMovement[];
};

type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

const number = (value: unknown, maximumFractionDigits = 4) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(
    Number(value || 0),
  );

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("fa-AF", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kabul",
  }).format(date);
}

function movementLabel(type: string) {
  const labels: Record<string, string> = {
    OPENING_STOCK: "موجودی اولیه",
    PURCHASE: "خرید",
    SALE: "فروش",
    SALE_RETURN: "برگشت فروش",
    PURCHASE_RETURN: "برگشت خرید",
    ADJUSTMENT_IN: "افزایش موجودی",
    ADJUSTMENT_OUT: "کاهش موجودی",
    DAMAGE: "ضایعات",
    TRANSFER_IN: "انتقال ورودی",
    TRANSFER_OUT: "انتقال خروجی",
  };
  return labels[type] || type;
}

function referenceLabel(type: string | null) {
  if (!type) return "بدون سند";
  const labels: Record<string, string> = {
    SALE: "فروش",
    PURCHASE: "خرید",
    SALE_RETURN: "برگشت فروش",
    PURCHASE_RETURN: "برگشت خرید",
    TRANSFER: "انتقال",
    OPENING_STOCK: "موجودی اولیه",
    ADJUSTMENT: "اصلاح موجودی",
  };
  return labels[type] || type.replaceAll("_", " ");
}

function directionBadge(direction: MovementDirection, isCancelled: boolean) {
  if (isCancelled) {
    return (
      <Badge className="border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400">
        ابطال / معکوس
      </Badge>
    );
  }
  return direction === "IN" ? (
    <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
      <ArrowDownToLine className="size-3.5" />
      آمد
    </Badge>
  ) : (
    <Badge className="border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300">
      <ArrowUpFromLine className="size-3.5" />
      رفت
    </Badge>
  );
}

export function ProductHistoryPage() {
  const { productId = "" } = useParams();
  const navigate = useNavigate();
  const initialRange = useMemo(() => {
    const to = kabulDateString();
    return { from: `${to.slice(0, 8)}01`, to };
  }, []);
  const [draftFrom, setDraftFrom] = useState(initialRange.from);
  const [draftTo, setDraftTo] = useState(initialRange.to);
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [data, setData] = useState<ProductHistoryData | null>(null);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 30,
    total: 0,
    totalPages: 1,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isPrinting, setIsPrinting] = useState(false);
  const [printRows, setPrintRows] = useState<ProductMovement[] | null>(null);
  const [company, setCompany] = useState<PrintCompany | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  const requestPage = async (
    page: number,
    limit = 30,
    signal?: AbortSignal,
  ) => {
    const query = new URLSearchParams({
      from,
      to,
      page: String(page),
      limit: String(limit),
    });
    const response = await fetch(
      `${API_BASE_URL}/api/inventory/product-history/${encodeURIComponent(productId)}?${query}`,
      { signal },
    );
    const json = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(json?.message || "خواندن سابقه محصول ناکام شد");
    }
    return json as { data: ProductHistoryData; pagination: Pagination };
  };

  const loadHistory = async (page = 1) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setIsLoading(true);
    try {
      const result = await requestPage(page, 30, controller.signal);
      setData(result.data);
      setPagination(result.pagination);
    } catch (error: any) {
      if (error?.name !== "AbortError") {
        toast.error(
          error instanceof Error ? error.message : "خواندن سابقه محصول ناکام شد",
        );
      }
    } finally {
      if (requestRef.current === controller) {
        setIsLoading(false);
        requestRef.current = null;
      }
    }
  };

  useEffect(() => {
    void loadHistory(1);
    return () => requestRef.current?.abort();
  }, [productId, from, to]);

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/settings/company`)
      .then((response) => response.json())
      .then((json) => setCompany(json.data || null))
      .catch(() => setCompany(null));
  }, []);

  const applyRange = () => {
    if (!draftFrom || !draftTo || draftFrom > draftTo) {
      toast.error("بازه تاریخ درست انتخاب نشده است");
      return;
    }
    setFrom(draftFrom);
    setTo(draftTo);
  };

  const printReport = async () => {
    setIsPrinting(true);
    try {
      const first = await requestPage(1, 200);
      const rows = [...first.data.movements];
      for (let page = 2; page <= first.pagination.totalPages; page += 1) {
        const next = await requestPage(page, 200);
        rows.push(...next.data.movements);
      }
      setPrintRows(rows);
      window.setTimeout(() => window.print(), 80);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "آماده‌سازی چاپ ناکام شد",
      );
    } finally {
      setIsPrinting(false);
    }
  };

  useEffect(() => {
    const clearPrintRows = () => setPrintRows(null);
    window.addEventListener("afterprint", clearPrintRows);
    return () => window.removeEventListener("afterprint", clearPrintRows);
  }, []);

  const rows = printRows || data?.movements || [];
  const unitName = data?.product.baseUnitName || "واحد پایه";
  const summary = data?.summary || {
    opening: 0,
    totalIn: 0,
    totalOut: 0,
    closing: 0,
  };

  return (
    <div className="app-print-page space-y-4">
      <CompanyPrintHeader
        company={company}
        title={`سابقه محصول - ${data?.product.name || ""}`}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Button variant="outline" onClick={() => navigate(-1)}>
          <ArrowLeft className="size-4" />
          برگشت
        </Button>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <span className="block text-xs text-muted-foreground">از تاریخ</span>
            <DatePicker value={draftFrom} onChange={setDraftFrom} className="w-40" />
          </div>
          <div className="space-y-1">
            <span className="block text-xs text-muted-foreground">تا تاریخ</span>
            <DatePicker value={draftTo} onChange={setDraftTo} className="w-40" />
          </div>
          <Button onClick={applyRange} disabled={isLoading}>
            <RefreshCcw className="size-4" />
            اعمال فیلتر
          </Button>
          <Button variant="outline" onClick={printReport} disabled={isLoading || isPrinting}>
            <Printer className="size-4" />
            {isPrinting ? "آماده‌سازی..." : "چاپ / PDF"}
          </Button>
        </div>
      </div>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="size-5 text-primary" />
            سابقه محصول: {data?.product.name || "در حال خواندن..."}
          </CardTitle>
          <CardDescription>
            بارکود: {data?.product.barcode || "-"} | کتگوری: {data?.product.categoryName || "-"} | بازه: {from} تا {to}
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Opening" value={`${number(summary.opening)} ${unitName}`} icon={<Boxes />} trend="موجودی آغاز بازه" />
        <MetricCard title="مجموع آمد" value={`${number(summary.totalIn)} ${unitName}`} icon={<ArrowDownToLine />} trend="تمام ورودی‌های بازه" />
        <MetricCard title="مجموع رفت" value={`${number(summary.totalOut)} ${unitName}`} icon={<ArrowUpFromLine />} trend="تمام خروجی‌های بازه" />
        <MetricCard title="Closing" value={`${number(summary.closing)} ${unitName}`} icon={<PackageCheck />} trend="موجودی پایان بازه" />
      </div>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">تمام رفت و آمدهای محصول</CardTitle>
          <CardDescription>
            سبز نشان‌دهنده آمد و سرخ نشان‌دهنده رفت از موجودی است. تمام مقدارها با واحد پایه نمایش داده می‌شوند.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden border border-border">
            <Table className="text-xs">
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead>تاریخ و ساعت</TableHead>
                  <TableHead>جهت</TableHead>
                  <TableHead>نوع حرکت</TableHead>
                  <TableHead>مقدار</TableHead>
                  <TableHead>گدام</TableHead>
                  <TableHead>قیمت تمام‌شد</TableHead>
                  <TableHead>سند مرجع</TableHead>
                  <TableHead>ثبت‌کننده</TableHead>
                  <TableHead>یادداشت</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && !printRows ? (
                  <TableRow><TableCell colSpan={9} className="py-10 text-center text-muted-foreground">در حال خواندن سابقه محصول...</TableCell></TableRow>
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={9} className="py-10 text-center text-muted-foreground">در این بازه رفت و آمدی ثبت نشده است</TableCell></TableRow>
                ) : rows.map((movement) => (
                  <TableRow
                    key={movement.id}
                    className={movement.isCancelled ? "bg-red-500/5 opacity-70" : movement.direction === "IN" ? "bg-emerald-500/5" : "bg-rose-500/5"}
                  >
                    <TableCell className="whitespace-nowrap">{formatDateTime(movement.createdAt)}</TableCell>
                    <TableCell>{directionBadge(movement.direction, movement.isCancelled)}</TableCell>
                    <TableCell>{movementLabel(movement.type)}</TableCell>
                    <TableCell className={movement.direction === "IN" ? "font-semibold text-emerald-600 dark:text-emerald-400" : "font-semibold text-rose-600 dark:text-rose-400"}>
                      {movement.direction === "IN" ? "+" : "-"}{number(movement.quantity)} {unitName}
                    </TableCell>
                    <TableCell>{movement.warehouseName}</TableCell>
                    <TableCell>
                      {movement.baseUnitCost == null ? "-" : `${number(movement.baseUnitCost)} AFN`}
                    </TableCell>
                    <TableCell>
                      <div>{referenceLabel(movement.referenceType)}</div>
                      <div className="max-w-36 truncate text-[10px] text-muted-foreground" title={movement.referenceId || ""}>{movement.referenceId || "-"}</div>
                    </TableCell>
                    <TableCell>{movement.createdBy || "-"}</TableCell>
                    <TableCell className="max-w-52 whitespace-normal">{movement.note || "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground print:hidden">
            <span>
              نمایش {pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.limit + 1} تا {Math.min(pagination.page * pagination.limit, pagination.total)} از {pagination.total}
            </span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={pagination.page <= 1 || isLoading} onClick={() => void loadHistory(pagination.page - 1)}>قبلی</Button>
              <span>صفحه {pagination.page} از {pagination.totalPages}</span>
              <Button size="sm" variant="outline" disabled={pagination.page >= pagination.totalPages || isLoading} onClick={() => void loadHistory(pagination.page + 1)}>بعدی</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
