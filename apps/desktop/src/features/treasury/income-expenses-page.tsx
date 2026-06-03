import { useEffect, useMemo, useState } from "react";
import {
  Boxes,
  RefreshCcw,
  Search,
  TrendingDown,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { DenseTable } from "@/features/admin/components/dense-table";
import {
  LookupSelect,
  NumberField,
  TextField,
  type LookupItem,
} from "@/features/admin/components/form-fields";
import { MetricCard } from "@/features/admin/components/metric-card";
import { money } from "@/features/admin/format";
import type { DataRow } from "@/features/admin/types";
import {
  accountKey,
  buildPaymentAccounts,
  parseAccountKey,
  type PaymentAccountOption,
} from "@/features/treasury/accounts";
import { API_BASE_URL } from "@/lib/api-config";
import { dateRangeQuery, recentDateRange } from "@/lib/recent-date-filter";

type IncomeExpenseForm = {
  kind: "INCOME" | "EXPENSE";
  currencyId: string;
  accountKey: string;
  categoryId: string;
  amount: number;
  note: string;
};

const emptyIncomeExpenseForm: IncomeExpenseForm = {
  kind: "EXPENSE",
  currencyId: "",
  accountKey: "",
  categoryId: "",
  amount: 0,
  note: "",
};

function normalizeIncomeExpense(item: any): DataRow {
  const accountName =
    item.cashRegisterAccount?.cashRegister?.name ||
    item.bankAccount?.name ||
    "-";
  const isIncome = item.type === "INCOME";

  return {
    id: item.id,
    __raw: item,
    __canEdit: !item.isCancelled,
    __canDelete: !item.isCancelled,
    name: item.note || item.referenceType || item.type || "-",
    category: item.category?.name || "-",
    type: isIncome ? "عواید" : "مصرف",
    account: accountName,
    amount: money(item.amount || 0),
    status: item.isCancelled
      ? "ابطال"
      : item.direction === "IN"
        ? "وارد شده"
        : "خارج شده",
  };
}

export function IncomeExpensesPage() {
  const initialRange = recentDateRange();
  const [rows, setRows] = useState<DataRow[]>([]);
  const [summary, setSummary] = useState({ income: 0, expense: 0, count: 0 });
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 1,
  });
  const [paymentAccounts, setPaymentAccounts] = useState<PaymentAccountOption[]>([]);
  const [currencies, setCurrencies] = useState<LookupItem[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<IncomeExpenseForm>(emptyIncomeExpenseForm);
  const [cancelRow, setCancelRow] = useState<DataRow | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [editingRow, setEditingRow] = useState<{
    row: DataRow;
    reversed: boolean;
  } | null>(null);

  const loadIncomeExpensesData = async (page = pagination.page) => {
    setIsLoading(true);
    try {
      const [itemsRes, cashRes, bankRes, currenciesRes, categoriesRes] =
        await Promise.all([
          fetch(`${API_BASE_URL}/api/income-expenses?page=${page}&limit=${pagination.limit}&${dateRangeQuery(from, to)}`).then((res) => res.json()),
          fetch(`${API_BASE_URL}/api/cash-registers`).then((res) => res.json()),
          fetch(`${API_BASE_URL}/api/bank-accounts`).then((res) => res.json()),
          fetch(`${API_BASE_URL}/api/currencies`).then((res) => res.json()),
          fetch(`${API_BASE_URL}/api/financial-categories`).then((res) =>
            res.json(),
          ),
        ]);

      setRows(
        Array.isArray(itemsRes?.data)
          ? itemsRes.data.map(normalizeIncomeExpense)
          : [],
      );
      setSummary(itemsRes?.summary || { income: 0, expense: 0, count: 0 });
      setPagination(itemsRes?.pagination || {
        page: 1,
        limit: pagination.limit,
        total: 0,
        totalPages: 1,
      });
      setPaymentAccounts(buildPaymentAccounts(cashRes?.data, bankRes?.data));
      setCurrencies(
        Array.isArray(currenciesRes?.data) ? currenciesRes.data : [],
      );
      setCategories(
        Array.isArray(categoriesRes?.data) ? categoriesRes.data : [],
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "خواندن عواید و مصارف ناکام شد",
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadIncomeExpensesData();
  }, []);

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return rows;

    return rows.filter((row) =>
      Object.values(row).some((value) =>
        String(value ?? "").toLowerCase().includes(normalized),
      ),
    );
  }, [query, rows]);

  const openCreate = (kind: "INCOME" | "EXPENSE") => {
    const baseCurrency =
      currencies.find((currency) => currency.isBase) || currencies[0];
    const account = paymentAccounts.find(
      (item) => !baseCurrency || item.currencyId === baseCurrency.id,
    );
    const category = categories.find(
      (item) => item.type === "BOTH" || item.type === kind,
    );

    setForm({
      ...emptyIncomeExpenseForm,
      kind,
      currencyId: baseCurrency?.id || "",
      accountKey: account ? accountKey(account) : "",
      categoryId: category?.id || "",
    });
    setEditingRow(null);
    setDialogOpen(true);
  };

  const submitIncomeExpense = async () => {
    const selectedAccount = parseAccountKey(form.accountKey);
    let reversedExisting = editingRow?.reversed ?? false;

    if (!form.currencyId || !selectedAccount || form.amount <= 0) {
      toast.error("کرنسی، حساب صندوق/بانک و مبلغ معتبر ضروری است");
      return;
    }

    try {
      if (editingRow && !editingRow.reversed) {
        const cancelRes = await fetch(
          `${API_BASE_URL}/api/income-expenses/${editingRow.row.id}/cancel`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reason: "اصلاح سند ثبت‌شده" }),
          },
        );
        const cancelJson = await cancelRes.json().catch(() => null);

        if (!cancelRes.ok) {
          throw new Error(cancelJson?.message || "ابطال نسخه قبلی سند ناکام شد");
        }

        setEditingRow((current) =>
          current ? { ...current, reversed: true } : current,
        );
        reversedExisting = true;
      }

      const res = await fetch(`${API_BASE_URL}/api/income-expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: form.kind,
          currencyId: form.currencyId,
          accountType: selectedAccount.type,
          accountId: selectedAccount.id,
          categoryId: form.categoryId || null,
          amount: form.amount,
          note: form.note || null,
        }),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.message || "ثبت عاید/مصرف ناکام شد");
      }

      toast.success(
        editingRow
          ? "سند قبلی ابطال و نسخه اصلاح‌شده ثبت شد"
          : form.kind === "INCOME"
            ? "عاید ثبت شد"
            : "مصرف ثبت شد",
      );
      setDialogOpen(false);
      setEditingRow(null);
      await loadIncomeExpensesData();
    } catch (error) {
      toast.error(
        reversedExisting
          ? "نسخه قبلی ابطال شد، اما ثبت نسخه اصلاح‌شده ناکام شد. فورم را بررسی و دوباره ذخیره کنید."
          : error instanceof Error
            ? error.message
            : "ثبت عاید/مصرف ناکام شد",
      );
    }
  };

  const openIncomeExpenseCancel = (row: DataRow) => {
    if (row.status === "ابطال") {
      toast.info("این سند قبلاً ابطال شده است.");
      return;
    }

    setCancelRow(row);
    setCancelReason("");
  };

  const openIncomeExpenseEdit = (row: DataRow) => {
    if (row.status === "ابطال") {
      toast.info("سند ابطال‌شده قابل ویرایش نیست.");
      return;
    }

    const raw = row.__raw as any;
    setForm({
      kind: raw.type === "INCOME" ? "INCOME" : "EXPENSE",
      currencyId: raw.currencyId || "",
      accountKey: raw.cashRegisterAccountId
        ? `CASH:${raw.cashRegisterAccountId}`
        : raw.bankAccountId
          ? `BANK:${raw.bankAccountId}`
          : "",
      categoryId: raw.categoryId || "",
      amount: Number(raw.amount || 0),
      note: raw.note || "",
    });
    setEditingRow({ row, reversed: false });
    setDialogOpen(true);
  };

  const submitIncomeExpenseCancel = async () => {
    if (!cancelRow) return;

    try {
      const res = await fetch(
        `${API_BASE_URL}/api/income-expenses/${cancelRow.id}/cancel`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: cancelReason || null }),
        },
      );
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.message || "ابطال سند ناکام شد");
      }

      toast.success("سند با سند معکوس ابطال شد");
      setCancelRow(null);
      setCancelReason("");
      await loadIncomeExpensesData();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "ابطال سند ناکام شد",
      );
    }
  };

  const categoryOptions = categories
    .filter((item) => item.type === "BOTH" || item.type === form.kind)
    .map((item) => ({
      id: item.id,
      name: item.name,
    }));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="عواید ثبت‌شده"
          value={money(summary.income)}
          icon={<TrendingUp />}
        />
        <MetricCard
          label="مصارف ثبت‌شده"
          value={money(summary.expense)}
          icon={<TrendingDown />}
        />
        <MetricCard
          label="کتگوری‌های مالی"
          value={new Intl.NumberFormat("en-US").format(categories.length)}
          icon={<Boxes />}
        />
        <MetricCard
          label="تراکنش‌ها"
          value={new Intl.NumberFormat("en-US").format(summary.count)}
          icon={<WalletCards />}
        />
      </div>

      <Card className="border-border bg-card">
        <CardHeader className="gap-3 lg:grid-cols-[1fr_auto]">
          <div>
            <CardTitle className="flex items-center gap-2">
              <WalletCards className="size-5 text-primary" />
              عواید و مصارف
            </CardTitle>
            <CardDescription>
              ثبت دخل و خرچ عمومی با اثر خودکار روی صندوق/بانک و ژورنال حسابداری.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DatePicker value={from} onChange={setFrom} className="w-40" />
            <DatePicker value={to} onChange={setTo} className="w-40" />
            <div className="relative">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="جستجوی شرح، کتگوری یا حساب..."
                className="w-72 ps-9"
              />
            </div>
            <Button
              variant="outline"
              onClick={() => void loadIncomeExpensesData(1)}
            >
              <RefreshCcw className="size-4" />
              تازه‌سازی
            </Button>
            <Button variant="outline" onClick={() => openCreate("INCOME")}>
              <TrendingUp className="size-4" />
              عاید جدید
            </Button>
            <Button onClick={() => openCreate("EXPENSE")}>
              <TrendingDown className="size-4" />
              مصرف جدید
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              در حال خواندن دخل و خرچ...
            </div>
          ) : (
            <DenseTable
              columns={[
                { key: "name", label: "شرح" },
                { key: "category", label: "کتگوری" },
                { key: "type", label: "نوع" },
                { key: "account", label: "حساب" },
                { key: "amount", label: "مبلغ" },
                { key: "status", label: "وضعیت" },
              ]}
              rows={filteredRows}
              pagination={pagination}
              onPageChange={(page) => void loadIncomeExpensesData(page)}
              onEdit={openIncomeExpenseEdit}
              editLabel="ویرایش"
              onDelete={openIncomeExpenseCancel}
              deleteLabel="ابطال سند"
              deleteTitle="تایید ابطال سند مالی"
              deleteDescription="این سند حذف نمی‌شود؛ یک سند معکوس برای اصلاح صندوق/بانک و ژورنال حسابداری ساخته می‌شود."
            />
          )}
        </CardContent>
      </Card>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingRow(null);
        }}
      >
        <DialogContent dir="rtl" className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingRow
                ? "ویرایش سند مالی"
                : form.kind === "INCOME"
                  ? "ثبت عاید جدید"
                  : "ثبت مصرف جدید"}
            </DialogTitle>
            <DialogDescription>
              با ثبت این سند، مانده حساب و سند حسابداری هم‌زمان ساخته می‌شود.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="form-grid-field grid gap-1.5 text-sm">
              <span className="text-muted-foreground">نوع سند</span>
              <select
                value={form.kind}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    kind: event.target.value as "INCOME" | "EXPENSE",
                    categoryId: "",
                  }))
                }
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
              >
                <option value="EXPENSE">مصرف</option>
                <option value="INCOME">عاید</option>
              </select>
            </label>
            <LookupSelect
              label="کرنسی"
              value={form.currencyId}
              options={currencies.map((item) => ({
                ...item,
                name: item.code || item.name,
              }))}
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  currencyId: value,
                  accountKey: "",
                }))
              }
            />
            <LookupSelect
              label="حساب صندوق/بانک"
              value={form.accountKey}
              options={paymentAccounts
                .filter(
                  (account) =>
                    !form.currencyId || account.currencyId === form.currencyId,
                )
                .map((account) => ({
                  id: accountKey(account),
                  name: `${account.name} - ${money(account.balance || 0)}`,
                }))}
              onChange={(value) =>
                setForm((current) => ({ ...current, accountKey: value }))
              }
            />
            <LookupSelect
              label="کتگوری"
              value={form.categoryId}
              options={categoryOptions}
              emptyLabel="بدون کتگوری"
              onChange={(value) =>
                setForm((current) => ({ ...current, categoryId: value }))
              }
            />
            <NumberField
              label="مبلغ"
              value={form.amount}
              fullWidth
              onChange={(value) =>
                setForm((current) => ({ ...current, amount: value }))
              }
            />
            <TextField
              label="شرح"
              value={form.note}
              fullWidth
              onChange={(value) =>
                setForm((current) => ({ ...current, note: value }))
              }
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              لغو
            </Button>
            <Button onClick={submitIncomeExpense}>
              {editingRow ? "ذخیره اصلاحات" : "ثبت سند"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(cancelRow)}
        onOpenChange={(open) => {
          if (!open) {
            setCancelRow(null);
          }
        }}
      >
        <DialogContent dir="rtl" className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>ابطال سند عاید / مصرف</DialogTitle>
            <DialogDescription>
              سند اصلی حذف نمی‌شود؛ یک سند معکوس ساخته می‌شود تا سابقه مالی،
              مانده حساب و ژورنال درست باقی بماند. برای اصلاح مبلغ یا حساب، بعد
              از ابطال سند درست را دوباره ثبت کنید.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="border border-border bg-muted/30 p-3 text-sm">
              <div>نوع: {String(cancelRow?.type || "-")}</div>
              <div>مبلغ: {String(cancelRow?.amount || "-")}</div>
              <div>حساب: {String(cancelRow?.account || "-")}</div>
            </div>
            <label className="grid gap-1.5 text-sm">
              <span className="text-muted-foreground">دلیل ابطال</span>
              <textarea
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
                placeholder="مثلاً مبلغ اشتباه، حساب اشتباه یا ثبت تکراری..."
                rows={4}
                className="min-h-24 w-full border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
              />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelRow(null)}>
              لغو
            </Button>
            <Button variant="destructive" onClick={submitIncomeExpenseCancel}>
              ابطال با سند معکوس
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
