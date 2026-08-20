-- Additive inventory-operation and Kabul business-date foundation.
-- No historical business row is rewritten by this migration.

ALTER TABLE "Employee" ADD COLUMN "hireDate" DATE;

ALTER TABLE "AttendanceWorkday" ADD COLUMN "localDate" VARCHAR(10);
ALTER TABLE "AttendanceRecord" ADD COLUMN "localDate" VARCHAR(10);
ALTER TABLE "AttendanceDeviceLock" ADD COLUMN "localDate" VARCHAR(10);

ALTER TABLE "StockMovement" ADD COLUMN "operationId" TEXT;
ALTER TABLE "StockMovement" ADD COLUMN "occurredAt" TIMESTAMP(3);

CREATE TABLE "InventoryOperation" (
  "id" TEXT NOT NULL,
  "clientRequestId" TEXT,
  "type" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'COMPLETED',
  "cancelledAt" TIMESTAMP(3),
  "cancelReason" TEXT,
  "createdByUserId" TEXT,
  "cancelledByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InventoryOperation_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "StockMovement"
ADD CONSTRAINT "StockMovement_operationId_fkey"
FOREIGN KEY ("operationId") REFERENCES "InventoryOperation"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "InventoryOperation_clientRequestId_key"
ON "InventoryOperation"("clientRequestId");
CREATE INDEX "InventoryOperation_type_occurredAt_idx"
ON "InventoryOperation"("type", "occurredAt");
CREATE INDEX "InventoryOperation_status_occurredAt_idx"
ON "InventoryOperation"("status", "occurredAt");
CREATE INDEX "InventoryOperation_createdAt_idx"
ON "InventoryOperation"("createdAt");

CREATE INDEX "StockMovement_operationId_idx" ON "StockMovement"("operationId");
CREATE INDEX "StockMovement_occurredAt_idx" ON "StockMovement"("occurredAt");
CREATE INDEX "StockMovement_productId_warehouseId_occurredAt_idx"
ON "StockMovement"("productId", "warehouseId", "occurredAt");

CREATE INDEX "AttendanceWorkday_periodId_localDate_idx"
ON "AttendanceWorkday"("periodId", "localDate");
CREATE INDEX "AttendanceRecord_employeeId_localDate_idx"
ON "AttendanceRecord"("employeeId", "localDate");
CREATE INDEX "AttendanceDeviceLock_deviceId_localDate_idx"
ON "AttendanceDeviceLock"("deviceId", "localDate");

-- Partial unique indexes only affect rows which explicitly carry the new Kabul
-- date key. Legacy rows remain untouched until an admin-reviewed backfill.
CREATE UNIQUE INDEX "AttendanceWorkday_periodId_localDate_unique"
ON "AttendanceWorkday"("periodId", "localDate")
WHERE "localDate" IS NOT NULL;
CREATE UNIQUE INDEX "AttendanceRecord_employeeId_localDate_unique"
ON "AttendanceRecord"("employeeId", "localDate")
WHERE "localDate" IS NOT NULL;
CREATE UNIQUE INDEX "AttendanceDeviceLock_deviceId_localDate_unique"
ON "AttendanceDeviceLock"("deviceId", "localDate")
WHERE "localDate" IS NOT NULL;

-- NOT VALID preserves legacy exceptions for explicit review while rejecting new
-- or subsequently modified invalid lots.
ALTER TABLE "StockLot"
ADD CONSTRAINT "StockLot_remaining_not_above_initial"
CHECK ("remainingQuantity" <= "initialQuantity") NOT VALID;

-- Reconciliation uses the same logical lock as application stock mutations.
CREATE OR REPLACE FUNCTION refresh_stock_balance(p_product_id TEXT, p_warehouse_id TEXT)
RETURNS VOID AS $$
DECLARE
  v_lot_count BIGINT;
  v_quantity DECIMAL(18,4);
  v_value DECIMAL(18,4);
  v_expiry TIMESTAMP(3);
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('stock:' || p_product_id || ':' || p_warehouse_id, 0)
  );

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
