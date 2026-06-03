-- DropIndex
DROP INDEX "EmployeePayment_bankAccountId_idx";

-- DropIndex
DROP INDEX "EmployeePayment_cashRegisterAccountId_idx";

-- AlterTable
ALTER TABLE "_PermissionToRole" ADD CONSTRAINT "_PermissionToRole_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_PermissionToRole_AB_unique";
