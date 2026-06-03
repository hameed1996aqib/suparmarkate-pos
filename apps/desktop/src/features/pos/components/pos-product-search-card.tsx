import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  Barcode,
  BottleWine,
  Grid2X2,
  Package,
  Plus,
  Search,
  SlidersHorizontal,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

import type { ProductSearchItem } from "../types";

type PosProductSearchCardProps = {
  searchTerm: string;
  products: ProductSearchItem[];
  categories: Array<{ id: string; name: string; count: number }>;
  activeCategoryId: string;
  isLoading: boolean;
  warehouseName?: string;
  currencyCode?: string;
  currencyRate?: number;
  apiBaseUrl?: string;
  isWsConnected: boolean;
  onSearchChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onAddProduct: (barcode: string) => void;
  onScanBarcode: (barcode: string) => void;
};

export type PosProductSearchCardRef = {
  focusBarcode: () => void;
  clearBarcode: () => void;
};

function getDefaultSalePrice(product: ProductSearchItem) {
  const unit =
    product.units?.find((item) => item.isDefaultSale) || product.units?.[0];

  return Number(unit?.salePrice || 0);
}

function getUnitName(product: ProductSearchItem) {
  const unit =
    product.units?.find((item) => item.isDefaultSale) || product.units?.[0];

  return (
    unit?.unit?.shortName ||
    unit?.unit?.name ||
    product.baseUnit?.shortName ||
    product.baseUnit?.name ||
    "واحد"
  );
}

function getProductVisual(
  product: ProductSearchItem,
  index: number,
  apiBaseUrl = "",
) {
  if (product.imageUrl) {
    const src = product.imageUrl.startsWith("http")
      ? product.imageUrl
      : `${apiBaseUrl}${product.imageUrl}`;

    return (
      <img
        src={src}
        alt={product.name}
        className="h-full w-full object-cover"
      />
    );
  }

  const name = product.name.toLowerCase();

  if (name.includes("شیر") || name.includes("کولا") || name.includes("نوش")) {
    return <BottleWine className="h-14 w-14" />;
  }

  if (index % 3 === 0) {
    return <Barcode className="h-14 w-14" />;
  }

  return <Package className="h-14 w-14" />;
}

function productAvailability(product: ProductSearchItem) {
  if (product.isActive === false) {
    return {
      label: "غیرفعال",
      className: "bg-muted text-muted-foreground",
    };
  }

  if (!product.barcode) {
    return {
      label: "بدون بارکود",
      className: "bg-amber-500/15 text-amber-300",
    };
  }

  return {
    label: "موجود",
    className: "bg-emerald-500/15 text-emerald-400",
  };
}

export const PosProductSearchCard = forwardRef<
  PosProductSearchCardRef,
  PosProductSearchCardProps
