import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  CreditCard,
  Plus,
  RefreshCcw,
  Search,
  UserRound,
  UsersRound,
} from "lucide-react";
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
  NumberField,
  TextField,
} from "@/features/admin/components/form-fields";
import { MetricCard } from "@/features/admin/components/metric-card";
import { money } from "@/features/admin/format";
import type { DataRow } from "@/features/admin/types";
import { API_BASE_URL } from "@/lib/api-config";
import { dateRangeQuery, recentDateRange } from "@/lib/recent-date-filter";

type PartyKind = "CUSTOMER" | "SUPPLIER";

type PartyForm = {
  id?: string;
  code: string;
  name: string;
  companyName: string;
  contactPerson: string;
  phone: string;
  secondaryPhone: string;
  email: string;
  taxNumber: string;
  licenseNumber: string;
  province: string;
  city: string;
  address: string;
  creditLimit: number;
  paymentTermsDays: number;
  note: string;
  isActive: boolean;
};

const emptyPartyForm: PartyForm = {
  code: "",
  name: "",
  companyName: "",
  contactPerson: "",
  phone: "",
  secondaryPhone: "",
  email: "",
  taxNumber: "",
  licenseNumber: "",
  province: "",
  city: "",
  address: "",
  creditLimit: 0,
  paymentTermsDays: 0,
  note: "",
  isActive: true,
};

function partyBalance(party: any, kind: PartyKind) {
  const accounts = Array.isArray(party?.accounts) ? party.accounts : [];
  const debit = accounts.reduce(
    (sum: number, account: any) => sum + Number(account.debitBalance || 0),
    0,
  );
  const credit = accounts.reduce(
    (sum: number, account: any) => sum + Number(account.creditBalance || 0),
    0,
  );
  const balance = kind === "CUSTOMER" ? debit - credit : credit - debit;

  return Math.max(0, balance);
}

function partyToForm(party: any): PartyForm {
  return {
    id: party.id,
    code: party.code || "",
    name: party.name || "",
    companyName: party.companyName || "",
    contactPerson: party.contactPerson || "",
    phone: party.phone || "",
    secondaryPhone: party.secondaryPhone || "",
    email: party.email || "",
    taxNumber: party.taxNumber || "",
    licenseNumber: party.licenseNumber || "",
    province: party.province || "",
    city: party.city || "",
    address: party.address || "",
    creditLimit: Number(party.creditLimit || 0),
    paymentTermsDays: Number(party.paymentTermsDays || 0),
    note: party.note || "",
    isActive: party.isActive !== false,
  };
}

function normalizePartyRow(party: any, kind: PartyKind): DataRow {
  return {
    id: party.id,
    code: party.code || "-",
    name: party.name || "-",
    companyName: party.companyName || "-",
    phone: party.phone || party.secondaryPhone || "-",
    city: party.city || "-",
    balance: money(partyBalance(party, kind)),
    status: party.isActive === false ? "غیرفعال" : "فعال",
  };
}

export function CustomersPage() {
  return <PartyManagementPage kind="CUSTOMER" />;
}

export function SuppliersPage() {
  return <PartyManagementPage kind="SUPPLIER" />;
}

