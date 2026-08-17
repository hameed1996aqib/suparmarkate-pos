CREATE TABLE "IdempotencyRecord" (
  "id" TEXT NOT NULL,
  "operationKey" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PROCESSING',
  "responseStatus" INTEGER,
  "responseBody" TEXT,
  "responseContentType" TEXT,
  "errorMessage" TEXT,
  "userId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IdempotencyRecord_scope_operationKey_key"
ON "IdempotencyRecord"("scope", "operationKey");

CREATE INDEX "IdempotencyRecord_scope_requestHash_createdAt_idx"
ON "IdempotencyRecord"("scope", "requestHash", "createdAt");

CREATE INDEX "IdempotencyRecord_status_createdAt_idx"
ON "IdempotencyRecord"("status", "createdAt");

CREATE INDEX "IdempotencyRecord_expiresAt_idx"
ON "IdempotencyRecord"("expiresAt");

-- NOT VALID preserves legacy rows for an explicit admin-led repair, while PostgreSQL
-- still rejects every new or subsequently modified invalid row.
ALTER TABLE "StockLot"
ADD CONSTRAINT "StockLot_initialQuantity_nonnegative"
CHECK ("initialQuantity" >= 0) NOT VALID;

ALTER TABLE "StockLot"
ADD CONSTRAINT "StockLot_remainingQuantity_nonnegative"
CHECK ("remainingQuantity" >= 0) NOT VALID;

ALTER TABLE "StockMovement"
ADD CONSTRAINT "StockMovement_quantity_positive"
CHECK ("quantity" > 0) NOT VALID;

-- Historical duplicates remain available for an explicit admin review. New manual
-- reversals are serialized and rejected when a reversal already exists. Transfer
-- reversals are intentionally excluded because one transfer contains several lots.
CREATE OR REPLACE FUNCTION reject_duplicate_manual_stock_cancel()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."referenceId" IS NOT NULL
    AND NEW."referenceType" IN (
      'OPENING_STOCK_CANCEL',
      'ADJUSTMENT_IN_CANCEL',
      'ADJUSTMENT_OUT_CANCEL',
      'DAMAGE_CANCEL'
    ) THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        'stock-manual-cancel:' || NEW."referenceType" || ':' || NEW."referenceId",
        0
      )
    );

    IF EXISTS (
      SELECT 1
      FROM "StockMovement" existing
      WHERE existing."referenceType" = NEW."referenceType"
        AND existing."referenceId" = NEW."referenceId"
    ) THEN
      RAISE EXCEPTION 'Stock movement is already cancelled'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "StockMovement_reject_duplicate_manual_cancel"
BEFORE INSERT ON "StockMovement"
FOR EACH ROW EXECUTE FUNCTION reject_duplicate_manual_stock_cancel();

CREATE OR REPLACE FUNCTION refresh_stock_balance(p_product_id TEXT, p_warehouse_id TEXT)
RETURNS VOID AS $$
DECLARE
  v_lot_count BIGINT;
  v_quantity DECIMAL(18,4);
  v_value DECIMAL(18,4);
  v_expiry TIMESTAMP(3);
BEGIN
  SELECT
    COUNT(*),
    COALESCE(SUM("remainingQuantity"), 0),
    COALESCE(SUM("remainingQuantity" * "baseUnitCost"), 0),
    MIN("expiryDate") FILTER (WHERE "remainingQuantity" > 0 AND "expiryDate" IS NOT NULL)
  INTO v_lot_count, v_quantity, v_value, v_expiry
  FROM "StockLot"
  WHERE "productId" = p_product_id
    AND "warehouseId" = p_warehouse_id;

  IF v_lot_count = 0 THEN
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

DO $$
DECLARE
  stock_key RECORD;
BEGIN
  FOR stock_key IN
    SELECT DISTINCT "productId", "warehouseId" FROM "StockLot"
  LOOP
    PERFORM refresh_stock_balance(stock_key."productId", stock_key."warehouseId");
  END LOOP;

  DELETE FROM "StockBalance" balance
  WHERE NOT EXISTS (
    SELECT 1 FROM "StockLot" lot
    WHERE lot."productId" = balance."productId"
      AND lot."warehouseId" = balance."warehouseId"
  );
END;
$$;
