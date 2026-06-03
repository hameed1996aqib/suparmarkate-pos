import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { zodError } from "../../lib/api";
import { getAuthUser, writeAudit } from "../../lib/auth";
import { attachAuditUsers, auditCreateData, auditDeleteData, auditUpdateData } from "../../lib/audit-meta";
import { resolveCurrencySnapshot, snapshotBaseFields } from "../../lib/currency-rates";
import { MoneyDirection, MoneyTransactionType } from "../../generated/prisma/enums";

export const bankAccountsRoute = new Hono();

const createBankAccountSchema = z.object({
  name: z.string().trim().min(2).max(120),
  bankName: z.string().trim().max(120).optional().nullable(),
  accountNumber: z.string().trim().max(120).optional().nullable(),
  currencyId: z.string().min(1),
  openingBalance: z.coerce.number().nonnegative().default(0),
  note: z.string().trim().max(500).optional().nullable(),
  isActive: z.boolean().optional()
});

const updateBankAccountSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  bankName: z.string().trim().max(120).optional().nullable(),
  accountNumber: z.string().trim().max(120).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
  isActive: z.boolean().optional()
});

const bankTransactionSchema = z.object({
  type: z.nativeEnum(MoneyTransactionType).default(MoneyTransactionType.ADJUSTMENT),
  direction: z.nativeEnum(MoneyDirection),
  amount: z.coerce.number().positive(),
  referenceType: z.string().trim().max(80).optional().nullable(),
  referenceId: z.string().trim().max(120).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable()
});

