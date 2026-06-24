CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Product_sku_trgm_idx"
ON "Product" USING GIN ("sku" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Product_isActive_deletedAt_barcode_idx"
ON "Product"("isActive", "deletedAt", "barcode");

CREATE INDEX IF NOT EXISTS "Product_isActive_deletedAt_name_idx"
ON "Product"("isActive", "deletedAt", "name");

CREATE INDEX IF NOT EXISTS "ProductUnit_productId_isDefaultPurchase_idx"
ON "ProductUnit"("productId", "isDefaultPurchase");

CREATE INDEX IF NOT EXISTS "ProductUnit_productId_isDefaultSale_idx"
ON "ProductUnit"("productId", "isDefaultSale");

CREATE INDEX IF NOT EXISTS "StockBalance_productId_quantityBase_idx"
ON "StockBalance"("productId", "quantityBase");

CREATE INDEX IF NOT EXISTS "StockBalance_warehouseId_quantityBase_idx"
ON "StockBalance"("warehouseId", "quantityBase");
