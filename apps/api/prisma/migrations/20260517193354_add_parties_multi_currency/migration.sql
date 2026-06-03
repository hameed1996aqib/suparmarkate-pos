-- CreateEnum
CREATE TYPE "PartyType" AS ENUM ('CUSTOMER', 'SUPPLIER', 'BOTH');

-- CreateEnum
CREATE TYPE "PartyAccountSide" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "PartyTransactionType" AS ENUM ('OPENING_BALANCE', 'SALE_CREDIT', 'PURCHASE_CREDIT', 'PAYMENT_RECEIVED', 'PAYMENT_PAID', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "Party" (
    "id" TEXT NOT NULL,
    "type" "PartyType" NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartyAccount" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "currencyId" TEXT NOT NULL,
    "debitBalance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "creditBalance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartyAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartyTransaction" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "currencyId" TEXT NOT NULL,
    "type" "PartyTransactionType" NOT NULL,
    "side" "PartyAccountSide" NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartyTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Party_type_idx" ON "Party"("type");

-- CreateIndex
CREATE INDEX "Party_name_idx" ON "Party"("name");

-- CreateIndex
CREATE INDEX "Party_phone_idx" ON "Party"("phone");

-- CreateIndex
CREATE INDEX "PartyAccount_currencyId_idx" ON "PartyAccount"("currencyId");

-- CreateIndex
CREATE UNIQUE INDEX "PartyAccount_partyId_currencyId_key" ON "PartyAccount"("partyId", "currencyId");

-- CreateIndex
CREATE INDEX "PartyTransaction_partyId_idx" ON "PartyTransaction"("partyId");

-- CreateIndex
CREATE INDEX "PartyTransaction_currencyId_idx" ON "PartyTransaction"("currencyId");

-- CreateIndex
CREATE INDEX "PartyTransaction_type_idx" ON "PartyTransaction"("type");

-- CreateIndex
CREATE INDEX "PartyTransaction_side_idx" ON "PartyTransaction"("side");

-- CreateIndex
CREATE INDEX "PartyTransaction_createdAt_idx" ON "PartyTransaction"("createdAt");

-- AddForeignKey
ALTER TABLE "PartyAccount" ADD CONSTRAINT "PartyAccount_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyAccount" ADD CONSTRAINT "PartyAccount_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "Currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyTransaction" ADD CONSTRAINT "PartyTransaction_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyTransaction" ADD CONSTRAINT "PartyTransaction_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "Currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