>(function PosProductSearchCard(
  {
    searchTerm,
    products,
    categories,
    activeCategoryId,
    isLoading,
    warehouseName,
    currencyCode,
    currencyRate = 1,
    apiBaseUrl,
    isWsConnected,
    onSearchChange,
    onCategoryChange,
    onAddProduct,
    onScanBarcode,
  },
  ref,
) {
  const barcodeInputRef = useRef<HTMLInputElement | null>(null);
  const [barcode, setBarcode] = useState("");

  useImperativeHandle(ref, () => ({
    focusBarcode() {
      barcodeInputRef.current?.focus();
    },
    clearBarcode() {
      setBarcode("");
      barcodeInputRef.current?.focus();
    },
  }));

  function submitBarcode() {
    const value = barcode.trim();

    if (!value) {
      barcodeInputRef.current?.focus();
      return;
    }

    onScanBarcode(value);
    setBarcode("");
    setTimeout(() => barcodeInputRef.current?.focus(), 50);
  }

  function handleBarcodeKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      submitBarcode();
    }
  }

  return (
    <Card className="overflow-hidden border-border bg-card shadow-sm  ">
      <CardHeader className="gap-3">
        <div className="grid gap-3 xl:grid-cols-[260px_1fr_auto]">
          <div className="relative">
            <Barcode className="pointer-events-none absolute start-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={barcodeInputRef}
              value={barcode}
              onChange={(event) => setBarcode(event.target.value)}
              onKeyDown={handleBarcodeKeyDown}
              placeholder="اسکن بارکود"
              className="h-12 ps-11 font-bold"
              dir="ltr"
            />
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchTerm}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="جستجوی محصول با نام، بارکود یا کد"
              className="h-12 ps-10"
            />
          </div>

          <Button className="h-12 gap-2 px-5" onClick={submitBarcode}>
            <Barcode className="h-5 w-5" />
            افزودن
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border/70 pt-3">
          <Button
            size="sm"
            className="gap-2"
            variant={activeCategoryId === "all" ? "default" : "ghost"}
            onClick={() => onCategoryChange("all")}
          >
            <Grid2X2 className="h-4 w-4" />
            همه محصولات
          </Button>
          {categories.slice(0, 6).map((item) => (
            <Button
              key={item.id}
              size="sm"
              variant={activeCategoryId === item.id ? "default" : "ghost"}
              onClick={() => onCategoryChange(item.id)}
            >
              {item.name}
              <Badge
                variant="secondary"
                className="ms-1 h-5 px-1.5 text-[10px]"
              >
                {item.count}
              </Badge>
            </Button>
          ))}
          <Button size="icon-sm" variant="outline" className="me-auto">
            <SlidersHorizontal className="h-4 w-4" />
          </Button>
          <Badge variant={isWsConnected ? "default" : "secondary"}>
            {isWsConnected ? "Sync فعال" : "HTTP fallback"}
          </Badge>
          <span className="text-xs text-muted-foreground">
            گدام فعال:{" "}
            <span className="font-medium text-foreground">
              {warehouseName || "-"}
            </span>
          </span>
        </div>
      </CardHeader>

      <CardContent>
        <ScrollArea className="h-[96.5vh] rounded-xl">
          <div className="grid gap-3 p-1 sm:grid-cols-2 2xl:grid-cols-4">
            {isLoading ? (
              <div className="col-span-full rounded-xl border border-border bg-muted/20 py-12 text-center text-sm text-muted-foreground">
                در حال دریافت محصولات...
              </div>
            ) : products.length ? (
              products.map((product, index) => {
                const hasBarcode = Boolean(product.barcode);
                const price = getDefaultSalePrice(product) / currencyRate;
                const availability = productAvailability(product);

                return (
                  <div
                    key={product.id}
                    className="group relative grid min-h-[210px] overflow-hidden rounded-xl border border-border bg-card p-3 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/45 hover:shadow-lg"
                  >
                    <div className="pointer-events-none absolute -start-10 -top-10 size-28 rounded-full bg-primary/10 blur-2xl transition group-hover:bg-primary/20" />
                    <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-primary/30" />

                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="grid gap-5">
                        <Badge className={availability.className}>
                          {availability.label}
                        </Badge>
                        <div className="line-clamp-2 min-h-10 text-sm font-bold leading-6">
                          {product.name}
                        </div>
                      </div>
                      <div className="grid h-28 w-28 place-items-center overflow-hidden rounded-xl border border-border/80 bg-background/75 text-primary shadow-inner transition group-hover:scale-[1.02]">
                        {getProductVisual(product, index, apiBaseUrl)}
                      </div>
                    </div>

                    <div className="grid gap-2">
                      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span>واحد: {getUnitName(product)}</span>
                        <span dir="ltr" className="font-mono">
                          {product.sku || product.barcode || "-"}
                        </span>
                      </div>
                    </div>

                    <div className="mt-auto flex items-end justify-between gap-3">
                      <Button
                        size="icon"
                        variant="outline"
                        disabled={!hasBarcode || product.isActive === false}
                        onClick={() => onAddProduct(product.barcode || "")}
                        className="size-9 rounded-xl border-primary/35 bg-primary/10 text-primary shadow-sm hover:bg-primary hover:text-primary-foreground"
                        title="افزودن به فاکتور"
                      >
                        <Plus className="h-5 w-5" />
                      </Button>

                      <div className="text-end">
                        <div className="text-lg font-black text-primary">
                          {new Intl.NumberFormat("en-US").format(price)}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {currencyCode || "AFN"}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="col-span-full rounded-xl border border-border bg-muted/20 py-16 text-center text-sm text-muted-foreground">
                محصولی پیدا نشد.
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
});
