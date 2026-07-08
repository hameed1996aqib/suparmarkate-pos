import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Banknote, CalendarDays, ChevronLeft, ChevronRight, Plus, RefreshCcw, Search, ShieldCheck, TrendingUp, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { ConfirmButton } from "@/components/ui/confirm-action";
import { DatePicker } from "@/components/ui/date-picker";
import { ManualDateInput } from "@/components/ui/manual-date-input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { API_BASE_URL } from "@/lib/api-config";

type Currency = {
  id: string;
  code: string;
  name: string;
  symbol?: string | null;
  isBase?: boolean;
  isActive?: boolean;
  latestRate?: number | null;
  latestRateAt?: string | null;
};

type CurrencyRate = {
  id: string;
  currencyId: string;
  currency?: Currency;
  rateToBase: number | string;
  effectiveAt: string;
  note?: string | null;
  createdAt: string;
};

const number = (value: number | string | null | undefined) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 }).format(Number(value || 0));

const formatDate = (value?: string | null) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("fa-AF", {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(date);
};

export function CurrencyHistoryPage() {
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [rates, setRates] = useState<CurrencyRate[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1 });
  const [summary, setSummary] = useState<{ todayCount: number; latestRateAt?: string | null }>({ todayCount: 0 });
  const [query, setQuery] = useState("");
  const [currencyId, setCurrencyId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState({
    currencyId: "",
    rateToBase: "1",
    effectiveAt: new Date().toISOString().slice(0, 10),
    note: ""
  });

  async function loadData(page = pagination.page) {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (currencyId) params.set("currencyId", currencyId);
      if (query.trim()) params.set("search", query.trim());
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      params.set("page", String(page));
      params.set("limit", String(pagination.limit));

      const [currencyRes, ratesRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/currencies`),
        fetch(`${API_BASE_URL}/api/currency-rates?${params.toString()}`)
      ]);
      const currencyJson = await currencyRes.json().catch(() => null);
      const ratesJson = await ratesRes.json().catch(() => null);

      if (!currencyRes.ok) throw new Error(currencyJson?.message || "کرنسی‌ها خوانده نشد");
      if (!ratesRes.ok) throw new Error(ratesJson?.message || "تاریخچه نرخ خوانده نشد");

      setCurrencies(Array.isArray(currencyJson?.data) ? currencyJson.data : []);
      setRates(Array.isArray(ratesJson?.data) ? ratesJson.data : []);
      setPagination(ratesJson?.pagination || { page: 1, limit: pagination.limit, total: 0, totalPages: 1 });
      setSummary(ratesJson?.summary || { todayCount: 0 });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "دیتا خوانده نشد");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadData(1);
  }, [currencyId, from, to]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(1), 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const baseCurrency = currencies.find((currency) => currency.isBase);
  const activeCurrencies = currencies.filter((currency) => currency.isActive !== false);
  const isLatestRate = (rate: CurrencyRate) => {
    const currency = currencies.find((item) => item.id === rate.currencyId);
    if (!currency?.latestRateAt) return false;

    return (
      new Date(currency.latestRateAt).getTime() === new Date(rate.effectiveAt).getTime() &&
      Number(currency.latestRate || 0) === Number(rate.rateToBase || 0)
    );
  };

  const currencyOptions = currencies.map((currency) => ({
    value: currency.id,
    label: `${currency.code} - ${currency.name}`,
    description: currency.isBase ? "کرنسی پایه" : currency.latestRate ? `آخرین نرخ: ${number(currency.latestRate)}` : "بدون نرخ"
  }));

  function openCreate() {
    const firstForeign = currencies.find((currency) => !currency.isBase) || currencies[0];
    setForm({
      currencyId: firstForeign?.id || "",
      rateToBase: firstForeign?.isBase ? "1" : "",
      effectiveAt: new Date().toISOString().slice(0, 10),
      note: ""
    });
    setIsDialogOpen(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const selected = currencies.find((currency) => currency.id === form.currencyId);

    if (!selected) {
      toast.error("کرنسی را انتخاب کنید");
      return;
    }

    if (selected.isBase && Number(form.rateToBase) !== 1) {
      toast.error("نرخ کرنسی پایه باید 1 باشد");
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/currency-rates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currencyId: form.currencyId,
          rateToBase: Number(form.rateToBase),
          effectiveAt: form.effectiveAt,
          note: form.note || null
        })
      });
      const json = await response.json().catch(() => null);

      if (!response.ok) throw new Error(json?.message || "ثبت نرخ ناکام شد");

      toast.success("نرخ جدید ثبت شد");
      setIsDialogOpen(false);
      await loadData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ثبت نرخ ناکام شد");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteRate(rate: CurrencyRate) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/currency-rates/${rate.id}`, {
        method: "DELETE"
      });
      const json = await response.json().catch(() => null);

      if (!response.ok) throw new Error(json?.message || "حذف نرخ ناکام شد");

      toast.success("نرخ حذف شد");
      await loadData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "حذف نرخ ناکام شد");
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Metric title="کرنسی پایه" value={baseCurrency?.code || "AFN"} icon={<Banknote />} />
        <Metric title="ارزهای فعال" value={String(activeCurrencies.length)} icon={<ShieldCheck />} />
        <Metric title="نرخ‌های امروز" value={String(summary.todayCount)} icon={<CalendarDays />} />
        <Metric title="آخرین تغییرات" value={formatDate(summary.latestRateAt)} icon={<TrendingUp />} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle>تاریخچه نرخ کرنسی‌ها</CardTitle>
            <CardDescription>
              هر معامله جدید از آخرین نرخ فعال همان کرنسی استفاده می‌کند و نرخ داخل سند ثابت می‌ماند.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void loadData()}>
              <RefreshCcw className="size-4" />
              بروزرسانی
            </Button>
            <Button onClick={openCreate}>
              <Plus className="size-4" />
              نرخ جدید
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 lg:grid-cols-[1fr_220px_180px_180px]">
            <label className="relative">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="pe-3 ps-9"
                placeholder="جستجو در نرخ، کرنسی یا یادداشت"
              />
            </label>
            <Combobox
              value={currencyId}
              onValueChange={setCurrencyId}
              placeholder="همه کرنسی‌ها"
              options={[{ value: "", label: "همه کرنسی‌ها" }, ...currencyOptions]}
            />
            <DatePicker value={from} onChange={setFrom} placeholder="از تاریخ" />
            <DatePicker value={to} onChange={setTo} placeholder="تا تاریخ" />
          </div>

          <div className="overflow-hidden border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>کرنسی</TableHead>
                  <TableHead>نرخ به {baseCurrency?.code || "پایه"}</TableHead>
                  <TableHead>تاریخ مؤثر</TableHead>
                  <TableHead>وضعیت</TableHead>
                  <TableHead>یادداشت</TableHead>
                  <TableHead>عملیات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      در حال خواندن...
                    </TableCell>
                  </TableRow>
                ) : rates.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      نرخ ثبت نشده است
                    </TableCell>
                  </TableRow>
                ) : (
                  rates.map((rate) => (
                    <TableRow key={rate.id}>
                      <TableCell className="font-medium">
                        {rate.currency?.code || rate.currencyId}
                        <div className="text-xs text-muted-foreground">{rate.currency?.name || "-"}</div>
                      </TableCell>
                      <TableCell>{number(rate.rateToBase)}</TableCell>
                      <TableCell>{formatDate(rate.effectiveAt)}</TableCell>
                      <TableCell>
                        {isLatestRate(rate) ? (
                          <Badge className="bg-primary/15 text-primary">آخرین نرخ</Badge>
                        ) : (
                          <Badge variant="outline">تاریخی</Badge>
                        )}
                      </TableCell>
                      <TableCell className="max-w-72 truncate">{rate.note || "-"}</TableCell>
                      <TableCell>
                        <ConfirmButton
                          size="icon-sm"
                          variant="ghost"
                          title="حذف"
                          description="این نرخ حذف شود؟"
                          onConfirm={() => void deleteRate(rate)}
                        >
                          <Trash2 className="size-4" />
                        </ConfirmButton>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              صفحه {pagination.page} از {pagination.totalPages} ({pagination.total} نرخ)
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pagination.page <= 1}
                onClick={() => void loadData(pagination.page - 1)}
              >
                <ChevronRight className="size-4" />
                قبلی
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => void loadData(pagination.page + 1)}
              >
                بعدی
                <ChevronLeft className="size-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-3xl">
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>ثبت نرخ جدید</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 py-4 md:grid-cols-2">
              <label className="grid gap-1.5">
                <span className="text-sm text-muted-foreground">کرنسی</span>
                <Combobox
                  value={form.currencyId}
                  onValueChange={(value) => {
                    const selected = currencies.find((currency) => currency.id === value);
                    setForm((current) => ({
                      ...current,
                      currencyId: value,
                      rateToBase: selected?.isBase ? "1" : current.rateToBase
                    }));
                  }}
                  placeholder="کرنسی را انتخاب کنید"
                  options={currencyOptions}
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-sm text-muted-foreground">نرخ به {baseCurrency?.code || "کرنسی پایه"}</span>
                <Input
                  type="number"
                  step="0.00000001"
                  min="0"
                  value={form.rateToBase}
                  onChange={(event) => setForm((current) => ({ ...current, rateToBase: event.target.value }))}
                  placeholder="مثلاً 72"
                />
              </label>
              <label className="grid gap-1.5 md:col-span-2">
                <span className="text-sm text-muted-foreground">تاریخ مؤثر</span>
                <ManualDateInput
                  value={form.effectiveAt}
                  onChange={(value) => setForm((current) => ({ ...current, effectiveAt: value }))}
                />
              </label>
              <label className="grid gap-1.5 md:col-span-2">
                <span className="text-sm text-muted-foreground">یادداشت</span>
                <textarea
                  value={form.note}
                  onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
                  className="min-h-24 w-full border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="منبع نرخ یا توضیح اصلاح"
                />
              </label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                بستن
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? "در حال ثبت..." : "ثبت نرخ"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({ title, value, icon }: { title: string; value: string; icon: ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex min-h-24 items-center justify-between gap-3 p-4">
        <div>
          <p className="text-xs text-muted-foreground">{title}</p>
          <strong className="mt-2 block text-2xl font-semibold">{value}</strong>
        </div>
        <div className="flex size-11 items-center justify-center border border-primary/20 bg-primary/10 text-primary [&_svg]:size-5">
          {icon}
        </div>
      </CardContent>
    </Card>
  );
}
