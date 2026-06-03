import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { zodError } from "../../lib/api";
import { getAuthUser, writeAudit } from "../../lib/auth";
import { attachAuditUsers, auditCreateData, auditDeleteData, auditUpdateData } from "../../lib/audit-meta";
import { resolveCurrencySnapshot, snapshotBaseFields } from "../../lib/currency-rates";
import { MoneyDirection, MoneyTransactionType } from "../../generated/prisma/enums";

export const cashRegistersRoute = new Hono();

const createCashRegisterSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().max(50).optional().nullable(),
  location: z.string().trim().max(200).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
  isActive: z.boolean().optional()
});

const updateCashRegisterSchema = createCashRegisterSchema.partial();

const createCashAccountSchema = z.object({
  currencyId: z.string().min(1),
  openingBalance: z.coerce.number().nonnegative().default(0),
  note: z.string().trim().max(500).optional().nullable()
});

const cashTransactionSchema = z.object({
  currencyId: z.string().min(1),
  type: z.nativeEnum(MoneyTransactionType).default(MoneyTransactionType.ADJUSTMENT),
  direction: z.nativeEnum(MoneyDirection),
  amount: z.coerce.number().positive(),
  referenceType: z.string().trim().max(80).optional().nullable(),
  referenceId: z.string().trim().max(120).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable()
});

