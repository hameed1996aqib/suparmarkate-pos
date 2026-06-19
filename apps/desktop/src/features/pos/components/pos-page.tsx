import { useRef, useState } from "react";

import { PosCurrentInvoiceCard } from "@/features/pos/components/pos-current-invoice-card";
import {
  PosProductSearchCard,
  type PosProductSearchCardRef,
} from "@/features/pos/components/pos-product-search-card";
import { PosSettingsSheet } from "@/features/pos/components/pos-settings-sheet";
import { usePosSession } from "@/features/pos/hooks/use-pos-session";
import { usePosShortcuts } from "@/features/pos/hooks/use-pos-shortcuts";

export function PosPage() {
  const pos = usePosSession();
  const productSearchRef = useRef<PosProductSearchCardRef | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  usePosShortcuts({
    onFocusBarcode: () => {
      setTimeout(() => productSearchRef.current?.focusBarcode(), 50);
    },
    onHoldCart: () => pos.holdCurrentCart(),
    onSubmitSale: () => pos.submitSale(),
    onPrintLastReceipt: () => pos.printLastReceipt(),
    onEscape: () => {
      productSearchRef.current?.clearBarcode();
      pos.setProductSearchTerm("");
      pos.setCustomerSearchTerm("");
    },
  });

  return (
    <div dir="rtl" className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <PosStatusMetric
          label="فروش امروز"
          value={pos.shiftStats.totalSales}
          suffix={pos.currency?.code || "AFN"}
        />
        <PosStatusMetric
          label="تعداد فاکتورها"
          value={pos.shiftStats.invoiceCount}
        />
        <PosStatusMetric
          label="فروش نسیه"
          value={pos.remainingAmount}
          suffix={pos.currency?.code || "AFN"}
        />
        <PosStatusMetric
          label="میانگین سبد"
          value={pos.itemsCount ? Math.round(pos.subtotal / pos.itemsCount) : 0}
          suffix={pos.currency?.code || "AFN"}
        />
        <PosStatusMetric
          label="صندوق فعال"
          value={pos.cashAccountId ? 1 : 0}
          text={pos.cashAccountId ? "آماده" : "تنظیم نشده"}
        />
      </div>

      <div
        className="grid gap-4 2xl:grid-cols-[600px_1fr]"
        style={{ direction: "ltr" }}
      >
        <section dir="rtl" className="space-y-4">
          <PosCurrentInvoiceCard
            items={pos.cartItems}
            itemsCount={pos.itemsCount}
            currency={pos.currency}
            isBooting={pos.isBooting}
            subtotal={pos.subtotal}
            invoiceDiscount={pos.invoiceDiscount}
            payableTotal={pos.payableTotal}
            paidAmount={pos.paidAmount}
            splitCashAmount={pos.splitCashAmount}
            splitCardAmount={pos.splitCardAmount}
            remainingAmount={pos.remainingAmount}
            changeAmount={pos.changeAmount}
            paymentMethod={pos.paymentMethod}
            customerSearchTerm={pos.customerSearchTerm}
            customerLabel={pos.customerLabel}
            filteredCustomers={pos.filteredCustomers}
            selectedCustomer={pos.selectedCustomer}
            saleNote={pos.saleNote}
            lastReceiptUrl={pos.lastReceiptUrl}
            session={pos.session}
            heldCarts={pos.heldCarts}
            onNewInvoice={pos.startNewInvoice}
            onRefreshData={pos.refreshPosData}
            onResetSession={pos.resetPosSession}
            onPrintShiftReport={pos.printShiftReport}
            onStartNewShift={pos.startNewShift}
            onOpenSettings={() => setSettingsOpen(true)}
            onHoldCart={() => pos.holdCurrentCart()}
            onRestoreHeldCart={pos.restoreHeldCartById}
            onClearCart={pos.clearCart}
            onUpdateItem={pos.updateItem}
            onRemoveItem={pos.removeItem}
            onInvoiceDiscountChange={pos.setInvoiceDiscount}
            onPaidAmountChange={pos.setPaidAmount}
            onSplitPaymentChange={pos.setSplitPayment}
            onPaymentMethodChange={pos.setPaymentMethod}
            onCustomerSearchChange={pos.setCustomerSearchTerm}
            onCustomerSelect={pos.selectCustomer}
            onCustomerClear={pos.clearCustomer}
            onSaleNoteChange={pos.setSaleNote}
            onSubmitSale={pos.submitSale}
            onPrintLastReceipt={pos.printLastReceipt}
            onOpenLastReceipt={pos.openLastReceipt}
            canSubmitSale={pos.canSubmitSale}
            disabledReason={pos.saleDisabledReason}
          />
        </section>

        <section dir="rtl" className="space-y-4">
          <PosProductSearchCard
            ref={productSearchRef}
            searchTerm={pos.productSearchTerm}
            products={pos.filteredProducts}
            categories={pos.productCategories}
            activeCategoryId={pos.productCategoryId}
            isLoading={pos.isLoadingProducts}
            isLoadingMore={pos.isLoadingMoreProducts}
            hasMore={pos.productPagination.hasMore}
            totalProducts={pos.productPagination.total}
            warehouseName={pos.warehouse?.name}
            currencyCode={pos.currency?.code}
            currencyRate={pos.currency?.isBase ? 1 : Number(pos.currency?.latestRate || 1)}
            apiBaseUrl={pos.apiBaseUrl}
            isWsConnected={pos.isWsConnected}
            onSearchChange={pos.setProductSearchTerm}
            onCategoryChange={pos.setProductCategoryId}
            onLoadMore={pos.loadMoreProducts}
            onAddProduct={pos.addProductByBarcode}
            onScanBarcode={pos.addProductByBarcode}
          />
        </section>
      </div>
      <PosSettingsSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        apiBaseUrl={pos.apiBaseUrl}
        apiBaseUrlOverride={pos.apiBaseUrlOverride}
        currencies={pos.currencies}
        warehouses={pos.warehouses}
        cashRegisters={pos.cashRegisters}
        bankAccounts={pos.bankAccounts}
        currency={pos.currency}
        warehouse={pos.warehouse}
        cashAccountId={pos.cashAccountId}
        bankAccountId={pos.bankAccountId}
        receiptWidthMm={pos.receiptWidthMm}
        onApiBaseUrlOverrideChange={pos.setApiBaseUrlOverride}
        onCurrencyChange={pos.setCurrencyId}
        onWarehouseChange={pos.setWarehouseId}
        onCashAccountChange={pos.setCashAccountId}
        onBankAccountChange={pos.setBankAccountId}
        onReceiptWidthChange={pos.setReceiptWidthMm}
      />
    </div>
  );
}

function PosStatusMetric({
  label,
  value,
  suffix,
  text,
}: {
  label: string;
  value: number;
  suffix?: string;
  text?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <strong className="mt-2 block text-xl">
        {text || new Intl.NumberFormat("en-US").format(value)}
        {suffix ? (
          <span className="ms-1 text-xs text-muted-foreground">{suffix}</span>
        ) : null}
      </strong>
      <p className="mt-2 text-xs text-primary">در مقایسه با شیفت فعلی</p>
    </div>
  );
}