function PartyManagementPage({ kind }: { kind: PartyKind }) {
  const isCustomer = kind === "CUSTOMER";
  const title = isCustomer ? "مشتریان" : "فروشندگان";
  const [rows, setRows] = useState<DataRow[]>([]);
  const [summary, setSummary] = useState({ count: 0, active: 0, inactive: 0, balance: 0 });
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1 });
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<PartyForm>(emptyPartyForm);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const initialTransactionRange = recentDateRange();
  const [transactionFrom, setTransactionFrom] = useState(initialTransactionRange.from);
  const [transactionTo, setTransactionTo] = useState(initialTransactionRange.to);
  const [transactionPagination, setTransactionPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
  });

  const loadPartyTransactions = async (partyId: string, page = 1) => {
    const res = await fetch(
      `${API_BASE_URL}/api/parties/${partyId}/transactions?page=${page}&limit=${transactionPagination.limit}&${dateRangeQuery(transactionFrom, transactionTo)}`,
    );
    const json = await res.json().catch(() => null);

    if (!res.ok) {
      throw new Error(json?.message || "خواندن معاملات طرف حساب ناکام شد");
    }

    setTransactions(Array.isArray(json?.data) ? json.data : []);
    setTransactionPagination(
      json?.pagination || {
        page: 1,
        limit: transactionPagination.limit,
        total: 0,
        totalPages: 1,
      },
    );
  };

  const loadParties = async (page = pagination.page) => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        type: kind,
        page: String(page),
        limit: String(pagination.limit),
      });
      if (query.trim()) params.set("search", query.trim());
      const res = await fetch(`${API_BASE_URL}/api/parties?${params.toString()}`);
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.message || "خواندن طرف حساب‌ها ناکام شد");
      }

      const items = Array.isArray(json?.data) ? json.data : [];
      setRows(items.map((party: any) => normalizePartyRow(party, kind)));
      setSummary(json?.summary || { count: 0, active: 0, inactive: 0, balance: 0 });
      setPagination(json?.pagination || { page: 1, limit: pagination.limit, total: 0, totalPages: 1 });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "خواندن طرف حساب‌ها ناکام شد",
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadParties(1);
  }, [kind]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadParties(1), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return rows;

    return rows.filter((row) =>
      Object.values(row).some((value) =>
        String(value ?? "")
          .toLowerCase()
          .includes(normalized),
      ),
    );
  }, [query, rows]);

  const openCreate = () => {
    setForm(emptyPartyForm);
    setAccounts([]);
    setTransactions([]);
    setDialogOpen(true);
  };

  const openDetails = async (row: DataRow) => {
    try {
      const [res, transactionsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/parties/${row.id}`),
        fetch(
          `${API_BASE_URL}/api/parties/${row.id}/transactions?page=1&limit=${transactionPagination.limit}&${dateRangeQuery(transactionFrom, transactionTo)}`,
        ),
      ]);
      const [json, transactionsJson] = await Promise.all([
        res.json().catch(() => null),
        transactionsRes.json().catch(() => null),
      ]);

      if (!res.ok) {
        throw new Error(json?.message || "خواندن حساب ناکام شد");
      }
      if (!transactionsRes.ok) {
        throw new Error(transactionsJson?.message || "خواندن معاملات طرف حساب ناکام شد");
      }

      const party = json.data;
      setForm(partyToForm(party));
      setAccounts(Array.isArray(party.accounts) ? party.accounts : []);
      setTransactions(Array.isArray(transactionsJson?.data) ? transactionsJson.data : []);
      setTransactionPagination(
        transactionsJson?.pagination || {
          page: 1,
          limit: transactionPagination.limit,
          total: 0,
          totalPages: 1,
        },
      );
      setDialogOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "خواندن حساب ناکام شد");
    }
  };

  const saveParty = async () => {
    if (!form.name.trim()) {
      toast.error("نام ضروری است");
      return;
    }

    try {
      const res = await fetch(
        `${API_BASE_URL}/api/parties${form.id ? `/${form.id}` : ""}`,
        {
          method: form.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: kind,
            code: form.code || null,
            name: form.name,
            companyName: form.companyName || null,
            contactPerson: form.contactPerson || null,
            phone: form.phone || null,
            secondaryPhone: form.secondaryPhone || null,
            email: form.email || null,
            taxNumber: form.taxNumber || null,
            licenseNumber: form.licenseNumber || null,
            province: form.province || null,
            city: form.city || null,
            address: form.address || null,
            creditLimit: form.creditLimit,
            paymentTermsDays: form.paymentTermsDays,
            note: form.note || null,
            isActive: form.isActive,
          }),
        },
      );
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.message || "ذخیره طرف حساب ناکام شد");
      }

      toast.success(form.id ? "معلومات ذخیره شد" : "طرف حساب جدید ثبت شد");
      setDialogOpen(false);
      await loadParties();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "ذخیره طرف حساب ناکام شد",
      );
    }
  };

  const transactionRows: DataRow[] = transactions.map((item) => ({
    id: item.id,
    date: item.createdAt ? new Date(item.createdAt).toLocaleString("fa-AF") : "-",
    type: item.type || "-",
    side: item.side === "DEBIT" ? "بدهکار" : "بستانکار",
    amount: money(item.amount || 0),
    currency: item.currency?.code || "-",
    reference: item.referenceType || "-",
    note: item.note || "-",
  }));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label={`تعداد ${title}`}
          value={new Intl.NumberFormat("en-US").format(summary.count)}
          icon={isCustomer ? <UsersRound /> : <Building2 />}
        />
        <MetricCard
          label={isCustomer ? "طلب مشتریان" : "بدهی فروشندگان"}
          value={money(summary.balance)}
          icon={<CreditCard />}
        />
        <MetricCard
          label="فعال"
          value={new Intl.NumberFormat("en-US").format(
            summary.active,
          )}
          icon={<UserRound />}
        />
        <MetricCard
          label="غیرفعال"
          value={new Intl.NumberFormat("en-US").format(
            summary.inactive,
          )}
          icon={<CreditCard />}
        />
      </div>

      <Card className="border-border bg-card">
        <CardHeader className="gap-3 lg:grid-cols-[1fr_auto]">
          <div>
            <CardTitle className="flex items-center gap-2">
              {isCustomer ? <UsersRound className="size-5 text-primary" /> : <Building2 className="size-5 text-primary" />}
              {title}
            </CardTitle>
            <CardDescription>
              پروفایل کامل، مانده حساب، معاملات اخیر و دفتر طرف حساب.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="جستجوی نام، کد، تلفن..."
                className="w-72 ps-9"
              />
            </div>
            <Button variant="outline" onClick={() => void loadParties(1)}>
              <RefreshCcw className="size-4" />
              تازه‌سازی
            </Button>
            <Button onClick={openCreate}>
              <Plus className="size-4" />
              ثبت جدید
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              در حال خواندن {title}...
            </div>
          ) : (
            <DenseTable
              columns={[
                { key: "code", label: "کد" },
                { key: "name", label: "نام" },
                { key: "companyName", label: "شرکت" },
                { key: "phone", label: "تماس" },
                { key: "city", label: "شهر" },
                { key: "balance", label: "مانده" },
                { key: "status", label: "وضعیت" },
              ]}
              rows={filteredRows}
              pagination={pagination}
              onPageChange={(page) => void loadParties(page)}
              onEdit={openDetails}
              editLabel="دفتر"
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent
          dir="rtl"
          className="max-w-6xl"
        >
          <DialogHeader>
            <DialogTitle>
              {form.id ? `دفتر ${form.name}` : `ثبت ${isCustomer ? "مشتری" : "فروشنده"} جدید`}
            </DialogTitle>
            <DialogDescription>
              معلومات پروفایل، مانده حساب و معاملات اخیر در همین پنجره مدیریت می‌شود.
            </DialogDescription>
          </DialogHeader>

          <div className="grid max-h-[72vh] gap-4 overflow-y-auto pe-1">
            <div className="grid gap-3 md:grid-cols-3">
              <TextField label="کد" value={form.code} onChange={(value) => setForm((current) => ({ ...current, code: value }))} />
              <TextField label="نام" value={form.name} onChange={(value) => setForm((current) => ({ ...current, name: value }))} />
              <TextField label="شرکت" value={form.companyName} onChange={(value) => setForm((current) => ({ ...current, companyName: value }))} />
              <TextField label="شخص تماس" value={form.contactPerson} onChange={(value) => setForm((current) => ({ ...current, contactPerson: value }))} />
              <TextField label="موبایل" value={form.phone} onChange={(value) => setForm((current) => ({ ...current, phone: value }))} />
              <TextField label="موبایل دوم" value={form.secondaryPhone} onChange={(value) => setForm((current) => ({ ...current, secondaryPhone: value }))} />
              <TextField label="ایمیل" type="email" value={form.email} onChange={(value) => setForm((current) => ({ ...current, email: value }))} />
              <TextField label="شماره مالیاتی" value={form.taxNumber} onChange={(value) => setForm((current) => ({ ...current, taxNumber: value }))} />
              <TextField label="شماره جواز" value={form.licenseNumber} onChange={(value) => setForm((current) => ({ ...current, licenseNumber: value }))} />
              <TextField label="ولایت" value={form.province} onChange={(value) => setForm((current) => ({ ...current, province: value }))} />
              <TextField label="شهر" value={form.city} onChange={(value) => setForm((current) => ({ ...current, city: value }))} />
              <NumberField label="سقف اعتبار" value={form.creditLimit} onChange={(value) => setForm((current) => ({ ...current, creditLimit: value }))} />
              <NumberField label="مهلت پرداخت / روز" value={form.paymentTermsDays} onChange={(value) => setForm((current) => ({ ...current, paymentTermsDays: value }))} />
              <label className="grid gap-1.5 text-sm">
                <span className="text-muted-foreground">وضعیت</span>
                <button
                  type="button"
                  className="flex h-9 items-center justify-between rounded-lg border border-border bg-background px-3 text-start"
                  onClick={() => setForm((current) => ({ ...current, isActive: !current.isActive }))}
                >
                  <span>{form.isActive ? "فعال" : "غیرفعال"}</span>
                  <Badge className={form.isActive ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}>
                    {form.isActive ? "فعال" : "غیرفعال"}
                  </Badge>
                </button>
              </label>
              <div className="md:col-span-2">
                <TextField label="آدرس" value={form.address} onChange={(value) => setForm((current) => ({ ...current, address: value }))} />
              </div>
              <div className="md:col-span-3">
                <TextField label="یادداشت" value={form.note} onChange={(value) => setForm((current) => ({ ...current, note: value }))} />
              </div>
            </div>

            {form.id && (
              <>
                <div className="grid gap-3 md:grid-cols-3">
                  {accounts.length === 0 ? (
                    <Card className="border-border bg-card md:col-span-3">
                      <CardContent className="py-4 text-sm text-muted-foreground">
                        هنوز مانده حساب ثبت نشده است.
                      </CardContent>
                    </Card>
                  ) : (
                    accounts.map((account) => {
                      const debit = Number(account.debitBalance || 0);
                      const credit = Number(account.creditBalance || 0);
                      const balance = isCustomer ? debit - credit : credit - debit;
                      return (
                        <MetricCard
                          key={account.id}
                          label={`مانده ${account.currency?.code || ""}`}
                          value={money(Math.max(0, balance))}
                          icon={<CreditCard />}
                        />
                      );
                    })
                  )}
                </div>

                <Card className="border-border bg-card">
                  <CardHeader className="gap-3 lg:flex lg:flex-row lg:items-center lg:justify-between">
                    <CardTitle className="text-base">معاملات اخیر</CardTitle>
                    <div className="flex flex-wrap gap-2">
                      <DatePicker value={transactionFrom} onChange={setTransactionFrom} className="w-40" />
                      <DatePicker value={transactionTo} onChange={setTransactionTo} className="w-40" />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => form.id && void loadPartyTransactions(form.id, 1)}
                      >
                        <RefreshCcw className="size-4" />
                        اعمال بازه
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <DenseTable
                      columns={[
                        { key: "date", label: "تاریخ" },
                        { key: "type", label: "نوع" },
                        { key: "side", label: "سمت" },
                        { key: "amount", label: "مبلغ" },
                        { key: "currency", label: "کرنسی" },
                        { key: "reference", label: "مرجع" },
                        { key: "note", label: "یادداشت" },
                      ]}
                      rows={transactionRows}
                      pagination={transactionPagination}
                      onPageChange={(page) => form.id && void loadPartyTransactions(form.id, page)}
                    />
                  </CardContent>
                </Card>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              لغو
            </Button>
            <Button onClick={saveParty}>ذخیره</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
