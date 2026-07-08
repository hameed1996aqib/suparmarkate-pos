import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { zodError } from "../../lib/api";
import { getAuthUser, writeAudit } from "../../lib/auth";
import { resolveCurrencySnapshot, snapshotBaseFields, toBaseAmount } from "../../lib/currency-rates";
import {
  createPostedJournal,
  createReversalJournal,
  treasuryAccountCode
} from "../../lib/journal";
import { getRequestPosDevice } from "../../lib/pos-device";
import {
  FinancialCategoryType,
  MoneyDirection,
  MoneyTransactionType
} from "../../generated/prisma/enums";
import { createPaginationMeta, getPagePagination } from "../../lib/pagination";
import { getRecentDateRange } from "../../lib/recent-date-range";
import { Prisma } from "../../generated/prisma/client";

export const incomeExpensesRoute = new Hono();

const accountTypeSchema = z.enum(["CASH", "BANK"]);

const entrySchema = z.object({
  kind: z.enum(["INCOME", "EXPENSE"]),
  currencyId: z.string().min(1),
  accountType: accountTypeSchema,
  accountId: z.string().min(1),
  categoryId: z.string().trim().optional().nullable(),
  amount: z.coerce.number().positive(),
  note: z.string().trim().max(500).optional().nullable()
});

const cancelEntrySchema = z.object({
  reason: z.string().trim().max(500).optional().nullable()
});

async function getAccount(type: "CASH" | "BANK", id: string) {
  if (type === "CASH") {
    const account = await prisma.cashRegisterAccount.findUnique({
      where: { id }
    });

    return account
      ? {
          type,
          id: account.id,
          currencyId: account.currencyId,
          balance: Number(account.balance)
        }
      : null;
  }

  const account = await prisma.bankAccount.findUnique({
    where: { id }
  });

  return account
    ? {
        type,
        id: account.id,
        currencyId: account.currencyId,
        balance: Number(account.balance)
      }
    : null;
}

