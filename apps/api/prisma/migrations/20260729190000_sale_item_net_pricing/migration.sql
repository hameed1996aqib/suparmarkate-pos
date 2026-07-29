ALTER TABLE "SaleItem"
ADD COLUMN "documentDiscountAllocated" DECIMAL(18,4),
ADD COLUMN "netTotalPrice" DECIMAL(18,4);

COMMENT ON COLUMN "SaleItem"."documentDiscountAllocated" IS
'Snapshot of the sale-level discount allocated to this line. NULL identifies legacy rows.';

COMMENT ON COLUMN "SaleItem"."netTotalPrice" IS
'Line total after item and sale-level discounts. NULL identifies legacy rows.';
