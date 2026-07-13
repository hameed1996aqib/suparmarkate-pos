import type { PrismaClient } from "../generated/prisma/client";

type DbClient = PrismaClient | any;

export const baselinePermissions = [
  "dashboard.view",
  "alerts.view",
  "pos.sell",
  "sales.view",
  "sales.manage",
  "purchases.view",
  "purchases.manage",
  "inventory.view",
  "inventory.manage",
  "products.manage",
  "parties.manage",
  "cashbank.manage",
  "accounting.view",
  "accounting.manage",
  "reports.view",
  "users.manage",
  "settings.manage",
  "backup.manage",
  "employees.view",
  "employees.manage",
  "attendance.view",
  "attendance.manage",
  "payroll.view",
  "payroll.manage"
];

export const baselineRolePermissions: Record<string, string[]> = {
  Admin: baselinePermissions,
  Manager: baselinePermissions.filter((permission) => permission !== "users.manage"),
  Cashier: ["dashboard.view", "pos.sell", "sales.view"],
  Inventory: ["alerts.view", "inventory.view", "inventory.manage", "products.manage"],
  Accountant: [
    "dashboard.view",
    "sales.view",
    "purchases.view",
    "cashbank.manage",
    "accounting.view",
    "accounting.manage",
    "reports.view"
  ],
  HR: [
    "dashboard.view",
    "employees.view",
    "employees.manage",
    "attendance.view",
    "attendance.manage",
    "payroll.view",
    "payroll.manage",
    "reports.view"
  ]
};

export async function bootstrapStore(
  db: DbClient,
  admin: { username: string; displayName: string; passwordHash: string }
) {
  const permissionRows = await Promise.all(
    baselinePermissions.map((key) =>
      db.permission.create({
        data: { key, description: key }
      })
    )
  );
  const permissionByKey = new Map(permissionRows.map((permission: { id: string; key: string }) => [permission.key, permission]));

  for (const [name, keys] of Object.entries(baselineRolePermissions)) {
    await db.role.create({
      data: {
        name,
        description: `${name} role`,
        isSystem: true,
        permissions: {
          connect: keys.map((key) => ({ id: permissionByKey.get(key)!.id }))
        }
      }
    });
  }

  const adminRole = await db.role.findUniqueOrThrow({ where: { name: "Admin" } });
  await db.user.create({
    data: {
      username: admin.username,
      displayName: admin.displayName,
      passwordHash: admin.passwordHash,
      roleId: adminRole.id,
      isActive: true
    }
  });

  const currency = await db.currency.create({
    data: { code: "AFN", name: "Afghani", symbol: "AFN", isBase: true, isActive: true }
  });
  await db.currencyRate.create({
    data: { currencyId: currency.id, rateToBase: 1, note: "Initial base currency rate" }
  });
  await db.warehouse.create({
    data: { name: "گدام مرکزی", location: "فروشگاه", isDefault: true }
  });
  await db.unit.create({
    data: { name: "عدد", shortName: "عدد" }
  });
  const cashRegister = await db.cashRegister.create({
    data: { name: "صندوق مرکزی", code: "MAIN", location: "فروشگاه" }
  });
  await db.cashRegisterAccount.create({
    data: { cashRegisterId: cashRegister.id, currencyId: currency.id, balance: 0 }
  });

  const accounts = [
    { code: "1000", name: "Cash", type: "ASSET", isCash: true, isBank: false },
    { code: "1100", name: "Bank", type: "ASSET", isCash: false, isBank: true },
    { code: "1200", name: "Accounts Receivable", type: "ASSET", isCash: false, isBank: false },
    { code: "1300", name: "Inventory", type: "ASSET", isCash: false, isBank: false },
    { code: "2000", name: "Accounts Payable", type: "LIABILITY", isCash: false, isBank: false },
    { code: "3000", name: "Owner Capital", type: "EQUITY", isCash: false, isBank: false },
    { code: "4000", name: "Sales Revenue", type: "INCOME", isCash: false, isBank: false },
    { code: "4100", name: "Sales Discount", type: "EXPENSE", isCash: false, isBank: false },
    { code: "4200", name: "Sales Returns", type: "EXPENSE", isCash: false, isBank: false },
    { code: "5000", name: "Cost of Goods Sold", type: "EXPENSE", isCash: false, isBank: false },
    { code: "6000", name: "General Expenses", type: "EXPENSE", isCash: false, isBank: false },
    { code: "6100", name: "Payroll Expense", type: "EXPENSE", isCash: false, isBank: false },
    { code: "7000", name: "Other Income", type: "INCOME", isCash: false, isBank: false }
  ];

  await db.accountingAccount.createMany({ data: accounts });
  await db.companySetting.create({
    data: {
      companyName: "Muhaseb",
      defaultCurrencyId: currency.id
    }
  });
}
