-- AlterTable
ALTER TABLE "Party"
  ADD COLUMN "code" TEXT,
  ADD COLUMN "companyName" TEXT,
  ADD COLUMN "contactPerson" TEXT,
  ADD COLUMN "secondaryPhone" TEXT,
  ADD COLUMN "taxNumber" TEXT,
  ADD COLUMN "licenseNumber" TEXT,
  ADD COLUMN "province" TEXT,
  ADD COLUMN "city" TEXT,
  ADD COLUMN "creditLimit" DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "paymentTermsDays" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Party_code_idx" ON "Party"("code");

-- CreateIndex
CREATE INDEX "Party_companyName_idx" ON "Party"("companyName");