bankAccountsRoute.get("/", async (c) => {
  const [transactionRows, paymentRows] = await Promise.all([
    prisma.moneyTransaction.findMany({
      where: {
        bankAccountId: {
          not: null
        }
      },
      select: { bankAccountId: true },
      distinct: ["bankAccountId"]
    }),
    prisma.employeePayment.findMany({
      where: {
        bankAccountId: {
          not: null
        }
      },
      select: { bankAccountId: true },
      distinct: ["bankAccountId"]
    })
  ]);
  const usedBankIds = Array.from(
    new Set(
      [...transactionRows, ...paymentRows]
        .map((row) => row.bankAccountId)
        .filter((id): id is string => Boolean(id))
    )
  );

  const items = await prisma.bankAccount.findMany({
    where: {
      OR: [
        {
          deletedAt: null
        },
        {
          id: {
            in: usedBankIds
          }
        }
      ]
    },
    include: {
      currency: true
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return c.json({ data: await attachAuditUsers(items) });
});

bankAccountsRoute.get("/:id", async (c) => {
  const id = c.req.param("id");

  const item = await prisma.bankAccount.findUnique({
    where: { id },
    include: {
      currency: true,
      transactions: {
        orderBy: {
          createdAt: "desc"
        },
        take: 50
      }
    }
  });

  if (!item || item.deletedAt) {
    return c.json({ message: "Bank account not found" }, 404);
  }

  return c.json({ data: await attachAuditUsers(item) });
});

bankAccountsRoute.post("/", async (c) => {
  const authUser = getAuthUser(c);
  const body = await c.req.json().catch(() => null);
  const parsed = createBankAccountSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const currency = await prisma.currency.findUnique({
    where: {
      id: parsed.data.currencyId
    }
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
    const account = await tx.bankAccount.create({
      data: {
        name: parsed.data.name,
        bankName: parsed.data.bankName ?? null,
        accountNumber: parsed.data.accountNumber ?? null,
        currencyId: parsed.data.currencyId,
        balance: parsed.data.openingBalance,
        note: parsed.data.note ?? null,
        isActive: parsed.data.isActive ?? true,
        ...auditCreateData(authUser?.id)
      },
      include: {
        currency: true
      }
    });

    let transaction = null;

    if (parsed.data.openingBalance > 0) {
      transaction = await tx.moneyTransaction.create({
        data: {
          currencyId: parsed.data.currencyId,
          bankAccountId: account.id,
          type: MoneyTransactionType.OPENING_BALANCE,
          direction: MoneyDirection.IN,
          amount: parsed.data.openingBalance,
          balanceAfter: account.balance,
          ...snapshotBaseFields(currencySnapshot, {
            amount: parsed.data.openingBalance,
            balanceAfter: Number(account.balance)
          }),
          createdByUserId: authUser?.id ?? null,
          note: parsed.data.note ?? "Opening bank balance"
        }
      });
    }

    return {
      account,
      transaction
    };
  });

  await writeAudit(c, {
    action: "BANK_ACCOUNT_CREATED",
    entityType: "BankAccount",
    entityId: result.account.id,
    metadata: {
      name: result.account.name,
      currencyId: parsed.data.currencyId,
      openingBalance: parsed.data.openingBalance
    }
  });

  return c.json({ data: result }, 201);
});

bankAccountsRoute.patch("/:id", async (c) => {
  const authUser = getAuthUser(c);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = updateBankAccountSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const item = await prisma.bankAccount.update({
    where: { id },
    data: {
      ...parsed.data,
      ...auditUpdateData(authUser?.id)
    },
    include: {
      currency: true
    }
  });

  await writeAudit(c, {
    action: "BANK_ACCOUNT_UPDATED",
    entityType: "BankAccount",
    entityId: item.id,
    metadata: { name: item.name }
  });

  return c.json({ data: item });
});

bankAccountsRoute.delete("/:id", async (c) => {
  const authUser = getAuthUser(c);
  const id = c.req.param("id");

  const account = await prisma.bankAccount.findUnique({ where: { id } });

  if (!account || account.deletedAt) {
    return c.json({ message: "Bank account not found" }, 404);
  }

  const [transactions, employeePayments] = await Promise.all([
    prisma.moneyTransaction.count({ where: { bankAccountId: id } }),
    prisma.employeePayment.count({ where: { bankAccountId: id } })
  ]);
  const balance = Number(account.balance || 0);

  if (transactions + employeePayments > 0 || balance !== 0) {
    return c.json(
      {
        message:
          "این حساب بانکی مانده یا معامله دارد و قابل حذف نیست. اگر لازم است، آن را غیرفعال کنید.",
        usage: {
          transactions,
          employeePayments,
          balance
        }
      },
      400
    );
  }

  const item = await prisma.bankAccount.update({
    where: { id },
    data: auditDeleteData(authUser?.id)
  });

  await writeAudit(c, {
    action: "BANK_ACCOUNT_DELETED",
    entityType: "BankAccount",
    entityId: item.id,
    metadata: { name: item.name }
  });

  return c.json({
    message: "Bank account deactivated",
    data: item
  });
});

bankAccountsRoute.post("/:id/transactions", async (c) => {
  const authUser = getAuthUser(c);
  const bankAccountId = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = bankTransactionSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const account = await prisma.bankAccount.findUnique({
    where: {
      id: bankAccountId
    }
  });

  if (!account) {
    return c.json({ message: "Bank account not found" }, 404);
  }

  if (parsed.data.direction === MoneyDirection.OUT && Number(account.balance) < parsed.data.amount) {
    return c.json({ message: "Not enough bank balance" }, 400);
  }

  let currencySnapshot;

  try {
    currencySnapshot = await resolveCurrencySnapshot(prisma, account.currencyId);
  } catch (error) {
    return c.json(
      { message: error instanceof Error ? error.message : "Currency rate could not be resolved" },
      400
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const updatedAccount = await tx.bankAccount.update({
      where: { id: bankAccountId },
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
        currencyId: account.currencyId,
        bankAccountId,
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
    action: "BANK_TRANSACTION_CREATED",
    entityType: "MoneyTransaction",
    entityId: result.transaction.id,
    metadata: {
      bankAccountId,
      type: parsed.data.type,
      direction: parsed.data.direction,
      amount: parsed.data.amount
    }
  });

  return c.json({ data: result }, 201);
});
