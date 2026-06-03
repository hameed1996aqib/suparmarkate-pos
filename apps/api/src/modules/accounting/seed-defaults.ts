import { prisma } from "../../lib/prisma";

const defaultAccounts = [
  { code: "1000", name: "Cash / صندوق نقدی", type: "ASSET", isCash: true, isBank: false },
  { code: "1100", name: "Bank / حساب بانک", type: "ASSET", isCash: false, isBank: true },
  { code: "1200", name: "Accounts Receivable / طلبات مشتریان", type: "ASSET", isCash: false, isBank: false },
  { code: "1300", name: "Inventory / موجودی اجناس", type: "ASSET", isCash: false, isBank: false },
  { code: "2000", name: "Accounts Payable / قرض فروشندگان", type: "LIABILITY", isCash: false, isBank: false },
  { code: "3000", name: "Owner Capital / سرمایه مالک", type: "EQUITY", isCash: false, isBank: false },
  { code: "4000", name: "Sales Revenue / عواید فروش", type: "INCOME", isCash: false, isBank: false },
  { code: "4100", name: "Sales Discount / تخفیف فروش", type: "EXPENSE", isCash: false, isBank: false },
  { code: "5000", name: "Cost of Goods Sold / مصرف جنس فروخته‌شده", type: "EXPENSE", isCash: false, isBank: false },
  { code: "6000", name: "General Expenses / مصارف عمومی", type: "EXPENSE", isCash: false, isBank: false }
];

async function main() {
  for (const account of defaultAccounts) {
    await prisma.accountingAccount.upsert({
      where: {
        code: account.code
      },
      update: {
        name: account.name,
        type: account.type,
        isCash: account.isCash,
        isBank: account.isBank,
        isActive: true
      },
      create: {
        code: account.code,
        name: account.name,
        type: account.type,
        isCash: account.isCash,
        isBank: account.isBank,
        isActive: true
      }
    });

    console.log(`Account ready: ${account.code} - ${account.name}`);
  }

  console.log("Default accounting accounts seeded successfully.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });