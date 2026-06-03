CREATE TABLE "CurrencyRate" (
  "id" TEXT NOT NULL,
  "currencyId" TEXT NOT NULL,
  "rateToBase" DECIMAL(18,8) NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "note" TEXT,
  "createdByUserId" TEXT,
  "deletedByUserId" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CurrencyRate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CurrencyRate_currencyId_idx" ON "CurrencyRate"("currencyId");
CREATE INDEX "CurrencyRate_effectiveAt_idx" ON "CurrencyRate"("effectiveAt");
CREATE INDEX "CurrencyRate_deletedAt_idx" ON "CurrencyRate"("deletedAt");

ALTER TABLE "CurrencyRate" ADD CONSTRAINT "CurrencyRate_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "Currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EmployeePayment"
  ADD COLUMN "exchangeRate" DECIMAL(18,8) NOT NULL DEFAULT 1,
  ADD COLUMN "baseCurrencyId" TEXT,
  ADD COLUMN "baseAmount" DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE "MoneyTransaction"
  ADD COLUMN "exchangeRate" DECIMAL(18,8) NOT NULL DEFAULT 1,
  ADD COLUMN "baseCurrencyId" TEXT,
  ADD COLUMN "baseAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "baseBalanceAfter" DECIMAL(18,4);

ALTER TABLE "Purchase"
  ADD COLUMN "exchangeRate" DECIMAL(18,8) NOT NULL DEFAULT 1,
  ADD COLUMN "baseCurrencyId" TEXT,
  ADD COLUMN "baseSubtotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "baseTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "basePaidAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "baseRemainingAmount" DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE "PurchaseReturn"
  ADD COLUMN "exchangeRate" DECIMAL(18,8) NOT NULL DEFAULT 1,
  ADD COLUMN "baseCurrencyId" TEXT,
  ADD COLUMN "baseSubtotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "basePaidAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "baseRemainingAmount" DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE "Sale"
  ADD COLUMN "exchangeRate" DECIMAL(18,8) NOT NULL DEFAULT 1,
  ADD COLUMN "baseCurrencyId" TEXT,
  ADD COLUMN "baseSubtotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "baseTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "basePaidAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "baseRemainingAmount" DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE "SaleReturn"
  ADD COLUMN "exchangeRate" DECIMAL(18,8) NOT NULL DEFAULT 1,
  ADD COLUMN "baseCurrencyId" TEXT,
  ADD COLUMN "baseSubtotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "basePaidAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "baseRemainingAmount" DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE "JournalLine"
  ADD COLUMN "exchangeRate" DECIMAL(18,8) NOT NULL DEFAULT 1,
  ADD COLUMN "baseCurrencyId" TEXT,
  ADD COLUMN "baseDebit" DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "baseCredit" DECIMAL(18,4) NOT NULL DEFAULT 0;

UPDATE "Purchase" SET
  "baseSubtotal" = "subtotal",
  "baseTotal" = "total",
  "basePaidAmount" = "paidAmount",
  "baseRemainingAmount" = "remainingAmount";

UPDATE "Sale" SET
  "baseSubtotal" = "subtotal",
  "baseTotal" = "total",
  "basePaidAmount" = "paidAmount",
  "baseRemainingAmount" = "remainingAmount";

UPDATE "PurchaseReturn" SET
  "baseSubtotal" = "subtotal",
  "basePaidAmount" = "receivedAmount",
  "baseRemainingAmount" = "payableAdjustment";

UPDATE "SaleReturn" SET
  "baseSubtotal" = "subtotal",
  "basePaidAmount" = "refundAmount",
  "baseRemainingAmount" = "receivableAdjustment";

UPDATE "MoneyTransaction" SET
  "baseAmount" = "amount",
  "baseBalanceAfter" = "balanceAfter";

UPDATE "EmployeePayment" SET "baseAmount" = "amount";

UPDATE "JournalLine" SET
  "baseDebit" = "debit",
  "baseCredit" = "credit";
