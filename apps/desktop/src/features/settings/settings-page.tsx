import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Boxes,
  Building2,
  Coins,
  FolderTree,
  ImageUp,
  MoreHorizontal,
  Plus,
  RefreshCcw,
  Settings,
  Store,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { ConfirmDropdownItem } from "@/components/ui/confirm-action";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { API_BASE_URL } from "@/lib/api-config";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ServerSettingsCard } from "./server-settings-card";

type GenericRow = Record<string, string | number | boolean | null | undefined>;

type FieldConfig = {
  key: string;
  label: string;
  type?: "text" | "checkbox" | "select";
  options?: Array<{ label: string; value: string }>;
};

type ResourceConfig = {
  title: string;
  description: string;
  endpoint: string;
  icon: typeof Store;
  columns: Array<{ key: string; label: string }>;
  fields: FieldConfig[];
  emptyRow: GenericRow;
};

const resources: ResourceConfig[] = [
  {
    title: "گدام‌ها",
    description: "گدام مرکزی، محل نگهداری و وضعیت فعال.",
    endpoint: "/api/warehouses",
    icon: Store,
    columns: [
      { key: "name", label: "نام" },
      { key: "location", label: "موقعیت" },
      { key: "isDefault", label: "پیش‌فرض" },
      { key: "isActive", label: "وضعیت" },
    ],
    fields: [
      { key: "name", label: "نام گدام" },
      { key: "location", label: "موقعیت" },
      { key: "isDefault", label: "پیش‌فرض", type: "checkbox" },
      { key: "isActive", label: "فعال", type: "checkbox" },
    ],
    emptyRow: { name: "", location: "", isDefault: false, isActive: true },
  },
  {
    title: "واحدات",
    description:
      "دانه، کارتن، بسته، کیلو و واحدات قابل استفاده در خرید و فروش.",
    endpoint: "/api/units",
    icon: Boxes,
    columns: [
      { key: "name", label: "نام" },
      { key: "shortName", label: "مخفف" },
      { key: "isActive", label: "وضعیت" },
    ],
    fields: [
      { key: "name", label: "نام واحد" },
      { key: "shortName", label: "مخفف" },
      { key: "isActive", label: "فعال", type: "checkbox" },
    ],
    emptyRow: { name: "", shortName: "", isActive: true },
  },
  {
    title: "کرنسی‌ها",
    description: "AFN و ارزهای قابل استفاده در صندوق، بانک، خرید و فروش.",
    endpoint: "/api/currencies",
    icon: Coins,
    columns: [
      { key: "code", label: "کد" },
      { key: "name", label: "نام" },
      { key: "symbol", label: "سمبول" },
      { key: "latestRate", label: "آخرین نرخ" },
      { key: "latestRateAt", label: "تاریخ نرخ" },
      { key: "isBase", label: "اصلی" },
      { key: "isActive", label: "وضعیت" },
    ],
    fields: [
      { key: "code", label: "کد" },
      { key: "name", label: "نام" },
      { key: "symbol", label: "سمبول" },
      { key: "isActive", label: "فعال", type: "checkbox" },
    ],
    emptyRow: { code: "", name: "", symbol: "", isBase: false, isActive: true },
  },
  {
    title: "کتگوری اجناس",
    description: "گروپ‌بندی اجناس برای گزارش و جستجو.",
    endpoint: "/api/product-categories",
    icon: FolderTree,
    columns: [
      { key: "name", label: "نام" },
      { key: "isActive", label: "وضعیت" },
    ],
    fields: [
      { key: "name", label: "نام کتگوری" },
      { key: "isActive", label: "فعال", type: "checkbox" },
    ],
    emptyRow: { name: "", isActive: true },
  },
  {
    title: "کتگوری عواید/مصارف",
    description: "کتگوری‌های درآمد، مصرف یا مشترک برای گزارش مالی.",
    endpoint: "/api/financial-categories",
    icon: Settings,
    columns: [
      { key: "name", label: "نام" },
      { key: "type", label: "نوع" },
      { key: "isActive", label: "وضعیت" },
    ],
    fields: [
      { key: "name", label: "نام کتگوری" },
      {
        key: "type",
        label: "نوع",
        type: "select",
        options: [
          { label: "عواید", value: "INCOME" },
          { label: "مصارف", value: "EXPENSE" },
          { label: "هردو", value: "BOTH" },
        ],
      },
      { key: "description", label: "توضیحات" },
      { key: "isActive", label: "فعال", type: "checkbox" },
    ],
    emptyRow: { name: "", type: "BOTH", description: "", isActive: true },
  },
];

