ALTER TABLE "PurchaseReturn"
ADD COLUMN "cancelledAt" TIMESTAMP(3),
ADD COLUMN "cancelledByUserId" TEXT,
ADD COLUMN "cancellationReason" TEXT;

ALTER TABLE "SaleReturn"
ADD COLUMN "cancelledAt" TIMESTAMP(3),
ADD COLUMN "cancelledByUserId" TEXT,
ADD COLUMN "cancellationReason" TEXT;

CREATE INDEX "PurchaseReturn_cancelledAt_idx" ON "PurchaseReturn"("cancelledAt");
CREATE INDEX "SaleReturn_cancelledAt_idx" ON "SaleReturn"("cancelledAt");
