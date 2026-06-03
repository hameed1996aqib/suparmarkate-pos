ALTER TABLE "StockLot"
  ADD COLUMN "exchangeRate" DECIMAL(18,8) NOT NULL DEFAULT 1,
  ADD COLUMN "baseUnitCost" DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE "StockMovement"
  ADD COLUMN "exchangeRate" DECIMAL(18,8) NOT NULL DEFAULT 1,
  ADD COLUMN "baseUnitCost" DECIMAL(18,4);

ALTER TABLE "SaleItem"
  ADD COLUMN "baseTotalCost" DECIMAL(18,4);

ALTER TABLE "SaleReturnItem"
  ADD COLUMN "baseTotalCost" DECIMAL(18,4);

UPDATE "StockLot" SET "baseUnitCost" = "unitCost";
UPDATE "StockMovement" SET "baseUnitCost" = "unitCost";
UPDATE "SaleItem" SET "baseTotalCost" = "totalCost";
UPDATE "SaleReturnItem" SET "baseTotalCost" = "totalCost";
