CREATE TABLE "SaleReturn" (
  "id" TEXT NOT NULL,
  "returnNo" TEXT,
  "saleId" TEXT NOT NULL,
  "customerId" TEXT,
  "currencyId" TEXT NOT NULL,
  "subtotal" DECIMAL(18,4) NOT NULL,
  "refundAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "receivableAdjustment" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "note" TEXT,
  "createdByUserId" TEXT,
  "posDeviceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SaleReturn_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SaleReturnItem" (
  "id" TEXT NOT NULL,
  "saleReturnId" TEXT NOT NULL,
  "saleItemId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "lotId" TEXT,
  "quantity" DECIMAL(18,4) NOT NULL,
  "quantityBase" DECIMAL(18,4) NOT NULL,
  "unitPrice" DECIMAL(18,4) NOT NULL,
  "totalPrice" DECIMAL(18,4) NOT NULL,
  "unitCostBase" DECIMAL(18,4),
  "totalCost" DECIMAL(18,4),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SaleReturnItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PurchaseReturn" (
  "id" TEXT NOT NULL,
  "returnNo" TEXT,
  "purchaseId" TEXT NOT NULL,
  "supplierId" TEXT,
  "currencyId" TEXT NOT NULL,
  "subtotal" DECIMAL(18,4) NOT NULL,
  "receivedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "payableAdjustment" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "note" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PurchaseReturn_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PurchaseReturnItem" (
  "id" TEXT NOT NULL,
  "purchaseReturnId" TEXT NOT NULL,
  "purchaseItemId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "lotId" TEXT,
  "quantity" DECIMAL(18,4) NOT NULL,
  "quantityBase" DECIMAL(18,4) NOT NULL,
  "unitCost" DECIMAL(18,4) NOT NULL,
  "unitCostBase" DECIMAL(18,4) NOT NULL,
  "totalCost" DECIMAL(18,4) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseReturnItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SaleReturn_saleId_idx" ON "SaleReturn"("saleId");
CREATE INDEX "SaleReturn_customerId_idx" ON "SaleReturn"("customerId");
CREATE INDEX "SaleReturn_currencyId_idx" ON "SaleReturn"("currencyId");
CREATE INDEX "SaleReturn_returnNo_idx" ON "SaleReturn"("returnNo");
CREATE INDEX "SaleReturn_createdByUserId_idx" ON "SaleReturn"("createdByUserId");
CREATE INDEX "SaleReturn_posDeviceId_idx" ON "SaleReturn"("posDeviceId");
CREATE INDEX "SaleReturn_createdAt_idx" ON "SaleReturn"("createdAt");

CREATE INDEX "SaleReturnItem_saleReturnId_idx" ON "SaleReturnItem"("saleReturnId");
CREATE INDEX "SaleReturnItem_saleItemId_idx" ON "SaleReturnItem"("saleItemId");
CREATE INDEX "SaleReturnItem_productId_idx" ON "SaleReturnItem"("productId");
CREATE INDEX "SaleReturnItem_warehouseId_idx" ON "SaleReturnItem"("warehouseId");
CREATE INDEX "SaleReturnItem_lotId_idx" ON "SaleReturnItem"("lotId");

CREATE INDEX "PurchaseReturn_purchaseId_idx" ON "PurchaseReturn"("purchaseId");
CREATE INDEX "PurchaseReturn_supplierId_idx" ON "PurchaseReturn"("supplierId");
CREATE INDEX "PurchaseReturn_currencyId_idx" ON "PurchaseReturn"("currencyId");
CREATE INDEX "PurchaseReturn_returnNo_idx" ON "PurchaseReturn"("returnNo");
CREATE INDEX "PurchaseReturn_createdByUserId_idx" ON "PurchaseReturn"("createdByUserId");
CREATE INDEX "PurchaseReturn_createdAt_idx" ON "PurchaseReturn"("createdAt");

CREATE INDEX "PurchaseReturnItem_purchaseReturnId_idx" ON "PurchaseReturnItem"("purchaseReturnId");
CREATE INDEX "PurchaseReturnItem_purchaseItemId_idx" ON "PurchaseReturnItem"("purchaseItemId");
CREATE INDEX "PurchaseReturnItem_productId_idx" ON "PurchaseReturnItem"("productId");
CREATE INDEX "PurchaseReturnItem_warehouseId_idx" ON "PurchaseReturnItem"("warehouseId");
CREATE INDEX "PurchaseReturnItem_lotId_idx" ON "PurchaseReturnItem"("lotId");

ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "Currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_posDeviceId_fkey" FOREIGN KEY ("posDeviceId") REFERENCES "PosDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SaleReturnItem" ADD CONSTRAINT "SaleReturnItem_saleReturnId_fkey" FOREIGN KEY ("saleReturnId") REFERENCES "SaleReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SaleReturnItem" ADD CONSTRAINT "SaleReturnItem_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES "SaleItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaleReturnItem" ADD CONSTRAINT "SaleReturnItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaleReturnItem" ADD CONSTRAINT "SaleReturnItem_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaleReturnItem" ADD CONSTRAINT "SaleReturnItem_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "StockLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PurchaseReturn" ADD CONSTRAINT "PurchaseReturn_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseReturn" ADD CONSTRAINT "PurchaseReturn_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseReturn" ADD CONSTRAINT "PurchaseReturn_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "Currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseReturn" ADD CONSTRAINT "PurchaseReturn_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PurchaseReturnItem" ADD CONSTRAINT "PurchaseReturnItem_purchaseReturnId_fkey" FOREIGN KEY ("purchaseReturnId") REFERENCES "PurchaseReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseReturnItem" ADD CONSTRAINT "PurchaseReturnItem_purchaseItemId_fkey" FOREIGN KEY ("purchaseItemId") REFERENCES "PurchaseItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseReturnItem" ADD CONSTRAINT "PurchaseReturnItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseReturnItem" ADD CONSTRAINT "PurchaseReturnItem_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseReturnItem" ADD CONSTRAINT "PurchaseReturnItem_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "StockLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
