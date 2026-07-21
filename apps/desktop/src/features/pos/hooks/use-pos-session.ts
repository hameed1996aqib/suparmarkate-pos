import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  clearPosCart,
  createPosSession,
  deleteHeldCart,
  getHeldCarts,
  getPosCart,
  holdCart,
  loadCustomers,
  loadPosDefaults,
  loadProducts,
  removeCartItem,
  restoreHeldCart,
  postSaleCogsJournal,
  scanPosBarcode,
  submitPosSale,
  updateCartItem,
  updatePosSessionSettings,
} from "../api";
import type {
  CartPayload,
  BankAccount,
  CashRegister,
  Currency,
  CustomerOption,
  HeldCart,
  PosSessionResponse,
  PosShiftSummary,
  ProductSearchItem,
  ServerCart,
  ServerCartSummary,
  Warehouse,
} from "../types";
import { getApiBaseUrl } from "../utils";

type SubmitSaleOptions = {
  printReceipt?: boolean;
};

const defaultVisiblePosMetricIds = [
  "todaySales",
  "invoiceCount",
  "creditSales",
  "averageBasket",
  "activeCashRegister",
];

export function usePosSession() {
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const productRequestSeqRef = useRef(0);
  const pendingScanBarcodeRef = useRef<string | null>(null);

  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [apiBaseUrlOverride, setApiBaseUrlOverrideState] = useState(() => {
    return localStorage.getItem("muhaseb_api_base_url_override") || "";
  });
  const [session, setSession] = useState<PosSessionResponse["data"] | null>(null);
  const [isWsConnected, setIsWsConnected] = useState(false);
  const [status, setStatus] = useState("در حال آماده‌سازی صندوق فروش...");

  const [cart, setCart] = useState<ServerCart | null>(null);
  const [highlightedCartItemKey, setHighlightedCartItemKey] = useState<string | null>(null);
  const [summary, setSummary] = useState<ServerCartSummary | null>(null);
  const [heldCarts, setHeldCarts] = useState<HeldCart[]>([]);

  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [cashRegisters, setCashRegisters] = useState<CashRegister[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);

  const [currency, setCurrency] = useState<Currency | null>(null);
  const [warehouse, setWarehouse] = useState<Warehouse | null>(null);
  const [cashAccountId, setCashAccountIdState] = useState("");
  const [bankAccountId, setBankAccountIdState] = useState("");
  const [paymentMethod, setPaymentMethodState] = useState<"CASH" | "CARD" | "SPLIT">("CASH");

  const [products, setProducts] = useState<ProductSearchItem[]>([]);
  const [productCategories, setProductCategories] = useState<
    Array<{ id: string; name: string; count: number }>
  >([]);
  const [productPagination, setProductPagination] = useState({
    offset: 0,
    limit: 60,
    total: 0,
    hasMore: false,
    nextOffset: 0,
  });
  const [productSearchTerm, setProductSearchTerm] = useState("");
  const [productCategoryId, setProductCategoryId] = useState("all");
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  const [isLoadingMoreProducts, setIsLoadingMoreProducts] = useState(false);

  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [customerSearchTerm, setCustomerSearchTerm] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerOption | null>(null);
  const [customerLabel, setCustomerLabel] = useState("");
  const [saleNote, setSaleNote] = useState("");
  const [isLoadingCustomers, setIsLoadingCustomers] = useState(false);

  const [lastSaleId, setLastSaleId] = useState<string | null>(null);
  const [lastCogsStatus, setLastCogsStatus] = useState<{
    status: "none" | "posted" | "skipped" | "error";
    message: string;
    total: number;
  }>({
    status: "none",
    message: "",
    total: 0,
  });
  const [lastReceiptUrl, setLastReceiptUrl] = useState<string | null>(() => {
    return localStorage.getItem("muhaseb_last_receipt_url") || null;
  });

  const [paidAmount, setPaidAmount] = useState(0);
  const [splitCashAmount, setSplitCashAmount] = useState(0);
  const [splitCardAmount, setSplitCardAmount] = useState(0);
  const [invoiceDiscount, setInvoiceDiscount] = useState(0);
  const [isBooting, setIsBooting] = useState(true);

  const [shift, setShift] = useState<PosShiftSummary>(() => {
    const saved = localStorage.getItem("muhaseb_pos_shift_v1");

    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // ignore invalid saved shift
      }
    }

    return {
      id: `${Date.now()}`,
      openedAt: new Date().toISOString(),
      closedAt: null,
      sales: [],
    };
  });

  const [receiptWidthMm, setReceiptWidthMmState] = useState<number>(() => {
    const saved = Number(localStorage.getItem("muhaseb_receipt_width_mm") || 80);
    return saved === 58 ? 58 : 80;
  });
  const [receiptPrinterName, setReceiptPrinterNameState] = useState(() => {
    return localStorage.getItem("muhaseb_receipt_printer_name") || "";
  });
  const [receiptSilentPrint, setReceiptSilentPrintState] = useState(() => {
    return localStorage.getItem("muhaseb_receipt_silent_print") === "true";
  });
  const [receiptMarginLeftMm, setReceiptMarginLeftMmState] = useState(() => {
    return Number(localStorage.getItem("muhaseb_receipt_margin_left_mm") || 1.5);
  });
  const [receiptMarginRightMm, setReceiptMarginRightMmState] = useState(() => {
    return Number(localStorage.getItem("muhaseb_receipt_margin_right_mm") || 1.5);
  });
  const [visibleMetricIds, setVisibleMetricIds] = useState<string[]>(() => {
    const saved = localStorage.getItem("muhaseb_pos_visible_metric_ids");

    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed.map(String);
      } catch {
        // ignore invalid saved metric settings
      }
    }

    return defaultVisiblePosMetricIds;
  });

  const cartItems = cart?.items || [];

  const subtotal = useMemo(() => {
    return summary?.total ?? cartItems.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0);
  }, [summary, cartItems]);

  const payableTotal = useMemo(() => {
    return Math.max(0, subtotal - Number(invoiceDiscount || 0));
  }, [subtotal, invoiceDiscount]);

  const itemsCount = useMemo(() => {
    return summary?.itemsCount ?? cartItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  }, [summary, cartItems]);

  const effectivePaidAmount = paidAmount > 0 ? paidAmount : payableTotal;

  const remainingAmount = useMemo(() => {
    return Math.max(0, payableTotal - effectivePaidAmount);
  }, [payableTotal, effectivePaidAmount]);

  const changeAmount = useMemo(() => {
    return Math.max(0, effectivePaidAmount - payableTotal);
  }, [payableTotal, effectivePaidAmount]);

  const filteredCustomers = useMemo(() => {
    return customers.slice(0, 50);
  }, [customers]);

  const hasCartStockIssue = cartItems.some((item) => {
    const requiredBaseQuantity =
      Number(item.quantity || 0) * Number(item.conversionRate || 1);
    return requiredBaseQuantity > Number(item.totalStock || 0);
  });
  const selectedCustomerPartyId =
    selectedCustomer?.source?.includes("/api/parties") ||
    selectedCustomer?.source?.includes("/api/accounting/parties")
      ? selectedCustomer.id
      : null;

  const readinessIssues = useMemo(() => {
    const issues: string[] = [];

    if (!apiBaseUrl) issues.push("API آماده نیست");
    if (!session?.session.id) issues.push("جلسه فروش ساخته نشده است");
    if (!currency?.id) issues.push("کرنسی اصلی تنظیم نشده است");
    if (
      (paymentMethod === "CASH" || (paymentMethod === "SPLIT" && splitCashAmount > 0)) &&
      !cashAccountId
    ) {
      issues.push("حساب صندوق نقدی تنظیم نشده است");
    }
    if (paymentMethod === "CARD" && !bankAccountId) {
      issues.push("حساب بانکی برای پرداخت کارت تنظیم نشده است");
    }
    if (paymentMethod === "SPLIT" && splitCardAmount > 0 && !bankAccountId) {
      issues.push("حساب بانکی برای پرداخت ترکیبی تنظیم نشده است");
    }
    if (!cartItems.length) issues.push("سبد فروش خالی است");

    if (hasCartStockIssue) {
      issues.push("تعداد بعضی محصولات بیشتر از موجودی قابل فروش است");
    }

    if (Number(invoiceDiscount || 0) > subtotal) {
      issues.push("تخفیف کلی از جمع اجناس بیشتر است");
    }

    if (payableTotal > 0 && effectivePaidAmount < payableTotal && !selectedCustomerPartyId) {
      issues.push("برای فروش نسیه باید مشتری انتخاب شود");
    }

    return issues;
  }, [
    apiBaseUrl,
    apiBaseUrlOverride,
    setApiBaseUrlOverride,
    session,
    currency,
    cashAccountId,
    bankAccountId,
    paymentMethod,
    splitCashAmount,
    splitCardAmount,
    cartItems.length,
    hasCartStockIssue,
    invoiceDiscount,
    subtotal,
    payableTotal,
    effectivePaidAmount,
    selectedCustomerPartyId,
  ]);

  const canSubmitSale = readinessIssues.length === 0;
  const saleDisabledReason = readinessIssues[0] || "";

  const shiftStats = useMemo(() => {
    const invoiceCount = shift.sales.length;
    const totalSales = shift.sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
    const totalPaid = shift.sales.reduce((sum, sale) => sum + Number(sale.paidAmount || 0), 0);
    const totalChange = shift.sales.reduce((sum, sale) => sum + Number(sale.changeAmount || 0), 0);
    const netCash = totalPaid - totalChange;

    return {
      invoiceCount,
      totalSales,
      totalPaid,
      totalChange,
      netCash,
    };
  }, [shift]);

  useEffect(() => {
    setPaidAmount(payableTotal);
    setSplitCashAmount(payableTotal);
    setSplitCardAmount(0);
  }, [payableTotal]);

  function setApiBaseUrlOverride(value: string) {
    const nextValue = value.trim();

    if (nextValue) {
      localStorage.setItem("muhaseb_api_base_url_override", nextValue);
    } else {
      localStorage.removeItem("muhaseb_api_base_url_override");
    }

    setApiBaseUrlOverrideState(nextValue);
  }

  function getEffectiveApiBaseUrl() {
    const configuredBaseUrl = getApiBaseUrl();
    const override = apiBaseUrlOverride.trim();
    if (!override) return configuredBaseUrl;

    try {
      const overrideUrl = new URL(override);
      const configuredUrl = new URL(configuredBaseUrl);
      const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);

      if (
        localHosts.has(overrideUrl.hostname) &&
        !localHosts.has(configuredUrl.hostname)
      ) {
        return configuredBaseUrl;
      }
    } catch {
      return configuredBaseUrl;
    }

    return override;
  }

  function buildPosWebSocketUrl(baseUrl: string, sessionId: string) {
    const api = new URL(baseUrl);
    const protocol = api.protocol === "https:" ? "wss:" : "ws:";
    const port = import.meta.env.VITE_POS_WS_PORT || "4001";

    return `${protocol}//${api.hostname}:${port}?sessionId=${encodeURIComponent(sessionId)}&clientType=desktop`;
  }

  function normalizeCartBarcode(value?: string | null) {
    const digitMap: Record<string, string> = {
      "۰": "0",
      "۱": "1",
      "۲": "2",
      "۳": "3",
      "۴": "4",
      "۵": "5",
      "۶": "6",
      "۷": "7",
      "۸": "8",
      "۹": "9",
      "٠": "0",
      "١": "1",
      "٢": "2",
      "٣": "3",
      "٤": "4",
      "٥": "5",
      "٦": "6",
      "٧": "7",
      "٨": "8",
      "٩": "9",
    };

    return String(value || "")
      .trim()
      .replace(/[۰-۹٠-٩]/g, (digit) => digitMap[digit] || digit)
      .replace(/[\s\u200b\u200c\u200d\u2060-]/g, "")
      .toLowerCase();
  }

  function findHighlightedCartItemKey(
    nextCart: ServerCart,
    previousCart?: ServerCart | null,
    barcode?: string | null,
  ) {
    const normalizedBarcode = normalizeCartBarcode(barcode);

    if (normalizedBarcode) {
      const barcodeMatch = [...nextCart.items]
        .reverse()
        .find((item) => normalizeCartBarcode(item.barcode) === normalizedBarcode);

      if (barcodeMatch) return barcodeMatch.key;
    }

    if (previousCart) {
      const previousByKey = new Map(previousCart.items.map((item) => [item.key, item]));
      const changedItem = nextCart.items.find((item) => {
        const previousItem = previousByKey.get(item.key);
        return !previousItem || Number(item.quantity || 0) > Number(previousItem.quantity || 0);
      });

      if (changedItem) return changedItem.key;
    }

    return nextCart.items.at(-1)?.key || null;
  }

  function applyServerCart(
    payload?: Partial<CartPayload> | null,
    options?: { highlightBarcode?: string | null; highlightChangedItem?: boolean },
  ) {
    if (payload?.cart) {
      const nextCart = payload.cart;

      setCart((previousCart) => {
        if (!nextCart.items.length) {
          setHighlightedCartItemKey(null);
        } else if (options?.highlightChangedItem || options?.highlightBarcode) {
          const key = findHighlightedCartItemKey(
            nextCart,
            previousCart,
            options?.highlightBarcode,
          );

          if (key) setHighlightedCartItemKey(key);
        }

        return nextCart;
      });
    }
    if (payload?.summary) setSummary(payload.summary);
  }

  function applyOptimisticCartItemUpdate(
    key: string,
    input: {
      quantity?: number;
      unitId?: string;
      unitPrice?: number;
      discount?: number;
    },
  ) {
    setCart((currentCart) => {
      if (!currentCart) return currentCart;

      let changed = false;
      const items = currentCart.items.map((item) => {
        if (item.key !== key) return item;

        changed = true;

        const quantity =
          input.quantity === undefined ? item.quantity : Math.max(0.001, Number(input.quantity));
        const selectedUnit =
          input.unitId && input.unitId !== item.unitId
            ? item.unitOptions?.find((option) => option.unitId === input.unitId)
            : null;
        const unitId = selectedUnit?.unitId || item.unitId;
        const unitName = selectedUnit?.unitName || item.unitName;
        const conversionRate = selectedUnit?.conversionRate || item.conversionRate || 1;
        const nextKey = `${item.productId}:${unitId}:${item.warehouseId}`;
        const unitPrice =
          input.unitPrice !== undefined
            ? Math.max(0, Number(input.unitPrice))
            : selectedUnit
              ? Math.max(0, Number(selectedUnit.salePrice || 0))
              : item.unitPrice;
        const discount =
          input.discount === undefined ? item.discount : Math.max(0, Number(input.discount));

        return {
          ...item,
          key: nextKey,
          unitId,
          unitName,
          conversionRate,
          quantity,
          unitPrice,
          discount,
          lineTotal: Math.max(0, quantity * unitPrice - discount),
        };
      });

      if (!changed) return currentCart;

      const updatedAt = new Date().toISOString();

      setSummary({
        sessionId: currentCart.sessionId,
        itemsCount: items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
        total: items.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0),
        updatedAt,
      });

      return {
        ...currentCart,
        items,
        updatedAt,
      };
    });
  }

  function setReceiptWidthMm(value: number) {
    const nextValue = value === 58 ? 58 : 80;
    localStorage.setItem("muhaseb_receipt_width_mm", String(nextValue));
    setReceiptWidthMmState(nextValue);
  }

  function setReceiptPrinterName(value: string) {
    localStorage.setItem("muhaseb_receipt_printer_name", value);
    setReceiptPrinterNameState(value);
  }

  function setReceiptSilentPrint(value: boolean) {
    localStorage.setItem("muhaseb_receipt_silent_print", String(value));
    setReceiptSilentPrintState(value);
  }

  function setReceiptMarginLeftMm(value: number) {
    const nextValue = Number.isFinite(value) ? Math.max(0, value) : 0;
    localStorage.setItem("muhaseb_receipt_margin_left_mm", String(nextValue));
    setReceiptMarginLeftMmState(nextValue);
  }

  function setReceiptMarginRightMm(value: number) {
    const nextValue = Number.isFinite(value) ? Math.max(0, value) : 0;
    localStorage.setItem("muhaseb_receipt_margin_right_mm", String(nextValue));
    setReceiptMarginRightMmState(nextValue);
  }

  function setMetricVisibility(id: string, visible: boolean) {
    setVisibleMetricIds((currentIds) => {
      const nextIds = visible
        ? Array.from(new Set([...currentIds, id]))
        : currentIds.filter((item) => item !== id);

      localStorage.setItem("muhaseb_pos_visible_metric_ids", JSON.stringify(nextIds));
      return nextIds;
    });
  }

  function saveShift(nextShift: PosShiftSummary) {
    localStorage.setItem("muhaseb_pos_shift_v1", JSON.stringify(nextShift));
    setShift(nextShift);
  }

  function startNewShift() {
    const nextShift: PosShiftSummary = {
      id: `${Date.now()}`,
      openedAt: new Date().toISOString(),
      closedAt: null,
      sales: [],
    };

    saveShift(nextShift);
    toast.success("شیفت جدید شروع شد");
  }

  function recordShiftSale(input: {
    saleId: string;
    invoiceNo: string;
    receiptUrl?: string | null;
    total: number;
    paidAmount: number;
    changeAmount: number;
  }) {
    const nextShift: PosShiftSummary = {
      ...shift,
      sales: [
        ...shift.sales,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          saleId: input.saleId,
          invoiceNo: input.invoiceNo,
          receiptUrl: input.receiptUrl || null,
          total: input.total,
          paidAmount: input.paidAmount,
          changeAmount: input.changeAmount,
          createdAt: new Date().toISOString(),
        },
      ],
    };

    saveShift(nextShift);
  }

  function sendWsMessage(message: Record<string, unknown>) {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(message));
      return true;
    }

    return false;
  }

  function connectWebSocket(wsUrl: string) {
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    if (socketRef.current) socketRef.current.close();

    const ws = new WebSocket(wsUrl);
    socketRef.current = ws;

    ws.onopen = () => {
      setIsWsConnected(true);
      setStatus("صندوق فروش آماده است");
      toast.success("WebSocket وصل شد");
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        if (message.type === "CART_UPDATED") {
          const highlightBarcode = pendingScanBarcodeRef.current;
          applyServerCart(message.payload, {
            highlightBarcode,
            highlightChangedItem: Boolean(highlightBarcode),
          });
          pendingScanBarcodeRef.current = null;
          setStatus("سبد فروش بروزرسانی شد");
          return;
        }

        if (message.type === "HELD_CARTS_UPDATED") {
          setHeldCarts(message.payload?.heldCarts || []);
          return;
        }

        if (message.type === "BARCODE_SCANNED") {
          const productName = message.payload?.product?.name || "محصول";
          setStatus(`اسکن شد: ${productName}`);
          toast.success(`اسکن شد: ${productName}`);
          return;
        }

        if (message.type === "SCAN_ERROR") {
          pendingScanBarcodeRef.current = null;
          const msg = message.payload?.message || "خطا در اسکن بارکود";
          setStatus(msg);
          toast.error(msg);
        }
      } catch {
        // ignore invalid websocket payload
      }
    };

    ws.onclose = () => {
      setIsWsConnected(false);
      setStatus("WebSocket قطع شد؛ تلاش برای اتصال دوباره...");

      reconnectTimerRef.current = window.setTimeout(() => {
        connectWebSocket(wsUrl);
      }, 1500);
    };

    ws.onerror = () => {
      setIsWsConnected(false);
      setStatus("خطا در WebSocket");
    };
  }

  function setCashAccountId(value: string) {
    localStorage.setItem("muhaseb_pos_cash_account_id", value);
    setCashAccountIdState(value);
  }

  function setBankAccountId(value: string) {
    localStorage.setItem("muhaseb_pos_bank_account_id", value);
    setBankAccountIdState(value);
  }

  function setPaymentMethod(value: "CASH" | "CARD" | "SPLIT") {
    localStorage.setItem("muhaseb_pos_payment_method", value);
    setPaymentMethodState(value);
    setPaidAmount(payableTotal);

    if (value === "SPLIT") {
      setSplitCashAmount(payableTotal);
      setSplitCardAmount(0);
    }
  }

  function setSplitPayment(input: { cash?: number; card?: number }) {
    const nextCash =
      input.cash === undefined ? splitCashAmount : Math.max(0, Number(input.cash || 0));
    const nextCard =
      input.card === undefined ? splitCardAmount : Math.max(0, Number(input.card || 0));

    setSplitCashAmount(nextCash);
    setSplitCardAmount(nextCard);
    setPaidAmount(nextCash + nextCard);
  }

  function setCurrencyId(currencyId: string) {
    const nextCurrency = currencies.find((item) => item.id === currencyId) || null;
    if (!nextCurrency) return;
    const exchangeRate = nextCurrency.isBase ? 1 : Number(nextCurrency.latestRate || 0);

    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
      toast.error("برای این کرنسی نرخ فعال ثبت نشده است");
      return;
    }

    localStorage.setItem("muhaseb_pos_currency_id", nextCurrency.id);
    setCurrency(nextCurrency);

    if (
      !sendWsMessage({
        type: "SET_SESSION_SETTINGS",
        currencyId: nextCurrency.id,
        exchangeRate,
      }) &&
      apiBaseUrl &&
      session?.session.id
    ) {
      void updatePosSessionSettings(apiBaseUrl, session.session.id, {
        currencyId: nextCurrency.id,
        exchangeRate,
      }).catch((error: any) => {
        toast.error(error?.message || "تغییر کرنسی POS ناکام شد");
      });
    }

    const savedCashAccountId = localStorage.getItem("muhaseb_pos_cash_account_id") || "";

    const savedAccountStillValid = cashRegisters.some((register) =>
      register.accounts.some(
        (account) => account.id === savedCashAccountId && account.currencyId === nextCurrency.id
      )
    );

    if (savedAccountStillValid) {
      setCashAccountIdState(savedCashAccountId);
    } else {
      const firstMatchingAccount = cashRegisters
        .flatMap((register) => register.accounts)
        .find((account) => account.currencyId === nextCurrency.id);

      setCashAccountId(firstMatchingAccount?.id || "");
    }

    const savedBankAccountId = localStorage.getItem("muhaseb_pos_bank_account_id") || "";
    const savedBankStillValid = bankAccounts.some(
      (account) =>
        account.id === savedBankAccountId &&
        account.currencyId === nextCurrency.id &&
        account.isActive !== false,
    );
    const firstMatchingBank = bankAccounts.find(
      (account) => account.currencyId === nextCurrency.id && account.isActive !== false,
    );

    setBankAccountId(savedBankStillValid ? savedBankAccountId : firstMatchingBank?.id || "");
  }

  async function setWarehouseId(warehouseId: string) {
    const nextWarehouse = warehouses.find((item) => item.id === warehouseId) || null;
    if (!nextWarehouse) return;

    localStorage.setItem("muhaseb_pos_warehouse_id", nextWarehouse.id);
    setWarehouse(nextWarehouse);
    if (apiBaseUrl) {
      void loadProductList(apiBaseUrl, productSearchTerm, {
        warehouseId: nextWarehouse.id,
      });
    }

    if (sendWsMessage({ type: "SET_ACTIVE_WAREHOUSE", warehouseId: nextWarehouse.id })) {
      toast.success(`گدام فعال شد: ${nextWarehouse.name}`);
      return;
    }

    if (apiBaseUrl && session?.session.id) {
      await updatePosSessionSettings(apiBaseUrl, session.session.id, {
        warehouseId: nextWarehouse.id,
      });

      toast.success(`گدام فعال شد: ${nextWarehouse.name}`);
    }
  }

  async function loadProductList(
    baseUrl: string,
    search = productSearchTerm,
    input?: {
      categoryId?: string;
      warehouseId?: string | null;
    },
  ) {
    const requestSeq = productRequestSeqRef.current + 1;
    productRequestSeqRef.current = requestSeq;
    const nextCategoryId = input?.categoryId ?? productCategoryId;
    const nextWarehouseId = input?.warehouseId ?? warehouse?.id ?? null;

    try {
      setIsLoadingProducts(true);
      const res = await loadProducts(baseUrl, {
        search,
        categoryId: nextCategoryId,
        warehouseId: nextWarehouseId,
        offset: 0,
        limit: 60,
      });

      if (requestSeq !== productRequestSeqRef.current) return;

      setProducts(res.data || []);
      setProductPagination(res.pagination);
      setProductCategories(res.facets?.categories || []);
    } catch (error: any) {
      if (requestSeq !== productRequestSeqRef.current) return;
      toast.error(error?.message || "لیست محصولات دریافت نشد");
    } finally {
      if (requestSeq === productRequestSeqRef.current) {
        setIsLoadingProducts(false);
      }
    }
  }

  async function loadMoreProducts() {
    const baseUrl = apiBaseUrl || getEffectiveApiBaseUrl();

    if (!baseUrl || isLoadingProducts || isLoadingMoreProducts || !productPagination.hasMore) {
      return;
    }

    try {
      setIsLoadingMoreProducts(true);
      const requestSeq = productRequestSeqRef.current;
      const res = await loadProducts(baseUrl, {
        search: productSearchTerm,
        categoryId: productCategoryId,
        warehouseId: warehouse?.id || null,
        offset: productPagination.nextOffset,
        limit: 60,
      });

      if (requestSeq !== productRequestSeqRef.current) return;

      setProducts((current) => [...current, ...(res.data || [])]);
      setProductPagination(res.pagination);
      setProductCategories(res.facets?.categories || []);
    } catch (error: any) {
      toast.error(error?.message || "لیست محصولات دریافت نشد");
    } finally {
      setIsLoadingMoreProducts(false);
    }
  }

  async function refreshPosData() {
    const baseUrl = apiBaseUrl || getEffectiveApiBaseUrl();

    await Promise.all([
      loadProductList(baseUrl, productSearchTerm, {
        warehouseId: warehouse?.id || null,
      }),
      loadCustomerList(baseUrl, customerSearchTerm),
    ]);

    if (session?.session.id) {
      await refreshHeldCarts(baseUrl, session.session.id);
    }

    toast.success("اطلاعات POS بروزرسانی شد");
  }

  async function loadCustomerList(baseUrl: string, search = customerSearchTerm) {
    try {
      setIsLoadingCustomers(true);
      const res = await loadCustomers(baseUrl, search);
      setCustomers(res.data || []);
    } catch {
      setCustomers([]);
    } finally {
      setIsLoadingCustomers(false);
    }
  }

  async function refreshHeldCarts(baseUrl = apiBaseUrl, sessionId = session?.session.id || "") {
    if (!baseUrl || !sessionId) return;

    const res = await getHeldCarts(baseUrl, sessionId);
    setHeldCarts(res.data.heldCarts || []);
  }

  function selectCustomer(customer: CustomerOption) {
    setSelectedCustomer(customer);

    const label = customer.phone ? `${customer.name} - ${customer.phone}` : customer.name;

    setCustomerLabel(label);
    setCustomerSearchTerm(customer.name);
    toast.success(`مشتری انتخاب شد: ${customer.name}`);
  }

  function clearCustomer() {
    setSelectedCustomer(null);
    setCustomerLabel("");
    setCustomerSearchTerm("");
  }

  async function addProductByBarcode(barcode: string) {
    if (!barcode) {
      toast.error("این محصول بارکود ندارد");
      return;
    }

    if (!apiBaseUrl || !session?.session.id) {
      toast.error("جلسه فروش آماده نیست");
      return;
    }

    setStatus(`در حال افزودن بارکود: ${barcode}`);

    pendingScanBarcodeRef.current = barcode;

    if (sendWsMessage({
      type: "SCAN_BARCODE",
      barcode,
      warehouseId: warehouse?.id || null,
    })) {
      return;
    }

    pendingScanBarcodeRef.current = null;

    try {
      const res = await scanPosBarcode({
        baseUrl: apiBaseUrl,
        sessionId: session.session.id,
        barcode,
        warehouseId: warehouse?.id || null,
      });

      if (res.data?.cart) {
        applyServerCart({
          cart: res.data.cart,
          summary: res.data.cartSummary,
        }, {
          highlightBarcode: barcode,
          highlightChangedItem: true,
        });
      }

      toast.success("محصول به سبد اضافه شد");
    } catch (error: any) {
      toast.error(error?.message || "افزودن محصول ناکام شد");
    }
  }

  async function resetPosSession() {
    socketRef.current?.close();
    setSession(null);
    setCart(null);
    setSummary(null);
    setHeldCarts([]);
    await bootstrap();
    toast.success("جلسه POS جدید ساخته شد");
  }

  async function bootstrap() {
    try {
      setIsBooting(true);

      const baseUrl = getEffectiveApiBaseUrl();
      setApiBaseUrl(baseUrl);

      const defaults = await loadPosDefaults(baseUrl);

      setCurrencies(defaults.currencies);
      setWarehouses(defaults.warehouses);
      setCashRegisters(defaults.cashRegisters);
      setBankAccounts(defaults.bankAccounts);

      const savedCurrencyId = localStorage.getItem("muhaseb_pos_currency_id") || "";
      const savedWarehouseId = localStorage.getItem("muhaseb_pos_warehouse_id") || "";
      const savedCashAccountId = localStorage.getItem("muhaseb_pos_cash_account_id") || "";
      const savedBankAccountId = localStorage.getItem("muhaseb_pos_bank_account_id") || "";
      const savedPaymentMethod =
        (localStorage.getItem("muhaseb_pos_payment_method") as "CASH" | "CARD" | "SPLIT" | null) ||
        "CASH";

      const selectedCurrency =
        defaults.currencies.find((item) => item.id === savedCurrencyId) ||
        defaults.currency;

      const selectedWarehouse =
        defaults.warehouses.find((item) => item.id === savedWarehouseId) ||
        defaults.warehouse;

      setCurrency(selectedCurrency);
      setWarehouse(selectedWarehouse);

      const savedAccountStillValid = defaults.cashRegisters.some((register) =>
        register.accounts.some(
          (account) =>
            account.id === savedCashAccountId &&
            (!selectedCurrency?.id || account.currencyId === selectedCurrency.id)
        )
      );

      if (savedAccountStillValid) {
        setCashAccountIdState(savedCashAccountId);
      } else if (selectedCurrency?.id) {
        const matchingAccount = defaults.cashRegisters
          .flatMap((register) => register.accounts)
          .find((account) => account.currencyId === selectedCurrency.id);

        setCashAccountIdState(matchingAccount?.id || defaults.cashAccountId);
      } else {
        setCashAccountIdState(defaults.cashAccountId);
      }

      const savedBankStillValid = defaults.bankAccounts.some(
        (account) =>
          account.id === savedBankAccountId &&
          account.isActive !== false &&
          (!selectedCurrency?.id || account.currencyId === selectedCurrency.id),
      );
      const matchingBank = defaults.bankAccounts.find(
        (account) =>
          account.isActive !== false &&
          (!selectedCurrency?.id || account.currencyId === selectedCurrency.id),
      );

      setBankAccountIdState(
        savedBankStillValid ? savedBankAccountId : matchingBank?.id || defaults.bankAccountId,
      );
      setPaymentMethodState(["CASH", "CARD", "SPLIT"].includes(savedPaymentMethod) ? savedPaymentMethod : "CASH");

      const sessionRes = await createPosSession(baseUrl);
      setSession(sessionRes.data);

      if (selectedWarehouse?.id) {
        await updatePosSessionSettings(baseUrl, sessionRes.data.session.id, {
          warehouseId: selectedWarehouse.id,
          currencyId: selectedCurrency?.id || null,
          exchangeRate: selectedCurrency?.isBase
            ? 1
            : Number(selectedCurrency?.latestRate || 1),
        });
      } else if (selectedCurrency?.id) {
        await updatePosSessionSettings(baseUrl, sessionRes.data.session.id, {
          currencyId: selectedCurrency.id,
          exchangeRate: selectedCurrency.isBase ? 1 : Number(selectedCurrency.latestRate || 1),
        });
      }

      const cartRes = await getPosCart(baseUrl, sessionRes.data.session.id);
      applyServerCart(cartRes.data);

      await refreshHeldCarts(baseUrl, sessionRes.data.session.id);
      await loadProductList(baseUrl, productSearchTerm, {
        warehouseId: selectedWarehouse?.id || null,
      });
      await loadCustomerList(baseUrl);

      connectWebSocket(
        buildPosWebSocketUrl(baseUrl, sessionRes.data.session.id) ||
          sessionRes.data.connection.desktopWebSocketUrl,
      );
      setStatus("QR را با اپ موبایل اسکن کنید");
    } catch (error: any) {
      setStatus(error?.message || "خطا در آماده‌سازی POS");
      toast.error(error?.message || "خطا در آماده‌سازی POS");
    } finally {
      setIsBooting(false);
    }
  }

  async function holdCurrentCart(name?: string) {
    if (!cartItems.length) {
      toast.error("سبد فروش خالی است");
      return;
    }

    if (sendWsMessage({ type: "HOLD_CART", name: name || null })) {
      toast.success("سبد فروش معلق شد");
      setInvoiceDiscount(0);
      return;
    }

    if (!apiBaseUrl || !session?.session.id) return;

    const res = await holdCart(apiBaseUrl, session.session.id, name);
    applyServerCart({
      cart: res.data.cart,
      summary: res.data.summary,
    });

    setInvoiceDiscount(0);
    await refreshHeldCarts();
    toast.success("سبد فروش معلق شد");
  }

  async function restoreHeldCartById(heldCartId: string) {
    if (sendWsMessage({ type: "RESTORE_HELD_CART", heldCartId })) {
      toast.success("سبد معلق برگشت داده شد");
      return;
    }

    if (!apiBaseUrl || !session?.session.id) return;

    const res = await restoreHeldCart(apiBaseUrl, session.session.id, heldCartId);
    applyServerCart({
      cart: res.data.cart,
      summary: res.data.summary,
    });

    await refreshHeldCarts();
    toast.success("سبد معلق برگشت داده شد");
  }

  async function deleteHeldCartById(heldCartId: string) {
    if (sendWsMessage({ type: "DELETE_HELD_CART", heldCartId })) {
      toast.success("سبد معلق حذف شد");
      return;
    }

    if (!apiBaseUrl || !session?.session.id) return;

    const res = await deleteHeldCart(apiBaseUrl, session.session.id, heldCartId);
    setHeldCarts(res.data.heldCarts || []);
    toast.success("سبد معلق حذف شد");
  }

  async function updateItem(
    key: string,
    input: {
      quantity?: number;
      unitId?: string;
      unitPrice?: number;
      discount?: number;
    }
  ) {
    if (!input.unitId) {
      applyOptimisticCartItemUpdate(key, input);
    }

    if (sendWsMessage({ type: "UPDATE_CART_ITEM", key, ...input })) return;
    if (!apiBaseUrl || !session?.session.id) return;

    const res = await updateCartItem(apiBaseUrl, session.session.id, key, input);
    applyServerCart(res.data);
  }

  async function removeItem(key: string) {
    if (sendWsMessage({ type: "REMOVE_CART_ITEM", key })) return;
    if (!apiBaseUrl || !session?.session.id) return;

    const res = await removeCartItem(apiBaseUrl, session.session.id, key);
    applyServerCart(res.data);
  }

  async function clearCart() {
    if (sendWsMessage({ type: "CLEAR_CART" })) {
      setInvoiceDiscount(0);
      return;
    }

    if (!apiBaseUrl || !session?.session.id) return;

    const res = await clearPosCart(apiBaseUrl, session.session.id);
    applyServerCart(res.data);
    setInvoiceDiscount(0);
  }

  async function startNewInvoice() {
    await clearCart();
    setPaidAmount(0);
    setSplitCashAmount(0);
    setSplitCardAmount(0);
    setInvoiceDiscount(0);
    setCustomerLabel("");
    setCustomerSearchTerm("");
    setSelectedCustomer(null);
    setSaleNote("");
    setProductSearchTerm("");
    setProductCategoryId("all");
    toast.success("فاکتور جدید آماده شد");
  }

  async function printReceiptUrl(url: string | null) {
    if (!url) {
      toast.error("رسیدی برای چاپ وجود ندارد");
      return;
    }

    try {
      if (window.electronAPI?.printReceipt) {
        await window.electronAPI.printReceipt(url, {
          widthMm: receiptWidthMm,
          marginLeftMm: receiptMarginLeftMm,
          marginRightMm: receiptMarginRightMm,
          silent: receiptSilentPrint,
          deviceName: receiptPrinterName,
        });
        toast.success("رسید برای چاپ آماده شد");
        return;
      }

      window.open(url, "_blank");
    } catch {
      window.open(url, "_blank");
      toast.error("چاپ مستقیم ناکام شد؛ رسید در مرورگر باز شد");
    }
  }

  async function printLastReceipt() {
    await printReceiptUrl(lastReceiptUrl);
  }

  function openLastReceipt() {
    if (!lastReceiptUrl) {
      toast.error("رسیدی برای بازکردن وجود ندارد");
      return;
    }

    window.open(lastReceiptUrl, "_blank");
  }

  async function printShiftReport() {
    const html = `
<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>گزارش پایان شیفت</title>
  <style>
    body {
      width: ${receiptWidthMm}mm;
      margin: 0;
      padding: 10px;
      font-family: Tahoma, Arial, sans-serif;
      color: #000;
      background: #fff;
      font-size: 12px;
    }

    h1 {
      font-size: 16px;
      margin: 0 0 8px;
      text-align: center;
    }

    .row {
      display: flex;
      justify-content: space-between;
      border-bottom: 1px dashed #999;
      padding: 6px 0;
    }

    .small {
      font-size: 10px;
      color: #333;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
      font-size: 10px;
    }

    th,
    td {
      border-bottom: 1px dashed #ccc;
      padding: 4px 2px;
      text-align: right;
    }

    .center {
      text-align: center;
    }
  </style>
</head>
<body>
  <h1>گزارش پایان شیفت POS</h1>

  <div class="center small">شروع: ${new Date(shift.openedAt).toLocaleString("fa-AF")}</div>
  <div class="center small">چاپ: ${new Date().toLocaleString("fa-AF")}</div>

  <div class="row"><strong>تعداد فاکتور</strong><strong>${shiftStats.invoiceCount}</strong></div>
  <div class="row"><span>مجموع فروش</span><strong>${shiftStats.totalSales}</strong></div>
  <div class="row"><span>مجموع دریافت</span><strong>${shiftStats.totalPaid}</strong></div>
  <div class="row"><span>مجموع برگشت پول</span><strong>${shiftStats.totalChange}</strong></div>
  <div class="row"><span>نقد داخل صندوق</span><strong>${shiftStats.netCash}</strong></div>

  <table>
    <thead>
      <tr>
        <th>فاکتور</th>
        <th>مجموع</th>
        <th>دریافت</th>
      </tr>
    </thead>
    <tbody>
      ${shift.sales
        .map(
          (sale) => `
            <tr>
              <td>${sale.invoiceNo}</td>
              <td>${sale.total}</td>
              <td>${sale.paidAmount}</td>
            </tr>
          `
        )
        .join("")}
    </tbody>
  </table>
</body>
</html>
`;

    const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

    await printReceiptUrl(url);
  }

  async function submitSale(options: SubmitSaleOptions = {}) {
    if (!canSubmitSale) {
      toast.error(saleDisabledReason || "صندوق آماده ثبت فروش نیست");
      return;
    }

    const requestedPaidAmount =
      paymentMethod === "SPLIT"
        ? Number(splitCashAmount || 0) + Number(splitCardAmount || 0)
        : paidAmount > 0
          ? paidAmount
          : payableTotal;
    const finalPaidAmount = Math.min(requestedPaidAmount, payableTotal);
    const cashTenderedAmount =
      paymentMethod === "SPLIT"
        ? Number(splitCashAmount || 0)
        : paymentMethod === "CASH"
          ? requestedPaidAmount
          : 0;
    const receiptChangeAmount = Math.max(0, cashTenderedAmount - payableTotal);
    const receiptTenderedAmount = finalPaidAmount + receiptChangeAmount;
    const shouldPrintReceipt = options.printReceipt !== false;
    const paymentAccountType = paymentMethod === "CARD" ? "BANK" : "CASH";
    const paymentAccountId = paymentAccountType === "BANK" ? bankAccountId : cashAccountId;
    const paymentMethodLabel =
      paymentMethod === "CARD"
        ? "کارت بانکی"
        : paymentMethod === "SPLIT"
          ? "پرداخت ترکیبی"
          : "نقدی";

    if (finalPaidAmount < payableTotal && !selectedCustomerPartyId) {
      toast.error("برای فروش نسیه باید مشتری انتخاب شود");
      return;
    }

    if (paymentMethod === "SPLIT" && splitCardAmount > 0 && !bankAccountId) {
      toast.error("حساب بانکی برای بخش کارت پرداخت ترکیبی انتخاب نشده است");
      return;
    }

    if (paymentMethod === "SPLIT" && splitCashAmount > 0 && !cashAccountId) {
      toast.error("حساب صندوق نقدی برای بخش نقد پرداخت ترکیبی انتخاب نشده است");
      return;
    }

    if (paymentMethod !== "SPLIT" && !paymentAccountId) {
      toast.error(
        paymentAccountType === "BANK"
          ? "حساب بانکی برای پرداخت کارت انتخاب نشده است"
          : "حساب صندوق نقدی تنظیم نشده است",
      );
      return;
    }

    let remainingPaymentAllocation = payableTotal;
    const requestedPaymentLines =
      paymentMethod === "SPLIT"
        ? ([
            splitCashAmount > 0
              ? {
                  paymentAccountType: "CASH" as const,
                  paymentAccountId: cashAccountId,
                  amount: splitCashAmount,
                }
              : null,
            splitCardAmount > 0
              ? {
                  paymentAccountType: "BANK" as const,
                  paymentAccountId: bankAccountId,
                  amount: splitCardAmount,
                }
              : null,
          ].filter(Boolean) as Array<{
            paymentAccountType: "CASH" | "BANK";
            paymentAccountId: string;
            amount: number;
          }>)
        : undefined;
    const paymentLines = requestedPaymentLines
      ?.map((line) => {
        const amount = Math.min(Number(line.amount || 0), remainingPaymentAllocation);
        remainingPaymentAllocation = Math.max(0, remainingPaymentAllocation - amount);
        return { ...line, amount };
      })
      .filter((line) => line.amount > 0);

    try {
      setStatus("در حال ثبت فروش...");

      const invoiceNo = `POS-${Date.now()}`;
      const finalInvoiceDiscount = Math.min(Number(invoiceDiscount || 0), subtotal);

      const res = await submitPosSale({
        baseUrl: apiBaseUrl,
        invoiceNo,
        currencyId: currency!.id,
        paymentAccountType,
        paymentAccountId,
        paymentLines,
        subtotal,
        invoiceDiscount: finalInvoiceDiscount,
        paidAmount: finalPaidAmount,
        tenderedAmount: receiptTenderedAmount,
        changeAmount: receiptChangeAmount,
        customerId: selectedCustomerPartyId,
        customerLabel: customerLabel.trim() || undefined,
        saleNote: saleNote.trim() || undefined,
        paymentMethodLabel,
        items: cartItems.map((item) => ({
          productId: item.productId,
          warehouseId: item.warehouseId,
          unitId: item.unitId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount || 0,
        })),
      });

      const saleId = res.data?.sale?.id;
      setLastSaleId(saleId || null);

      const receiptUrl = saleId
        ? `${apiBaseUrl}/api/pos-receipts/sales/${saleId}/html?width=${receiptWidthMm}`
        : null;

      if (saleId) {
        try {
          const cogsRes = await postSaleCogsJournal({
            baseUrl: apiBaseUrl,
            saleId,
            invoiceNo,
            items: cartItems.map((item) => ({
              productId: item.productId,
              warehouseId: item.warehouseId || null,
              lotId: item.lotId || null,
              quantity: item.quantity,
            })),
          });

          if (cogsRes.skipped) {
            setLastCogsStatus({
              status: "skipped",
              message: cogsRes.message || "COGS ساخته نشد قیمت تمامشده موجود نیست",
              total: 0,
            });
            toast.error(cogsRes.message || "COGS ساخته نشد قیمت تمامشده موجود نیست");
          } else {
            setLastCogsStatus({
              status: "posted",
              message: "COGS حسابداری ثبت شد",
              total: Number(cogsRes.cogs?.total || 0),
            });
          }
          } catch (error: any) {
            setLastCogsStatus({
              status: "error",
              message: error?.message || "ثبت COGS ناکام شد",
              total: 0,
            });
            toast.error(error?.message || "ثبت COGS ناکام شد");
        }

        recordShiftSale({
          saleId,
          invoiceNo,
          receiptUrl,
          total: payableTotal,
          paidAmount: receiptTenderedAmount,
          changeAmount: receiptChangeAmount,
        });
      }

      setStatus("فروش ثبت شد");
      toast.success("فروش ثبت شد");

      await clearCart();

      setPaidAmount(0);
      setSplitCashAmount(0);
      setSplitCardAmount(0);
      setInvoiceDiscount(0);
      setCustomerLabel("");
      setCustomerSearchTerm("");
      setSelectedCustomer(null);
      setSaleNote("");

      if (receiptUrl) {
        setLastReceiptUrl(receiptUrl);
        localStorage.setItem("muhaseb_last_receipt_url", receiptUrl);

        if (shouldPrintReceipt) {
          await printReceiptUrl(receiptUrl);
        }
      }
    } catch (error: any) {
      setStatus(error?.message || "ثبت فروش ناکام شد");
      toast.error(error?.message || "ثبت فروش ناکام شد");
    }
  }

  useEffect(() => {
    bootstrap();

    return () => {
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      socketRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!apiBaseUrl) return;

    const timer = window.setTimeout(() => {
      void loadProductList(apiBaseUrl, productSearchTerm);
    }, 250);

    return () => window.clearTimeout(timer);
    // loadProductList intentionally stays local to keep the POS hook compact.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBaseUrl, productCategoryId, productSearchTerm, warehouse?.id]);

  useEffect(() => {
    if (!apiBaseUrl) return;

    const timer = window.setTimeout(() => {
      void loadCustomerList(apiBaseUrl, customerSearchTerm);
    }, 300);

    return () => window.clearTimeout(timer);
    // loadCustomerList intentionally stays local to keep the POS hook compact.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBaseUrl, customerSearchTerm]);

  return {
    apiBaseUrl,
    apiBaseUrlOverride,
    setApiBaseUrlOverride,
    session,
    isWsConnected,
    status,
    cart,
    summary,
    cartItems,
    highlightedCartItemKey,

    heldCarts,
    holdCurrentCart,
    restoreHeldCartById,
    deleteHeldCartById,

    products,
    productSearchTerm,
    setProductSearchTerm,
    productCategoryId,
    setProductCategoryId,
    productCategories,
    filteredProducts: products,
    productPagination,
    isLoadingProducts,
    isLoadingMoreProducts,
    addProductByBarcode,
    loadProductList,
    loadMoreProducts,

    customers,
    customerSearchTerm,
    setCustomerSearchTerm,
    filteredCustomers,
    selectedCustomer,
    customerLabel,
    setCustomerLabel,
    saleNote,
    setSaleNote,
    isLoadingCustomers,
    selectCustomer,
    clearCustomer,
    loadCustomerList,

    currencies,
    warehouses,
    cashRegisters,
    bankAccounts,
    currency,
    warehouse,
    cashAccountId,
    bankAccountId,
    paymentMethod,
    setCurrencyId,
    setWarehouseId,
    setCashAccountId,
    setBankAccountId,
    setPaymentMethod,

    lastSaleId,
    lastReceiptUrl,
    printReceiptUrl,
    printLastReceipt,
    openLastReceipt,

    paidAmount,
    setPaidAmount,
    splitCashAmount,
    splitCardAmount,
    setSplitPayment,
    invoiceDiscount,
    setInvoiceDiscount,
    effectivePaidAmount,
    remainingAmount,
    changeAmount,

    shift,
    shiftStats,
    startNewShift,
    printShiftReport,

    hasCartStockIssue,
    readinessIssues,
    canSubmitSale,
    saleDisabledReason,

    receiptWidthMm,
    setReceiptWidthMm,
    receiptPrinterName,
    setReceiptPrinterName,
    receiptSilentPrint,
    setReceiptSilentPrint,
    receiptMarginLeftMm,
    setReceiptMarginLeftMm,
    receiptMarginRightMm,
    setReceiptMarginRightMm,
    visibleMetricIds,
    setMetricVisibility,

    isBooting,
    subtotal,
    payableTotal,
    itemsCount,

    refreshPosData,
    resetPosSession,
    startNewInvoice,
    bootstrap,
    updateItem,
    removeItem,
    clearCart,
    submitSale,
  };
}
