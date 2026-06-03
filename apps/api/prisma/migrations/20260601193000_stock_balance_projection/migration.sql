CREATE TABLE "StockBalance" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "quantityBase" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "valueBase" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "earliestExpiryAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockBalance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StockBalance_productId_warehouseId_key"
ON "StockBalance"("productId", "warehouseId");

CREATE INDEX "StockBalance_warehouseId_idx" ON "StockBalance"("warehouseId");
CREATE INDEX "StockBalance_quantityBase_idx" ON "StockBalance"("quantityBase");
CREATE INDEX "StockBalance_earliestExpiryAt_idx" ON "StockBalance"("earliestExpiryAt");

ALTER TABLE "StockBalance"
ADD CONSTRAINT "StockBalance_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StockBalance"
ADD CONSTRAINT "StockBalance_warehouseId_fkey"
FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION refresh_stock_balance(p_product_id TEXT, p_warehouse_id TEXT)
RETURNS VOID AS $$
DECLARE
  v_quantity DECIMAL(18,4);
  v_value DECIMAL(18,4);
  v_expiry TIMESTAMP(3);
BEGIN
  SELECT
    COALESCE(SUM("remainingQuantity"), 0),
    COALESCE(SUM("remainingQuantity" * "baseUnitCost"), 0),
    MIN("expiryDate") FILTER (WHERE "remainingQuantity" > 0 AND "expiryDate" IS NOT NULL)
  INTO v_quantity, v_value, v_expiry
  FROM "StockLot"
  WHERE "productId" = p_product_id
    AND "warehouseId" = p_warehouse_id
    AND "remainingQuantity" > 0;

  IF v_quantity <= 0 THEN
    DELETE FROM "StockBalance"
    WHERE "productId" = p_product_id AND "warehouseId" = p_warehouse_id;
    RETURN;
  END IF;

  INSERT INTO "StockBalance" (
    "id", "productId", "warehouseId", "quantityBase", "valueBase", "earliestExpiryAt", "updatedAt"
  )
  VALUES (
    gen_random_uuid()::TEXT, p_product_id, p_warehouse_id, v_quantity, v_value, v_expiry, CURRENT_TIMESTAMP
  )
  ON CONFLICT ("productId", "warehouseId")
  DO UPDATE SET
    "quantityBase" = EXCLUDED."quantityBase",
    "valueBase" = EXCLUDED."valueBase",
    "earliestExpiryAt" = EXCLUDED."earliestExpiryAt",
    "updatedAt" = CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sync_stock_balance_from_lot()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM refresh_stock_balance(OLD."productId", OLD."warehouseId");
    RETURN OLD;
  END IF;

  PERFORM refresh_stock_balance(NEW."productId", NEW."warehouseId");

  IF TG_OP = 'UPDATE'
    AND (OLD."productId" <> NEW."productId" OR OLD."warehouseId" <> NEW."warehouseId") THEN
    PERFORM refresh_stock_balance(OLD."productId", OLD."warehouseId");
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "StockLot_sync_stock_balance"
AFTER INSERT OR UPDATE OR DELETE ON "StockLot"
FOR EACH ROW EXECUTE FUNCTION sync_stock_balance_from_lot();

INSERT INTO "StockBalance" (
  "id", "productId", "warehouseId", "quantityBase", "valueBase", "earliestExpiryAt", "updatedAt"
)
SELECT
  gen_random_uuid()::TEXT,
  "productId",
  "warehouseId",
  SUM("remainingQuantity"),
  SUM("remainingQuantity" * "baseUnitCost"),
  MIN("expiryDate") FILTER (WHERE "expiryDate" IS NOT NULL),
  CURRENT_TIMESTAMP
FROM "StockLot"
WHERE "remainingQuantity" > 0
GROUP BY "productId", "warehouseId";
