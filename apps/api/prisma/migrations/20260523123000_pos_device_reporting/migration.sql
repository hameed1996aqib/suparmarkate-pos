ALTER TABLE "Sale" ADD COLUMN "posDeviceId" TEXT;
ALTER TABLE "MoneyTransaction" ADD COLUMN "posDeviceId" TEXT;

CREATE INDEX "Sale_posDeviceId_idx" ON "Sale"("posDeviceId");
CREATE INDEX "MoneyTransaction_posDeviceId_idx" ON "MoneyTransaction"("posDeviceId");

ALTER TABLE "Sale"
  ADD CONSTRAINT "Sale_posDeviceId_fkey"
  FOREIGN KEY ("posDeviceId") REFERENCES "PosDevice"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MoneyTransaction"
  ADD CONSTRAINT "MoneyTransaction_posDeviceId_fkey"
  FOREIGN KEY ("posDeviceId") REFERENCES "PosDevice"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
