-- DropIndex
DROP INDEX "Product_barcode_trgm_idx";

-- DropIndex
DROP INDEX "Product_name_trgm_idx";

-- DropIndex
DROP INDEX "Product_sku_trgm_idx";

-- AlterTable
ALTER TABLE "PersistentJob" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "StockBalance" ALTER COLUMN "updatedAt" DROP DEFAULT;
