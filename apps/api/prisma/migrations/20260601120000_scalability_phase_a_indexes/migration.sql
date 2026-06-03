CREATE INDEX "StockLot_productId_warehouseId_remainingQuantity_expiryDate_idx"
ON "StockLot"("productId", "warehouseId", "remainingQuantity", "expiryDate");

CREATE INDEX "StockMovement_productId_warehouseId_createdAt_idx"
ON "StockMovement"("productId", "warehouseId", "createdAt");

CREATE INDEX "StockMovement_type_createdAt_idx"
ON "StockMovement"("type", "createdAt");

CREATE INDEX "MoneyTransaction_createdAt_type_idx"
ON "MoneyTransaction"("createdAt", "type");

CREATE INDEX "Purchase_status_purchaseDate_idx"
ON "Purchase"("status", "purchaseDate");

CREATE INDEX "Purchase_currencyId_purchaseDate_idx"
ON "Purchase"("currencyId", "purchaseDate");

CREATE INDEX "Sale_status_saleDate_idx"
ON "Sale"("status", "saleDate");

CREATE INDEX "Sale_currencyId_saleDate_idx"
ON "Sale"("currencyId", "saleDate");

CREATE INDEX "Sale_cashierId_saleDate_idx"
ON "Sale"("cashierId", "saleDate");

CREATE INDEX "JournalLine_accountId_createdAt_idx"
ON "JournalLine"("accountId", "createdAt");

CREATE INDEX "JournalLine_partyId_createdAt_idx"
ON "JournalLine"("partyId", "createdAt");

CREATE INDEX "StockLot_positive_remaining_idx"
ON "StockLot"("productId", "warehouseId", "expiryDate")
WHERE "remainingQuantity" > 0;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "Product_name_trgm_idx"
ON "Product" USING GIN ("name" gin_trgm_ops);

CREATE INDEX "Product_barcode_trgm_idx"
ON "Product" USING GIN ("barcode" gin_trgm_ops);