function rowText(value: GenericRow[string]) {
  if (typeof value === "boolean") return value ? "بلی" : "نخیر";
  return String(value ?? "-");
}

function ResourceCard({ config }: { config: ResourceConfig }) {
  const Icon = config.icon;
  const [rows, setRows] = useState<GenericRow[]>([]);
  const [editing, setEditing] = useState<GenericRow | null>(null);
  const [form, setForm] = useState<GenericRow>(config.emptyRow);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  async function load() {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}${config.endpoint}`);
      const json = await response.json().catch(() => null);

      if (!response.ok) throw new Error(json?.message || "دیتا خوانده نشد");
      setRows(json?.data || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "دیتا خوانده نشد");
    } finally {
      setIsLoading(false);
    }
  }

  function openCreate() {
    setEditing(null);
    setForm({ ...config.emptyRow });
    setIsDialogOpen(true);
  }

  function openEdit(row: GenericRow) {
    setEditing(row);
    setForm({ ...config.emptyRow, ...row });
    setIsDialogOpen(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setIsSaving(true);

    try {
      const id = editing?.id;
      const response = await fetch(
        `${API_BASE_URL}${config.endpoint}${id ? `/${id}` : ""}`,
        {
          method: id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        },
      );
      const json = await response.json().catch(() => null);

      if (!response.ok) throw new Error(json?.message || "ذخیره ناکام شد");

      toast.success("ذخیره شد");
      setEditing(null);
      setForm({ ...config.emptyRow });
      setIsDialogOpen(false);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ذخیره ناکام شد");
    } finally {
      setIsSaving(false);
    }
  }

  async function remove(row: GenericRow) {
    if (!row.id) return;

    try {
      const response = await fetch(
        `${API_BASE_URL}${config.endpoint}/${row.id}`,
        { method: "DELETE" },
      );
      const json = await response.json().catch(() => null);

      if (!response.ok) throw new Error(json?.message || "حذف ناکام شد");

      toast.success("حذف/غیرفعال شد");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "حذف ناکام شد");
    }
  }

  useEffect(() => {
    void load();
  }, [config.endpoint]);

  return (
    <Card className="border-border bg-card">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Icon className="size-5 text-primary" />
            {config.title}
          </CardTitle>
          <CardDescription>{config.description}</CardDescription>
        </div>
        <div className="flex gap-2">
          <Button
            size="icon-sm"
            variant="outline"
            onClick={load}
            disabled={isLoading}
          >
            <RefreshCcw className="size-4" />
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="size-4" />
            جدید
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Table className="text-xs">
          <TableHeader>
            <TableRow className="border-border bg-muted/40 hover:bg-muted/40">
              {config.columns.map((column) => (
                <TableHead key={column.key}>{column.label}</TableHead>
              ))}
              <TableHead className="w-16 text-center">عملیات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={config.columns.length + 1}
                  className="py-8 text-center text-muted-foreground"
                >
                  در حال خواندن...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={config.columns.length + 1}
                  className="py-8 text-center text-muted-foreground"
                >
                  هنوز موردی ثبت نشده است.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={String(row.id)} className="border-border">
                  {config.columns.map((column) => (
                    <TableCell key={column.key}>
                      {column.key === "isActive" ? (
                        <Badge className="bg-primary/15 text-primary">
                          {row[column.key] === false ? "غیرفعال" : "فعال"}
                        </Badge>
                      ) : (
                        rowText(row[column.key])
                      )}
                    </TableCell>
                  ))}
                  <TableCell className="text-center">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon-sm" variant="outline" title="عملیات">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" sideOffset={6} className="w-44" dir="rtl">
                        <DropdownMenuLabel>عملیات</DropdownMenuLabel>
                        <DropdownMenuItem onClick={() => openEdit(row)}>
                          <Settings className="size-4" />
                          <span>ویرایش</span>
                        </DropdownMenuItem>
                        <ConfirmDropdownItem
                          title="تایید حذف"
                          description="آیا مطمئن هستید که این مورد حذف شود؟"
                          confirmLabel="حذف"
                          onConfirm={() => remove(row)}
                        >
                          <Trash2 className="size-4" />
                          <span>حذف</span>
                        </ConfirmDropdownItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) {
            setEditing(null);
            setForm({ ...config.emptyRow });
          }
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {editing ? "ویرایش" : "ثبت جدید"} {config.title}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              {config.fields.map((field) => (
                <label key={field.key} className="grid gap-1.5 text-sm">
                  <span className="text-muted-foreground">{field.label}</span>
                  {field.type === "checkbox" ? (
                    <input
                      type="checkbox"
                      className="size-5 accent-primary"
                      checked={Boolean(form[field.key])}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          [field.key]: event.target.checked,
                        }))
                      }
                    />
                  ) : field.type === "select" ? (
                    <select
                      className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
                      value={String(form[field.key] ?? "")}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          [field.key]: event.target.value,
                        }))
                      }
                    >
                      {field.options?.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : /note|description/i.test(field.key) ||
                    /یادداشت|شرح|توضیح/.test(field.label) ? (
                    <textarea
                      value={String(form[field.key] ?? "")}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          [field.key]: event.target.value,
                        }))
                      }
                      rows={4}
                      className="min-h-24 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
                    />
                  ) : (
                    <Input
                      value={String(form[field.key] ?? "")}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          [field.key]: event.target.value,
                        }))
                      }
                    />
                  )}
                </label>
              ))}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsDialogOpen(false)}
              >
                لغو
              </Button>
              <Button type="submit" disabled={isSaving}>
                ذخیره
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export function SettingsPageRoute() {
  const [company, setCompany] = useState<GenericRow | null>(null);
  const [currencies, setCurrencies] = useState<GenericRow[]>([]);
  const [isSavingCompany, setIsSavingCompany] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);

  const baseCurrencyOptions = useMemo(
    () =>
      currencies.map((currency) => ({
        id: String(currency.id),
        name: `${currency.code} - ${currency.name}`,
      })),
    [currencies],
  );

  async function loadCompany() {
    try {
      const [companyResponse, currencyResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/api/settings/company`),
        fetch(`${API_BASE_URL}/api/currencies`),
      ]);
      const companyJson = await companyResponse.json().catch(() => null);
      const currencyJson = await currencyResponse.json().catch(() => null);

      if (!companyResponse.ok)
        throw new Error(companyJson?.message || "تنظیمات شرکت خوانده نشد");
      if (!currencyResponse.ok)
        throw new Error(currencyJson?.message || "کرنسی‌ها خوانده نشد");

      setCompany(companyJson.data);
      setCurrencies(currencyJson.data || []);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "تنظیمات خوانده نشد",
      );
    }
  }

  async function saveCompany(event: FormEvent) {
    event.preventDefault();
    if (!company) return;
    setIsSavingCompany(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/settings/company`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(company),
      });
      const json = await response.json().catch(() => null);

      if (!response.ok)
        throw new Error(json?.message || "ذخیره تنظیمات شرکت ناکام شد");

      toast.success("تنظیمات شرکت ذخیره شد");
      setCompany(json.data);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "ذخیره تنظیمات شرکت ناکام شد",
      );
    } finally {
      setIsSavingCompany(false);
    }
  }

  async function uploadLogo(file: File | null) {
    if (!file) return;
    setIsUploadingLogo(true);
    try {
      const body = new FormData();
      body.set("type", "logo");
      body.set("file", file);
      const response = await fetch(`${API_BASE_URL}/api/settings/receipt-image`, {
        method: "POST",
        body,
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) throw new Error(json?.message || "آپلود لوگو ناکام شد");
      setCompany(json.data.setting);
      toast.success("لوگوی فروشگاه ذخیره شد");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "آپلود لوگو ناکام شد");
    } finally {
      setIsUploadingLogo(false);
    }
  }

  useEffect(() => {
    void loadCompany();
  }, []);

  return (
    <div className="space-y-4">
      <Tabs>
        <div className="space-y-4">
          <TabsList>
            {resources.map((resource) => (
              <TabsTrigger value={resource.endpoint}>
                {resource.title}
              </TabsTrigger>
            ))}
            <TabsTrigger value={"companyProfile"}>پروفایل فروشگاه</TabsTrigger>
            <TabsTrigger value={"serverSettings"}>سرور و بکاپ</TabsTrigger>
          </TabsList>
          {resources.map((resource) => (
            <TabsContent value={resource.endpoint}>
              <ResourceCard key={resource.endpoint} config={resource} />
            </TabsContent>
          ))}
          <TabsContent value={"companyProfile"}>
            <Card className="border-border bg-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="size-5 text-primary" />
                  پروفایل فروشگاه
                </CardTitle>
                <CardDescription>
                  نام فروشگاه، شماره تماس، آدرس و کرنسی پیش‌فرض فاکتور.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  onSubmit={saveCompany}
                  className="grid gap-3 md:grid-cols-2"
                >
                  <label className="grid gap-1.5 text-sm">
                    <span className="text-muted-foreground">نام فروشگاه</span>
                    <Input
                      value={String(company?.companyName ?? "")}
                      onChange={(event) =>
                        setCompany((current) => ({
                          ...(current || {}),
                          companyName: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="grid gap-1.5 text-sm md:col-span-2">
                    <span className="text-muted-foreground">لوگوی فروشگاه برای چاپ‌ها</span>
                    <div className="flex flex-wrap items-center gap-3 border border-border bg-background/60 p-3">
                      {company?.logoImage ? (
                        <img
                          src={`${API_BASE_URL}${String(company.logoImage)}`}
                          alt="لوگوی فروشگاه"
                          className="size-20 object-contain"
                        />
                      ) : (
                        <div className="grid size-20 place-items-center border border-dashed border-border text-muted-foreground">
                          <ImageUp className="size-7" />
                        </div>
                      )}
                      <Input
                        type="file"
                        accept="image/*"
                        disabled={isUploadingLogo}
                        onChange={(event) => void uploadLogo(event.target.files?.[0] || null)}
                        className="max-w-sm"
                      />
                    </div>
                  </label>
                  <label className="grid gap-1.5 text-sm">
                    <span className="text-muted-foreground">شماره تماس</span>
                    <Input
                      value={String(company?.phone ?? "")}
                      onChange={(event) =>
                        setCompany((current) => ({
                          ...(current || {}),
                          phone: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="grid gap-1.5 text-sm md:col-span-2">
                    <span className="text-muted-foreground">آدرس</span>
                    <Input
                      value={String(company?.address ?? "")}
                      onChange={(event) =>
                        setCompany((current) => ({
                          ...(current || {}),
                          address: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="grid gap-1.5 text-sm">
                    <span className="text-muted-foreground">کرنسی پیش‌فرض</span>
                    <Combobox
                      value={String(company?.defaultCurrencyId ?? "")}
                      placeholder="انتخاب نشده"
                      onValueChange={(value) =>
                        setCompany((current) => ({
                          ...(current || {}),
                          defaultCurrencyId: value || null,
                        }))
                      }
                      options={[
                        { value: "", label: "انتخاب نشده" },
                        ...baseCurrencyOptions.map((currency) => ({
                          value: currency.id,
                          label: currency.name,
                        })),
                      ]}
                    />
                  </label>
                  <div className="flex items-end justify-end">
                    <Button
                      type="submit"
                      disabled={isSavingCompany || !company}
                    >
                      ذخیره پروفایل
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value={"serverSettings"}>
            <ServerSettingsCard />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
