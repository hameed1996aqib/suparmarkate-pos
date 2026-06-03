-- Employee management, QR attendance and payroll for one-store production setup.

ALTER TYPE "MoneyTransactionType" ADD VALUE 'PAYROLL_PAYMENT';

CREATE TYPE "AttendanceStatus" AS ENUM (
  'PRESENT',
  'HALF_PRESENT',
  'ABSENT',
  'LATE',
  'OVERTIME',
  'MISSING_CHECKOUT',
  'MANUAL_ADJUSTED'
);

CREATE TYPE "PayrollRunStatus" AS ENUM (
  'DRAFT',
  'REVIEWED',
  'PAID',
  'CANCELLED'
);

CREATE TABLE "Employee" (
  "id" TEXT NOT NULL,
  "code" TEXT,
  "fullName" TEXT NOT NULL,
  "phone" TEXT,
  "address" TEXT,
  "position" TEXT,
  "note" TEXT,
  "monthlySalary" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "overtimeHourlyRate" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "allowOvertime" BOOLEAN NOT NULL DEFAULT false,
  "overtimeMaxHours" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "userId" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "deletedByUserId" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmployeeShift" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "name" TEXT NOT NULL DEFAULT 'Default',
  "startTime" TEXT NOT NULL,
  "endTime" TEXT NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT true,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmployeeShift_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AttendancePeriod" (
  "id" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "isClosed" BOOLEAN NOT NULL DEFAULT false,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "deletedByUserId" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AttendancePeriod_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AttendanceWorkday" (
  "id" TEXT NOT NULL,
  "periodId" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "isWorkday" BOOLEAN NOT NULL DEFAULT true,
  "isHalfDay" BOOLEAN NOT NULL DEFAULT false,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AttendanceWorkday_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AttendanceRecord" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "workdayId" TEXT,
  "date" TIMESTAMP(3) NOT NULL,
  "checkInAt" TIMESTAMP(3),
  "checkOutAt" TIMESTAMP(3),
  "status" "AttendanceStatus" NOT NULL DEFAULT 'ABSENT',
  "workedMinutes" INTEGER NOT NULL DEFAULT 0,
  "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
  "lateMinutes" INTEGER NOT NULL DEFAULT 0,
  "note" TEXT,
  "qrTokenId" TEXT,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AttendanceQrToken" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "purpose" TEXT NOT NULL DEFAULT 'ATTENDANCE',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AttendanceQrToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PayrollRun" (
  "id" TEXT NOT NULL,
  "periodId" TEXT NOT NULL,
  "status" "PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
  "note" TEXT,
  "totalBaseSalary" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "totalOvertime" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "totalEarned" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "totalPaid" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "totalRemaining" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "deletedByUserId" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PayrollLine" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "workingDays" INTEGER NOT NULL DEFAULT 0,
  "presentDays" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "halfDays" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "absentDays" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "overtimeHours" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "baseSalary" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "overtimeAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "grossPay" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "paidAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "remainingAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayrollLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmployeePayment" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "payrollRunId" TEXT,
  "payrollLineId" TEXT,
  "currencyId" TEXT NOT NULL,
  "cashRegisterAccountId" TEXT,
  "bankAccountId" TEXT,
  "amount" DECIMAL(18,4) NOT NULL,
  "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "note" TEXT,
  "moneyTransactionId" TEXT,
  "journalEntryId" TEXT,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "deletedByUserId" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmployeePayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Employee_code_key" ON "Employee"("code");
CREATE UNIQUE INDEX "Employee_userId_key" ON "Employee"("userId");
CREATE INDEX "Employee_fullName_idx" ON "Employee"("fullName");
CREATE INDEX "Employee_code_idx" ON "Employee"("code");
CREATE INDEX "Employee_userId_idx" ON "Employee"("userId");
CREATE INDEX "Employee_deletedAt_idx" ON "Employee"("deletedAt");
CREATE INDEX "EmployeeShift_employeeId_idx" ON "EmployeeShift"("employeeId");
CREATE INDEX "EmployeeShift_isActive_idx" ON "EmployeeShift"("isActive");
CREATE UNIQUE INDEX "AttendancePeriod_year_month_key" ON "AttendancePeriod"("year", "month");
CREATE INDEX "AttendancePeriod_deletedAt_idx" ON "AttendancePeriod"("deletedAt");
CREATE UNIQUE INDEX "AttendanceWorkday_periodId_date_key" ON "AttendanceWorkday"("periodId", "date");
CREATE INDEX "AttendanceWorkday_date_idx" ON "AttendanceWorkday"("date");
CREATE UNIQUE INDEX "AttendanceRecord_employeeId_date_key" ON "AttendanceRecord"("employeeId", "date");
CREATE INDEX "AttendanceRecord_employeeId_idx" ON "AttendanceRecord"("employeeId");
CREATE INDEX "AttendanceRecord_date_idx" ON "AttendanceRecord"("date");
CREATE INDEX "AttendanceRecord_status_idx" ON "AttendanceRecord"("status");
CREATE UNIQUE INDEX "AttendanceQrToken_tokenHash_key" ON "AttendanceQrToken"("tokenHash");
CREATE INDEX "AttendanceQrToken_expiresAt_idx" ON "AttendanceQrToken"("expiresAt");
CREATE INDEX "AttendanceQrToken_usedAt_idx" ON "AttendanceQrToken"("usedAt");
CREATE INDEX "PayrollRun_periodId_idx" ON "PayrollRun"("periodId");
CREATE INDEX "PayrollRun_status_idx" ON "PayrollRun"("status");
CREATE INDEX "PayrollRun_deletedAt_idx" ON "PayrollRun"("deletedAt");
CREATE UNIQUE INDEX "PayrollLine_runId_employeeId_key" ON "PayrollLine"("runId", "employeeId");
CREATE INDEX "PayrollLine_employeeId_idx" ON "PayrollLine"("employeeId");
CREATE UNIQUE INDEX "EmployeePayment_moneyTransactionId_key" ON "EmployeePayment"("moneyTransactionId");
CREATE UNIQUE INDEX "EmployeePayment_journalEntryId_key" ON "EmployeePayment"("journalEntryId");
CREATE INDEX "EmployeePayment_employeeId_idx" ON "EmployeePayment"("employeeId");
CREATE INDEX "EmployeePayment_payrollRunId_idx" ON "EmployeePayment"("payrollRunId");
CREATE INDEX "EmployeePayment_payrollLineId_idx" ON "EmployeePayment"("payrollLineId");
CREATE INDEX "EmployeePayment_currencyId_idx" ON "EmployeePayment"("currencyId");
CREATE INDEX "EmployeePayment_cashRegisterAccountId_idx" ON "EmployeePayment"("cashRegisterAccountId");
CREATE INDEX "EmployeePayment_bankAccountId_idx" ON "EmployeePayment"("bankAccountId");
CREATE INDEX "EmployeePayment_deletedAt_idx" ON "EmployeePayment"("deletedAt");

ALTER TABLE "Employee" ADD CONSTRAINT "Employee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmployeeShift" ADD CONSTRAINT "EmployeeShift_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendanceWorkday" ADD CONSTRAINT "AttendanceWorkday_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AttendancePeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_workdayId_fkey" FOREIGN KEY ("workdayId") REFERENCES "AttendanceWorkday"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AttendancePeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollLine" ADD CONSTRAINT "PayrollLine_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayrollLine" ADD CONSTRAINT "PayrollLine_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployeePayment" ADD CONSTRAINT "EmployeePayment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployeePayment" ADD CONSTRAINT "EmployeePayment_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmployeePayment" ADD CONSTRAINT "EmployeePayment_payrollLineId_fkey" FOREIGN KEY ("payrollLineId") REFERENCES "PayrollLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmployeePayment" ADD CONSTRAINT "EmployeePayment_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "Currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployeePayment" ADD CONSTRAINT "EmployeePayment_cashRegisterAccountId_fkey" FOREIGN KEY ("cashRegisterAccountId") REFERENCES "CashRegisterAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmployeePayment" ADD CONSTRAINT "EmployeePayment_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmployeePayment" ADD CONSTRAINT "EmployeePayment_moneyTransactionId_fkey" FOREIGN KEY ("moneyTransactionId") REFERENCES "MoneyTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmployeePayment" ADD CONSTRAINT "EmployeePayment_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
