import {
  AlertTriangle,
  ArrowLeftRight,
  GitMerge,
  Pencil,
  RefreshCcw,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { ConfirmButton } from "@/components/ui/confirm-action";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { API_BASE_URL } from "@/lib/api-config";

type DuplicateProduct = {
  id: string;
  name: string;
  barcode: string | null;
};

type DuplicateGroup = {
  normalized: string;
  count: number;
  products: DuplicateProduct[];
};

type MergeCounts = {
  stockBalances: number;
  stockLots: number;
  stockMovements: number;
  purchaseItems: number;
  purchaseReturnItems: number;
  saleItems: number;
  saleReturnItems: number;
};

type MergeProductSummary = DuplicateProduct & {
  sku: string | null;
  stock: Array<{
    warehouseId: string;
    warehouseName: string;
    quantityBase: number;
    valueBase: number;
  }>;
  counts: MergeCounts;
};

type MergePreview = {
  canMerge: boolean;
  normalizedBarcode: string;
  blockers: string[];
  warnings: string[];
  source: MergeProductSummary;
  target: MergeProductSummary;
  combined: {
    quantityBase: number;
    valueBase: number;
    counts: MergeCounts;
  };
};

type ProductDuplicatesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEditProduct: (productId: string) => void;
  onMerged: () => void | Promise<void>;
};

function number(value: number) {
  return new Intl.NumberFormat("fa-AF", {
    maximumFractionDigits: 4,
  }).format(Number(value || 0));
}

function documentCount(counts: MergeCounts) {
  return (
    counts.purchaseItems +
    counts.purchaseReturnItems +
    counts.saleItems +
    counts.saleReturnItems
  );
}

async function responseJson(response: Response, fallback: string) {
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(json?.message || fallback);
  }
  return json;
}

