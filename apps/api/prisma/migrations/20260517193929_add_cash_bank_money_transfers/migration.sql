-- CreateEnum
CREATE TYPE "MoneyDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "MoneyTransactionType" AS ENUM ('OPENING_BALANCE', 'SALE_PAYMENT', 'CUSTOMER_PAYMENT', 'SUPPLIER_PAYMENT', 'EXPENSE', 'INCOME', 'TRANSFER', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "CashRegister" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "location" TEXT,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashRegister_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashRegisterAccount" (
    "id" TEXT NOT NULL,
    "cashRegisterId" TEXT NOT NULL,
    "currencyId" TEXT NOT NULL,
    "balance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashRegisterAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bankName" TEXT,
    "accountNumber" TEXT,
    "currencyId" TEXT NOT NULL,
    "balance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoneyTransaction" (
    "id" TEXT NOT NULL,
    "currencyId" TEXT NOT NULL,
    "cashRegisterAccountId" TEXT,
    "bankAccountId" TEXT,
    "type" "MoneyTransactionType" NOT NULL,
    "direction" "MoneyDirection" NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "balanceAfter" DECIMAL(18,4),
    "transferGroupId" TEXT,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoneyTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CashRegister_code_key" ON "CashRegister"("code");

-- CreateIndex
CREATE INDEX "CashRegister_name_idx" ON "CashRegister"("name");

-- CreateIndex
CREATE INDEX "CashRegister_code_idx" ON "CashRegister"("code");

-- CreateIndex
CREATE INDEX "CashRegisterAccount_currencyId_idx" ON "CashRegisterAccount"("currencyId");

-- CreateIndex
CREATE UNIQUE INDEX "CashRegisterAccount_cashRegisterId_currencyId_key" ON "CashRegisterAccount"("cashRegisterId", "currencyId");

-- CreateIndex
CREATE INDEX "BankAccount_name_idx" ON "BankAccount"("name");

-- CreateIndex
CREATE INDEX "BankAccount_bankName_idx" ON "BankAccount"("bankName");

-- CreateIndex
CREATE INDEX "BankAccount_currencyId_idx" ON "BankAccount"("currencyId");

-- CreateIndex
CREATE INDEX "MoneyTransaction_currencyId_idx" ON "MoneyTransaction"("currencyId");

-- CreateIndex
CREATE INDEX "MoneyTransaction_cashRegisterAccountId_idx" ON "MoneyTransaction"("cashRegisterAccountId");

-- CreateIndex
CREATE INDEX "MoneyTransaction_bankAccountId_idx" ON "MoneyTransaction"("bankAccountId");

-- CreateIndex
CREATE INDEX "MoneyTransaction_type_idx" ON "MoneyTransaction"("type");

-- CreateIndex
CREATE INDEX "MoneyTransaction_direction_idx" ON "MoneyTransaction"("direction");

-- CreateIndex
CREATE INDEX "MoneyTransaction_transferGroupId_idx" ON "MoneyTransaction"("transferGroupId");

-- CreateIndex
CREATE INDEX "MoneyTransaction_createdAt_idx" ON "MoneyTransaction"("createdAt");

-- AddForeignKey
ALTER TABLE "CashRegisterAccount" ADD CONSTRAINT "CashRegisterAccount_cashRegisterId_fkey" FOREIGN KEY ("cashRegisterId") REFERENCES "CashRegister"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashRegisterAccount" ADD CONSTRAINT "CashRegisterAccount_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "Currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "Currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyTransaction" ADD CONSTRAINT "MoneyTransaction_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "Currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyTransaction" ADD CONSTRAINT "MoneyTransaction_cashRegisterAccountId_fkey" FOREIGN KEY ("cashRegisterAccountId") REFERENCES "CashRegisterAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyTransaction" ADD CONSTRAINT "MoneyTransaction_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