incomeExpensesRoute.get("/", async (c) => {
  const pagination = getPagePagination(c);
  const range = getRecentDateRange(c);
  const search = c.req.query("search")?.trim();
  const searchWhere = search
    ? {
        OR: [
          { note: { contains: search, mode: "insensitive" as const } },
          { referenceType: { contains: search, mode: "insensitive" as const } },
          { referenceId: { contains: search, mode: "insensitive" as const } },
          { category: { name: { contains: search, mode: "insensitive" as const } } },
          {
            cashRegisterAccount: {
              cashRegister: {
                name: { contains: search, mode: "insensitive" as const },
              },
            },
          },
          { bankAccount: { name: { contains: search, mode: "insensitive" as const } } },
          { bankAccount: { bankName: { contains: search, mode: "insensitive" as const } } },
        ],
      }
    : {};
  const where = {
    createdAt: range,
    type: {
      in: [MoneyTransactionType.INCOME, MoneyTransactionType.EXPENSE]
    },
    ...searchWhere
  };
  const [items, total, summaryRows] = await Promise.all([
    prisma.moneyTransaction.findMany({
    where: {
      ...where
    },
    include: {
      currency: true,
      category: true,
      cashRegisterAccount: {
        include: {
          cashRegister: true
        }
      },
      bankAccount: true,
      createdByUser: {
        select: {
          id: true,
          username: true,
          displayName: true
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    },
    skip: pagination.skip,
    take: pagination.limit
    }),
    prisma.moneyTransaction.count({ where }),
    prisma.$queryRaw<Array<{ income: unknown; expense: unknown; count: number }>>(Prisma.sql`
      SELECT
        COALESCE(SUM(mt."baseAmount") FILTER (WHERE mt."type" = 'INCOME'), 0) income,
        COALESCE(SUM(mt."baseAmount") FILTER (WHERE mt."type" = 'EXPENSE'), 0) expense,
        COUNT(*)::int count
      FROM "MoneyTransaction" mt
      LEFT JOIN "FinancialCategory" fc ON fc.id = mt."categoryId"
      LEFT JOIN "BankAccount" ba ON ba.id = mt."bankAccountId"
      LEFT JOIN "CashRegisterAccount" cra ON cra.id = mt."cashRegisterAccountId"
      LEFT JOIN "CashRegister" cr ON cr.id = cra."cashRegisterId"
      WHERE mt."createdAt" BETWEEN ${range.gte} AND ${range.lte}
        AND mt."type" IN ('INCOME', 'EXPENSE')
        ${
          search
            ? Prisma.sql`AND (
                mt.note ILIKE ${`%${search}%`}
                OR mt."referenceType" ILIKE ${`%${search}%`}
                OR mt."referenceId" ILIKE ${`%${search}%`}
                OR fc.name ILIKE ${`%${search}%`}
                OR ba.name ILIKE ${`%${search}%`}
                OR ba."bankName" ILIKE ${`%${search}%`}
                OR cr.name ILIKE ${`%${search}%`}
              )`
            : Prisma.empty
        }
        AND NOT EXISTS (
          SELECT 1 FROM "MoneyTransaction" cancel
          WHERE cancel."type" = 'ADJUSTMENT'
            AND cancel."referenceId" = mt.id
            AND cancel."referenceType" IN ('INCOME_CANCEL', 'EXPENSE_CANCEL')
        )
    `)
  ]);
  const cancellations = items.length > 0
    ? await prisma.moneyTransaction.findMany({
      where: {
        type: MoneyTransactionType.ADJUSTMENT,
        referenceType: {
          in: ["INCOME_CANCEL", "EXPENSE_CANCEL"]
        },
        referenceId: {
          in: items.map((item) => item.id)
        }
      },
      select: {
        referenceId: true
      }
    })
    : [];

  const cancelledIds = new Set(
    cancellations
      .map((item) => item.referenceId)
      .filter((id): id is string => Boolean(id))
  );

  return c.json({
    data: items.map((item) => ({
      ...item,
      isCancelled: cancelledIds.has(item.id)
    })),
    pagination: createPaginationMeta({ ...pagination, total }),
    summary: {
      income: Number(summaryRows[0]?.income || 0),
      expense: Number(summaryRows[0]?.expense || 0),
      count: Number(summaryRows[0]?.count || 0)
    }
  });
});

incomeExpensesRoute.post("/", async (c) => {
  const authUser = getAuthUser(c);
  const posDevice = await getRequestPosDevice(c, authUser?.id ?? null);
  const body = await c.req.json().catch(() => null);
  const parsed = entrySchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const account = await getAccount(parsed.data.accountType, parsed.data.accountId);

  if (!account) {
    return c.json({ message: "Account not found" }, 404);
  }

  if (account.currencyId !== parsed.data.currencyId) {
    return c.json({ message: "Account currency must match entry currency" }, 400);
  }

  if (parsed.data.kind === "EXPENSE" && account.balance < parsed.data.amount) {
    return c.json({ message: "Not enough balance in account" }, 400);
  }

  if (parsed.data.categoryId) {
    const category = await prisma.financialCategory.findUnique({
      where: { id: parsed.data.categoryId }
    });

    if (!category || !category.isActive) {
      return c.json({ message: "Financial category not found" }, 404);
    }

    if (
      category.type !== FinancialCategoryType.BOTH &&
      category.type !== parsed.data.kind
    ) {
      return c.json({ message: "Financial category type does not match entry kind" }, 400);
    }
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
    let balanceAfter: unknown = null;

    if (parsed.data.accountType === "CASH") {
      const updated = await tx.cashRegisterAccount.update({
        where: { id: parsed.data.accountId },
        data:
          parsed.data.kind === "INCOME"
            ? { balance: { increment: parsed.data.amount } }
            : { balance: { decrement: parsed.data.amount } }
      });
      balanceAfter = updated.balance;
    } else {
      const updated = await tx.bankAccount.update({
        where: { id: parsed.data.accountId },
        data:
          parsed.data.kind === "INCOME"
            ? { balance: { increment: parsed.data.amount } }
            : { balance: { decrement: parsed.data.amount } }
      });
      balanceAfter = updated.balance;
    }

    const transaction = await tx.moneyTransaction.create({
      data: {
        currencyId: parsed.data.currencyId,
        cashRegisterAccountId:
          parsed.data.accountType === "CASH" ? parsed.data.accountId : null,
        bankAccountId:
          parsed.data.accountType === "BANK" ? parsed.data.accountId : null,
        categoryId: parsed.data.categoryId ?? null,
        type:
          parsed.data.kind === "INCOME"
            ? MoneyTransactionType.INCOME
            : MoneyTransactionType.EXPENSE,
        direction:
          parsed.data.kind === "INCOME" ? MoneyDirection.IN : MoneyDirection.OUT,
        amount: parsed.data.amount,
        balanceAfter: balanceAfter as any,
        ...snapshotBaseFields(currencySnapshot, {
          amount: parsed.data.amount,
          balanceAfter: Number(balanceAfter || 0)
        }),
        referenceType: parsed.data.kind,
        createdByUserId: authUser?.id ?? null,
        posDeviceId: posDevice?.id ?? null,
        note: parsed.data.note ?? null
      },
      include: {
        currency: true,
        category: true,
        cashRegisterAccount: {
          include: {
            cashRegister: true
          }
        },
        bankAccount: true
      }
    });

    const journalEntry = await createPostedJournal(tx, {
      entryNoPrefix: parsed.data.kind === "INCOME" ? "JE-INC" : "JE-EXP",
      sourceType: parsed.data.kind,
      sourceId: transaction.id,
      description:
        parsed.data.kind === "INCOME" ? "Income received" : "Expense paid",
      createdByUserId: authUser?.id ?? null,
      lines:
        parsed.data.kind === "INCOME"
          ? [
              {
                accountCode: treasuryAccountCode(parsed.data.accountType),
                debit: parsed.data.amount,
                exchangeRate: currencySnapshot.exchangeRate,
                baseCurrencyId: currencySnapshot.baseCurrencyId,
                note: parsed.data.note ?? "Income received"
              },
              {
                accountCode: "7000",
                credit: parsed.data.amount,
                exchangeRate: currencySnapshot.exchangeRate,
                baseCurrencyId: currencySnapshot.baseCurrencyId,
                note: parsed.data.note ?? "Other income"
              }
            ]
          : [
              {
                accountCode: "6000",
                debit: parsed.data.amount,
                exchangeRate: currencySnapshot.exchangeRate,
                baseCurrencyId: currencySnapshot.baseCurrencyId,
                note: parsed.data.note ?? "Expense paid"
              },
              {
                accountCode: treasuryAccountCode(parsed.data.accountType),
                credit: parsed.data.amount,
                exchangeRate: currencySnapshot.exchangeRate,
                baseCurrencyId: currencySnapshot.baseCurrencyId,
                note: parsed.data.note ?? "Expense paid"
              }
            ]
    });

    return {
      transaction,
      journalEntry
    };
  });

  await writeAudit(c, {
    action:
      parsed.data.kind === "INCOME" ? "INCOME_CREATED" : "EXPENSE_CREATED",
    entityType: "MoneyTransaction",
    entityId: result.transaction.id,
    metadata: {
      kind: parsed.data.kind,
      accountType: parsed.data.accountType,
      amount: parsed.data.amount
    }
  });

  return c.json({ data: result }, 201);
});

incomeExpensesRoute.post("/:id/cancel", async (c) => {
  const authUser = getAuthUser(c);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const parsed = cancelEntrySchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const transaction = await prisma.moneyTransaction.findUnique({
    where: { id }
  });

  if (!transaction) {
    return c.json({ message: "Income/expense transaction not found" }, 404);
  }

  if (
    transaction.type !== MoneyTransactionType.INCOME &&
    transaction.type !== MoneyTransactionType.EXPENSE
  ) {
    return c.json({ message: "Only income and expense entries can be cancelled here" }, 400);
  }

  const cancelReferenceType = `${transaction.type}_CANCEL`;
  const existingCancel = await prisma.moneyTransaction.findFirst({
    where: {
      referenceType: cancelReferenceType,
      referenceId: transaction.id
    }
  });

  if (existingCancel) {
    return c.json({ message: "Transaction is already cancelled" }, 400);
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const amount = Number(transaction.amount);
      const cancelDirection =
        transaction.direction === MoneyDirection.IN
          ? MoneyDirection.OUT
          : MoneyDirection.IN;
      let balanceAfter: unknown = null;

      if (transaction.cashRegisterAccountId) {
        if (cancelDirection === MoneyDirection.OUT) {
          const account = await tx.cashRegisterAccount.findUnique({
            where: { id: transaction.cashRegisterAccountId }
          });

          if (!account || Number(account.balance) < amount) {
            throw new Error("Not enough cash balance to cancel transaction");
          }
        }

        const updated = await tx.cashRegisterAccount.update({
          where: { id: transaction.cashRegisterAccountId },
          data:
            cancelDirection === MoneyDirection.IN
              ? { balance: { increment: amount } }
              : { balance: { decrement: amount } }
        });
        balanceAfter = updated.balance;
      }

      if (transaction.bankAccountId) {
        if (cancelDirection === MoneyDirection.OUT) {
          const account = await tx.bankAccount.findUnique({
            where: { id: transaction.bankAccountId }
          });

          if (!account || Number(account.balance) < amount) {
            throw new Error("Not enough bank balance to cancel transaction");
          }
        }

        const updated = await tx.bankAccount.update({
          where: { id: transaction.bankAccountId },
          data:
            cancelDirection === MoneyDirection.IN
              ? { balance: { increment: amount } }
              : { balance: { decrement: amount } }
        });
        balanceAfter = updated.balance;
      }

      const cancelTransaction = await tx.moneyTransaction.create({
        data: {
          currencyId: transaction.currencyId,
          cashRegisterAccountId: transaction.cashRegisterAccountId,
          bankAccountId: transaction.bankAccountId,
          categoryId: transaction.categoryId,
          type: MoneyTransactionType.ADJUSTMENT,
          direction: cancelDirection,
          amount,
          balanceAfter: balanceAfter as any,
          exchangeRate: Number(transaction.exchangeRate || 1),
          baseCurrencyId: transaction.baseCurrencyId,
          baseAmount: toBaseAmount(amount, {
            exchangeRate: Number(transaction.exchangeRate || 1),
            baseCurrencyId: transaction.baseCurrencyId
          }),
          baseBalanceAfter: toBaseAmount(Number(balanceAfter || 0), {
            exchangeRate: Number(transaction.exchangeRate || 1),
            baseCurrencyId: transaction.baseCurrencyId
          }),
          referenceType: cancelReferenceType,
          referenceId: transaction.id,
          note: parsed.data.reason ?? "Income/expense cancellation",
          createdByUserId: authUser?.id ?? null
        }
      });

      const journalEntry = await createReversalJournal(tx, {
        sourceType: transaction.type,
        sourceId: transaction.id,
        reversalSourceType: cancelReferenceType,
        reversalSourceId: transaction.id,
        entryNoPrefix: transaction.type === "INCOME" ? "JE-INCC" : "JE-EXPC",
        description: `${transaction.type} cancellation`,
        createdByUserId: authUser?.id ?? null
      });

      return {
        transaction: cancelTransaction,
        journalEntry
      };
    });

    await writeAudit(c, {
      action: `${transaction.type}_CANCELLED`,
      entityType: "MoneyTransaction",
      entityId: transaction.id,
      metadata: {
        reason: parsed.data.reason ?? null
      }
    });

    return c.json({ data: result });
  } catch (error) {
    return c.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Income/expense cancellation failed"
      },
      400
    );
  }
});