function ProductSummary({
  label,
  product,
}: {
  label: string;
  product: MergeProductSummary;
}) {
  const stockQuantity = product.stock.reduce(
    (sum, row) => sum + Number(row.quantityBase || 0),
    0,
  );
  const stockValue = product.stock.reduce(
    (sum, row) => sum + Number(row.valueBase || 0),
    0,
  );

  return (
    <section className="min-w-0 rounded-md border border-border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Badge variant="outline">{product.barcode || "بدون بارکد"}</Badge>
      </div>
      <div className="truncate text-sm font-medium" title={product.name}>
        {product.name}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div>
          <div className="text-muted-foreground">موجودی</div>
          <div className="mt-1 font-medium">{number(stockQuantity)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">ارزش پایه</div>
          <div className="mt-1 font-medium">{number(stockValue)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">اسناد مرتبط</div>
          <div className="mt-1 font-medium">
            {number(documentCount(product.counts))}
          </div>
        </div>
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        {number(product.counts.stockLots)} لات و {number(product.counts.stockMovements)} حرکت موجودی
      </div>
    </section>
  );
}

export function ProductDuplicatesDialog({
  open,
  onOpenChange,
  onEditProduct,
  onMerged,
}: ProductDuplicatesDialogProps) {
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [selectedNormalized, setSelectedNormalized] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const duplicateRequestRef = useRef<AbortController | null>(null);
  const previewRequestRef = useRef<AbortController | null>(null);

  const selectedGroup = useMemo(
    () => groups.find((group) => group.normalized === selectedNormalized) || null,
    [groups, selectedNormalized],
  );

  const selectGroup = (group: DuplicateGroup | null) => {
    setSelectedNormalized(group?.normalized || "");
    setTargetId(group?.products[0]?.id || "");
    setSourceId(group?.products[1]?.id || "");
    setPreview(null);
  };

  const loadDuplicates = async (preferredNormalized = selectedNormalized) => {
    duplicateRequestRef.current?.abort();
    const controller = new AbortController();
    duplicateRequestRef.current = controller;
    setIsLoading(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/products/barcode-duplicates`,
        { signal: controller.signal },
      );
      const json = await responseJson(
        response,
        "خواندن بارکدهای تکراری ناکام شد",
      );
      const nextGroups = Array.isArray(json?.data) ? json.data : [];
      setGroups(nextGroups);
      const nextGroup =
        nextGroups.find(
          (group: DuplicateGroup) => group.normalized === preferredNormalized,
        ) || nextGroups[0] || null;
      selectGroup(nextGroup);
    } catch (error) {
      if ((error as Error)?.name !== "AbortError") {
        toast.error(
          error instanceof Error
            ? error.message
            : "خواندن بارکدهای تکراری ناکام شد",
        );
      }
    } finally {
      if (duplicateRequestRef.current === controller) {
        duplicateRequestRef.current = null;
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!open) {
      duplicateRequestRef.current?.abort();
      previewRequestRef.current?.abort();
      return;
    }

    void loadDuplicates();
    return () => {
      duplicateRequestRef.current?.abort();
      previewRequestRef.current?.abort();
    };
  }, [open]);

  useEffect(() => {
    previewRequestRef.current?.abort();
    setPreview(null);
    if (!open || !sourceId || !targetId || sourceId === targetId) return;

    const controller = new AbortController();
    previewRequestRef.current = controller;
    setIsPreviewLoading(true);
    const params = new URLSearchParams({ sourceId, targetId });

    fetch(`${API_BASE_URL}/api/products/merge-preview?${params}`, {
      signal: controller.signal,
    })
      .then((response) =>
        responseJson(response, "بررسی امکان ادغام محصولات ناکام شد"),
      )
      .then((json) => setPreview(json?.data || null))
      .catch((error) => {
        if ((error as Error)?.name !== "AbortError") {
          toast.error(
            error instanceof Error
              ? error.message
              : "بررسی امکان ادغام محصولات ناکام شد",
          );
        }
      })
      .finally(() => {
        if (previewRequestRef.current === controller) {
          previewRequestRef.current = null;
          setIsPreviewLoading(false);
        }
      });

    return () => controller.abort();
  }, [open, sourceId, targetId]);

  const mergeProducts = async () => {
    if (!preview?.canMerge || isMerging) return;
    setIsMerging(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/products/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId, targetId, confirm: true }),
      });
      await responseJson(response, "ادغام محصولات ناکام شد");
      toast.success("محصولات با موفقیت ادغام شدند");
      await Promise.resolve(onMerged());
      await loadDuplicates(selectedNormalized);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "ادغام محصولات ناکام شد",
      );
    } finally {
      setIsMerging(false);
    }
  };

  const groupOptions = groups.map((group) => ({
    value: group.normalized,
    label: `${group.normalized} (${number(group.count)} محصول)`,
  }));
  const productOptions =
    selectedGroup?.products.map((product) => ({
      value: product.id,
      label: product.name,
      description: product.barcode || "بدون بارکد",
      barcode: product.barcode,
    })) || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMerge className="size-5 text-primary" />
            مدیریت بارکدهای تکراری
          </DialogTitle>
          <DialogDescription>
            ابتدا پیش‌نمایش را بررسی کنید. مشخصات و قیمت‌های محصول مقصد حفظ و سوابق محصول مبدا به آن منتقل می‌شود.
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[72vh] gap-4 overflow-y-auto pe-1">
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <div className="mb-1.5 text-xs text-muted-foreground">
                گروه بارکد تکراری
              </div>
              <Combobox
                value={selectedNormalized}
                onValueChange={(value) =>
                  selectGroup(
                    groups.find((group) => group.normalized === value) || null,
                  )
                }
                options={groupOptions}
                placeholder={
                  isLoading ? "در حال بررسی..." : "بارکد تکراری انتخاب کنید"
                }
                searchPlaceholder="جستجوی بارکد..."
                emptyText="بارکد تکراری پیدا نشد"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              title="تازه‌سازی"
              onClick={() => void loadDuplicates()}
              disabled={isLoading}
            >
              <RefreshCcw className={isLoading ? "animate-spin" : ""} />
            </Button>
          </div>

          {!isLoading && groups.length === 0 ? (
            <div className="rounded-md border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
              بارکد نرمال‌شده تکراری در محصولات فعال پیدا نشد.
            </div>
          ) : null}

          {selectedGroup ? (
            <>
              <div className="grid items-end gap-2 md:grid-cols-[1fr_auto_1fr]">
                <div>
                  <div className="mb-1.5 text-xs text-muted-foreground">
                    محصول مبدا؛ پس از ادغام غیرفعال می‌شود
                  </div>
                  <Combobox
                    value={sourceId}
                    onValueChange={setSourceId}
                    options={productOptions}
                    placeholder="محصول مبدا"
                    searchPlaceholder="جستجوی محصول..."
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  title="تعویض مبدا و مقصد"
                  onClick={() => {
                    setSourceId(targetId);
                    setTargetId(sourceId);
                  }}
                  disabled={!sourceId || !targetId}
                >
                  <ArrowLeftRight />
                </Button>
                <div>
                  <div className="mb-1.5 text-xs text-muted-foreground">
                    محصول مقصد؛ نام و قیمت‌های آن حفظ می‌شود
                  </div>
                  <Combobox
                    value={targetId}
                    onValueChange={setTargetId}
                    options={productOptions}
                    placeholder="محصول مقصد"
                    searchPlaceholder="جستجوی محصول..."
                  />
                </div>
              </div>

              {isPreviewLoading ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  در حال محاسبه پیش‌نمایش امن ادغام...
                </div>
              ) : null}

              {preview ? (
                <>
                  <Separator />
                  <div className="grid gap-3 md:grid-cols-2">
                    <ProductSummary label="مبدا" product={preview.source} />
                    <ProductSummary label="مقصد" product={preview.target} />
                  </div>

                  <section className="rounded-md border border-border p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">نتیجه ادغام</span>
                      <Badge
                        className={
                          preview.canMerge
                            ? "bg-emerald-500/15 text-emerald-600"
                            : "bg-destructive/15 text-destructive"
                        }
                      >
                        {preview.canMerge ? "آماده ادغام" : "ادغام مسدود است"}
                      </Badge>
                    </div>
                    <div className="grid gap-2 text-xs sm:grid-cols-3">
                      <div>
                        موجودی نهایی: <strong>{number(preview.combined.quantityBase)}</strong>
                      </div>
                      <div>
                        ارزش پایه نهایی: <strong>{number(preview.combined.valueBase)}</strong>
                      </div>
                      <div>
                        اسناد مرتبط: <strong>{number(documentCount(preview.combined.counts))}</strong>
                      </div>
                    </div>
                  </section>

                  {preview.blockers.length > 0 ? (
                    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                      <div className="mb-2 flex items-center gap-2 font-medium">
                        <AlertTriangle className="size-4" />
                        موانع ادغام
                      </div>
                      {preview.blockers.map((message) => (
                        <div key={message}>• {message}</div>
                      ))}
                    </div>
                  ) : null}

                  {preview.warnings.length > 0 ? (
                    <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-300">
                      <div className="mb-2 flex items-center gap-2 font-medium">
                        <AlertTriangle className="size-4" />
                        مواردی که مقصد بر مبدا ترجیح داده می‌شود
                      </div>
                      {preview.warnings.map((message) => (
                        <div key={message}>• {message}</div>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              if (sourceId) onEditProduct(sourceId);
            }}
            disabled={!sourceId || isMerging}
          >
            <Pencil />
            ویرایش بارکد مبدا
          </Button>
          <ConfirmButton
            type="button"
            variant="destructive"
            disabled={!preview?.canMerge || isMerging}
            title="تأیید ادغام محصولات"
            description={`تمام موجودی و سوابق «${preview?.source.name || "محصول مبدا"}» به «${preview?.target.name || "محصول مقصد"}» منتقل می‌شود. این عملیات فقط با بک‌آپ معتبر انجام شود.`}
            confirmLabel="ادغام نهایی"
            onConfirm={() => void mergeProducts()}
          >
            {isMerging ? (
              <RefreshCcw className="animate-spin" />
            ) : (
              <ShieldCheck />
            )}
            ادغام امن
          </ConfirmButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
