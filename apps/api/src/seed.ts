import "dotenv/config";
import { prisma } from "./lib/prisma";
import { hashPassword } from "./lib/auth";
import { baselinePermissions as permissions, baselineRolePermissions as rolePermissions } from "./lib/store-baseline";

async function main() {
  const permissionRows = await Promise.all(
    permissions.map((key) =>
      prisma.permission.upsert({
        where: { key },
        update: {},
        create: {
          key,
          description: key
        }
      })
    )
  );
  const permissionByKey = new Map(permissionRows.map((permission) => [permission.key, permission]));

  for (const [name, keys] of Object.entries(rolePermissions)) {
    await prisma.role.upsert({
      where: { name },
      update: {
        isSystem: true,
        isActive: true,
        permissions: {
          set: keys.map((key) => ({ id: permissionByKey.get(key)!.id }))
        }
      },
      create: {
        name,
        description: `${name} role`,
        isSystem: true,
        permissions: {
          connect: keys.map((key) => ({ id: permissionByKey.get(key)!.id }))
        }
      }
    });
  }

  const adminRole = await prisma.role.findUniqueOrThrow({
    where: {
      name: "Admin"
    }
  });

  const adminUsername = process.env.SEED_ADMIN_USERNAME || "admin";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || "admin12345";

  await prisma.user.upsert({
    where: {
      username: adminUsername
    },
    update: {
      roleId: adminRole.id,
      isActive: true
    },
    create: {
      username: adminUsername,
      displayName: "System Admin",
      passwordHash: await hashPassword(adminPassword),
      roleId: adminRole.id
    }
  });

  const currency = await prisma.currency.upsert({
    where: { code: "AFN" },
    update: {
      name: "Afghani",
      symbol: "AFN",
      isBase: true,
      isActive: true
    },
    create: {
      code: "AFN",
      name: "Afghani",
      symbol: "AFN",
      isBase: true
    }
  });

  await prisma.currency.updateMany({
    where: {
      code: {
        not: "AFN"
      },
      isBase: true
    },
    data: {
      isBase: false
    }
  });

  const baseRate = await prisma.currencyRate.findFirst({
    where: {
      currencyId: currency.id,
      deletedAt: null
    }
  });

  if (!baseRate) {
    await prisma.currencyRate.create({
      data: {
        currencyId: currency.id,
        rateToBase: 1,
        note: "Initial base currency rate"
      }
    });
  }

  const warehouse = await prisma.warehouse.findFirst({
    where: {
      isDefault: true
    }
  });

  if (!warehouse) {
    await prisma.warehouse.create({
      data: {
        name: "گدام مرکزی",
        location: "فروشگاه",
        isDefault: true
      }
    });
  }

  const unit = await prisma.unit.findFirst({
    where: {
      name: "عدد"
    }
  });

  if (!unit) {
    await prisma.unit.create({
      data: {
        name: "عدد",
        shortName: "عدد"
      }
    });
  }

  const cashRegister = await prisma.cashRegister.upsert({
    where: {
      code: "MAIN"
    },
    update: {
      name: "صندوق مرکزی",
      isActive: true
    },
    create: {
      name: "صندوق مرکزی",
      code: "MAIN",
      location: "فروشگاه"
    }
  });

  await prisma.cashRegisterAccount.upsert({
    where: {
      cashRegisterId_currencyId: {
        cashRegisterId: cashRegister.id,
        currencyId: currency.id
      }
    },
    update: {},
    create: {
      cashRegisterId: cashRegister.id,
      currencyId: currency.id,
      balance: 0
    }
  });

  const companySetting = await prisma.companySetting.findFirst({
    orderBy: { createdAt: "asc" }
  });
  if (!companySetting) {
    await prisma.companySetting.create({
      data: {
        companyName: "Muhaseb",
        defaultCurrencyId: currency.id
      }
    });
  } else if (!companySetting.defaultCurrencyId) {
    await prisma.companySetting.update({
      where: { id: companySetting.id },
      data: { defaultCurrencyId: currency.id }
    });
  }

  const chartAccounts = [
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

  for (const account of chartAccounts) {
    await prisma.accountingAccount.upsert({
      where: { code: account.code },
      update: {
        name: account.name,
        type: account.type,
        isCash: account.isCash,
        isBank: account.isBank,
        isActive: true
      },
      create: {
        ...account,
        isActive: true
      }
    });
  }

  console.log(`Seed completed. Admin username: ${adminUsername}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