cashRegistersRoute.get("/", async (c) => {
  const usedRegisterRows = await prisma.cashRegisterAccount.findMany({
    select: {
      cashRegisterId: true
    },
    distinct: ["cashRegisterId"]
  });
  const usedRegisterIds = usedRegisterRows.map((row) => row.cashRegisterId);

  const items = await prisma.cashRegister.findMany({
    where: {
      OR: [
        {
          deletedAt: null
        },
        {
          id: {
            in: usedRegisterIds
          }
        }
      ]
    },
    include: {
      accounts: {
        include: {
          currency: true
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return c.json({ data: await attachAuditUsers(items) });
});

cashRegistersRoute.get("/:id", async (c) => {
  const id = c.req.param("id");

  const item = await prisma.cashRegister.findUnique({
    where: { id },
    include: {
      accounts: {
        include: {
          currency: true,
          transactions: {
            orderBy: {
              createdAt: "desc"
            },
            take: 20
          }
        }
      }
    }
  });

  if (!item || item.deletedAt) {
    return c.json({ message: "Cash register not found" }, 404);
  }

  return c.json({ data: await attachAuditUsers(item) });
});

cashRegistersRoute.post("/", async (c) => {
  const authUser = getAuthUser(c);
  const body = await c.req.json().catch(() => null);
  const parsed = createCashRegisterSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const item = await prisma.cashRegister.create({
    data: {
      ...parsed.data,
      ...auditCreateData(authUser?.id)
    }
  });

  await writeAudit(c, {
    action: "CASH_REGISTER_CREATED",
    entityType: "CashRegister",
    entityId: item.id,
    metadata: { name: item.name, createdByUserId: authUser?.id ?? null }
  });

  return c.json({ data: item }, 201);
});

cashRegistersRoute.patch("/:id", async (c) => {
  const authUser = getAuthUser(c);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = updateCashRegisterSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const item = await prisma.cashRegister.update({
    where: { id },
    data: {
      ...parsed.data,
      ...auditUpdateData(authUser?.id)
    }
  });

  await writeAudit(c, {
    action: "CASH_REGISTER_UPDATED",
    entityType: "CashRegister",
    entityId: item.id,
    metadata: { name: item.name }
  });

  return c.json({ data: item });
});

cashRegistersRoute.delete("/:id", async (c) => {
  const authUser = getAuthUser(c);
  const id = c.req.param("id");

  const accounts = await prisma.cashRegisterAccount.findMany({
    where: {
      cashRegisterId: id
    },
    select: {
      id: true,
      balance: true
    }
  });
  const accountIds = accounts.map((account) => account.id);
  const [transactions, employeePayments] = await Promise.all([
    accountIds.length
      ? prisma.moneyTransaction.count({
          where: {
            cashRegisterAccountId: {
              in: accountIds
            }
          }
        })
      : 0,
    accountIds.length
      ? prisma.employeePayment.count({
          where: {
            cashRegisterAccountId: {
              in: accountIds
            }
          }
        })
      : 0
  ]);
  const balance = accounts.reduce((sum, account) => sum + Number(account.balance || 0), 0);

  if (accounts.length + transactions + employeePayments > 0 || balance !== 0) {
    return c.json(
      {
        message:
          "این صندوق حساب یا معامله دارد و قابل حذف نیست. اگر لازم است، آن را غیرفعال کنید.",
        usage: {
          accounts: accounts.length,
          transactions,
          employeePayments,
          balance
        }
      },
      400
    );
  }

  const item = await prisma.cashRegister.update({
    where: { id },
    data: auditDeleteData(authUser?.id)
  });

  await writeAudit(c, {
    action: "CASH_REGISTER_DELETED",
    entityType: "CashRegister",
    entityId: item.id,
    metadata: { name: item.name }
  });

  return c.json({
    message: "Cash register deactivated",
    data: item
  });
});

cashRegistersRoute.post("/:id/accounts", async (c) => {
  const authUser = getAuthUser(c);
  const cashRegisterId = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = createCashAccountSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const register = await prisma.cashRegister.findUnique({
    where: { id: cashRegisterId }
  });

  if (!register) {
    return c.json({ message: "Cash register not found" }, 404);
  }

  const currency = await prisma.currency.findUnique({
    where: { id: parsed.data.currencyId }
  });

  if (!currency) {
    return c.json({ message: "Currency not found" }, 404);
  }

  let currencySnapshot;

  try {
    currencySnapshot = await resolveCurrencySnapshot(prisma, parsed.data.currencyId);
  } catch (error) {
    return c.json(
      { message: error instanceof Error ? error.message : "Currency rate could not be resolved" },
      400
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const account = await tx.cashRegisterAccount.upsert({
      where: {
        cashRegisterId_currencyId: {
          cashRegisterId,
          currencyId: parsed.data.currencyId
        }
      },
      create: {
        cashRegisterId,
        currencyId: parsed.data.currencyId,
        balance: parsed.data.openingBalance
      },
      update: {},
      include: {
        currency: true
      }
    });

    let transaction = null;

    if (parsed.data.openingBalance > 0) {
      transaction = await tx.moneyTransaction.create({
        data: {
          currencyId: parsed.data.currencyId,
          cashRegisterAccountId: account.id,
          type: MoneyTransactionType.OPENING_BALANCE,
          direction: MoneyDirection.IN,
          amount: parsed.data.openingBalance,
          balanceAfter: account.balance,
          ...snapshotBaseFields(currencySnapshot, {
            amount: parsed.data.openingBalance,
            balanceAfter: Number(account.balance)
          }),
          createdByUserId: authUser?.id ?? null,
          note: parsed.data.note ?? "Opening cash balance"
        }
      });
    }

    return {
      account,
      transaction
    };
  });

  await writeAudit(c, {
    action: "CASH_ACCOUNT_CREATED",
    entityType: "CashRegisterAccount",
    entityId: result.account.id,
    metadata: {
      cashRegisterId,
      currencyId: parsed.data.currencyId,
      openingBalance: parsed.data.openingBalance
    }
  });

  return c.json({ data: result }, 201);
});

cashRegistersRoute.get("/:id/accounts", async (c) => {
  const cashRegisterId = c.req.param("id");

  const accounts = await prisma.cashRegisterAccount.findMany({
    where: {
      cashRegisterId
    },
    include: {
      currency: true
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  return c.json({ data: accounts });
});

cashRegistersRoute.post("/:id/transactions", async (c) => {
  const authUser = getAuthUser(c);
  const cashRegisterId = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = cashTransactionSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const account = await prisma.cashRegisterAccount.findUnique({
    where: {
      cashRegisterId_currencyId: {
        cashRegisterId,
        currencyId: parsed.data.currencyId
      }
    }
  });

  if (!account) {
    return c.json({ message: "Cash account for this currency not found" }, 404);
  }

  if (parsed.data.direction === MoneyDirection.OUT && Number(account.balance) < parsed.data.amount) {
    return c.json({ message: "Not enough cash balance" }, 400);
  }

  let currencySnapshot;

  try {
    currencySnapshot = await resolveCurrencySnapshot(prisma, parsed.data.currencyId);
  } catch (error) {
    return c.json(
      { message: error instanceof Error ? error.message : "Currency rate could not be resolved" },
      400
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const updatedAccount = await tx.cashRegisterAccount.update({
      where: { id: account.id },
      data:
        parsed.data.direction === MoneyDirection.IN
          ? {
              balance: {
                increment: parsed.data.amount
              }
            }
          : {
              balance: {
                decrement: parsed.data.amount
              }
            },
      include: {
        currency: true
      }
    });

    const transaction = await tx.moneyTransaction.create({
      data: {
        currencyId: parsed.data.currencyId,
        cashRegisterAccountId: account.id,
        type: parsed.data.type,
        direction: parsed.data.direction,
        amount: parsed.data.amount,
        balanceAfter: updatedAccount.balance,
        ...snapshotBaseFields(currencySnapshot, {
          amount: parsed.data.amount,
          balanceAfter: Number(updatedAccount.balance)
        }),
        createdByUserId: authUser?.id ?? null,
        referenceType: parsed.data.referenceType ?? null,
        referenceId: parsed.data.referenceId ?? null,
        note: parsed.data.note ?? null
      }
    });

    return {
      account: updatedAccount,
      transaction
    };
  });

  await writeAudit(c, {
    action: "CASH_TRANSACTION_CREATED",
    entityType: "MoneyTransaction",
    entityId: result.transaction.id,
    metadata: {
      cashRegisterId,
      type: parsed.data.type,
      direction: parsed.data.direction,
      amount: parsed.data.amount
    }
  });

  return c.json({ data: result }, 201);
});
