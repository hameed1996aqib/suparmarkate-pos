CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Product_active_name_trgm_idx"
ON "Product" USING GIN ("name" gin_trgm_ops)
WHERE "deletedAt" IS NULL AND "isActive" = true;

CREATE INDEX IF NOT EXISTS "Product_active_sku_trgm_idx"
ON "Product" USING GIN ("sku" gin_trgm_ops)
WHERE "deletedAt" IS NULL AND "isActive" = true;

CREATE INDEX IF NOT EXISTS "Product_active_barcode_trgm_idx"
ON "Product" USING GIN ("barcode" gin_trgm_ops)
WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "Product_active_barcode_normalized_trgm_idx"
ON "Product" USING GIN ("barcodeNormalized" gin_trgm_ops)
WHERE "deletedAt" IS NULL;
