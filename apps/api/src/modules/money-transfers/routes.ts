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
import { MoneyDirection, MoneyTransactionType } from "../../generated/prisma/enums";
import { createPaginationMeta, getPagePagination } from "../../lib/pagination";
import { getRecentDateRange } from "../../lib/recent-date-range";

export const moneyTransfersRoute = new Hono();

const accountTypeSchema = z.enum(["CASH", "BANK"]);

const transferSchema = z.object({
  fromType: accountTypeSchema,
  fromAccountId: z.string().min(1),
  toType: accountTypeSchema,
  toAccountId: z.string().min(1),
  amount: z.coerce.number().positive(),
  note: z.string().trim().max(500).optional().nullable()
});

const cancelTransferSchema = z.object({
  reason: z.string().trim().max(500).optional().nullable()
});

async function getAccount(type: "CASH" | "BANK", id: string) {
  if (type === "CASH") {
    const account = await prisma.cashRegisterAccount.findUnique({
      where: { id },
      include: {
        currency: true,
        cashRegister: true
      }
    });

    return account
      ? {
          type,
          id: account.id,
          currencyId: account.currencyId,
          balance: Number(account.balance),
          raw: account
        }
      : null;
  }

  const account = await prisma.bankAccount.findUnique({
    where: { id },
    include: {
      currency: true
    }
  });

  return account
    ? {
        type,
        id: account.id,
        currencyId: account.currencyId,
        balance: Number(account.balance),
        raw: account
      }
    : null;
}

moneyTransfersRoute.post("/", async (c) => {
  const authUser = getAuthUser(c);
  const posDevice = await getRequestPosDevice(c, authUser?.id ?? null);
  const body = await c.req.json().catch(() => null);
  const parsed = transferSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  if (
    parsed.data.fromType === parsed.data.toType &&
    parsed.data.fromAccountId === parsed.data.toAccountId
  ) {
    return c.json({ message: "Cannot transfer to the same account" }, 400);
  }

  const fromAccount = await getAccount(parsed.data.fromType, parsed.data.fromAccountId);
  const toAccount = await getAccount(parsed.data.toType, parsed.data.toAccountId);

  if (!fromAccount) {
    return c.json({ message: "Source account not found" }, 404);
  }

  if (!toAccount) {
    return c.json({ message: "Destination account not found" }, 404);
  }

  if (fromAccount.currencyId !== toAccount.currencyId) {
    return c.json({ message: "Transfer currency must be the same" }, 400);
  }

  if (fromAccount.balance < parsed.data.amount) {
    return c.json({ message: "Not enough balance in source account" }, 400);
  }

  let currencySnapshot;

  try {
    currencySnapshot = await resolveCurrencySnapshot(prisma, fromAccount.currencyId);
  } catch (error) {
    return c.json(
      { message: error instanceof Error ? error.message : "Currency rate could not be resolved" },
      400
    );
  }

  const transferGroupId = crypto.randomUUID();

  const result = await prisma.$transaction(async (tx) => {
    let fromUpdatedBalance: unknown = null;
    let toUpdatedBalance: unknown = null;

    if (parsed.data.fromType === "CASH") {
      const updated = await tx.cashRegisterAccount.update({
        where: { id: parsed.data.fromAccountId },
        data: {
          balance: {
            decrement: parsed.data.amount
          }
        }
      });

      fromUpdatedBalance = updated.balance;
    } else {
      const updated = await tx.bankAccount.update({
        where: { id: parsed.data.fromAccountId },
        data: {
          balance: {
            decrement: parsed.data.amount
          }
        }
      });

      fromUpdatedBalance = updated.balance;
    }

    if (parsed.data.toType === "CASH") {
      const updated = await tx.cashRegisterAccount.update({
        where: { id: parsed.data.toAccountId },
        data: {
          balance: {
            increment: parsed.data.amount
          }
        }
      });

      toUpdatedBalance = updated.balance;
    } else {
      const updated = await tx.bankAccount.update({
        where: { id: parsed.data.toAccountId },
        data: {
          balance: {
            increment: parsed.data.amount
          }
        }
      });

      toUpdatedBalance = updated.balance;
    }

    const outTransaction = await tx.moneyTransaction.create({
      data: {
        currencyId: fromAccount.currencyId,
        cashRegisterAccountId:
          parsed.data.fromType === "CASH" ? parsed.data.fromAccountId : null,
        bankAccountId:
          parsed.data.fromType === "BANK" ? parsed.data.fromAccountId : null,
        type: MoneyTransactionType.TRANSFER,
        direction: MoneyDirection.OUT,
        amount: parsed.data.amount,
        balanceAfter: fromUpdatedBalance as any,
        ...snapshotBaseFields(currencySnapshot, {
          amount: parsed.data.amount,
          balanceAfter: Number(fromUpdatedBalance || 0)
        }),
        transferGroupId,
        createdByUserId: authUser?.id ?? null,
        posDeviceId: posDevice?.id ?? null,
        note: parsed.data.note ?? null
      }
    });

    const inTransaction = await tx.moneyTransaction.create({
      data: {
        currencyId: toAccount.currencyId,
        cashRegisterAccountId:
          parsed.data.toType === "CASH" ? parsed.data.toAccountId : null,
        bankAccountId:
          parsed.data.toType === "BANK" ? parsed.data.toAccountId : null,
        type: MoneyTransactionType.TRANSFER,
        direction: MoneyDirection.IN,
        amount: parsed.data.amount,
        balanceAfter: toUpdatedBalance as any,
        ...snapshotBaseFields(currencySnapshot, {
          amount: parsed.data.amount,
          balanceAfter: Number(toUpdatedBalance || 0)
        }),
        transferGroupId,
        createdByUserId: authUser?.id ?? null,
        posDeviceId: posDevice?.id ?? null,
        note: parsed.data.note ?? null
      }
    });

    const journalEntry = await createPostedJournal(tx, {
      entryNoPrefix: "JE-TRF",
      sourceType: "MONEY_TRANSFER",
      sourceId: transferGroupId,
      description: "Money transfer",
      createdByUserId: authUser?.id ?? null,
      lines: [
        {
          accountCode: treasuryAccountCode(parsed.data.toType),
          debit: parsed.data.amount,
          exchangeRate: currencySnapshot.exchangeRate,
          baseCurrencyId: currencySnapshot.baseCurrencyId,
          note: "Transfer received"
        },
        {
          accountCode: treasuryAccountCode(parsed.data.fromType),
          credit: parsed.data.amount,
          exchangeRate: currencySnapshot.exchangeRate,
          baseCurrencyId: currencySnapshot.baseCurrencyId,
          note: "Transfer sent"
        }
      ]
    });

    return {
      transferGroupId,
      outTransaction,
      inTransaction,
      journalEntry
    };
  });

  await writeAudit(c, {
    action: "MONEY_TRANSFER_CREATED",
    entityType: "MoneyTransaction",
    entityId: result.transferGroupId,
    metadata: {
      amount: parsed.data.amount,
      fromType: parsed.data.fromType,
      toType: parsed.data.toType
    }
  });

  return c.json({ data: result }, 201);
});

moneyTransfersRoute.get("/", async (c) => {
  const pagination = getPagePagination(c);
  const search = c.req.query("search")?.trim();
  const kind = c.req.query("kind")?.trim().toUpperCase();
  const where = {
    createdAt: getRecentDateRange(c),
    ...(kind === "RECEIPT"
      ? {
          OR: [
            { type: MoneyTransactionType.CUSTOMER_PAYMENT },
            { direction: MoneyDirection.IN },
          ],
        }
      : kind === "PAYMENT"
        ? {
            OR: [
              { type: MoneyTransactionType.SUPPLIER_PAYMENT },
              { direction: MoneyDirection.OUT },
            ],
          }
        : kind === "TRANSFER"
          ? { type: MoneyTransactionType.TRANSFER }
          : {}),
    ...(search
      ? {
          AND: [
            {
              OR: [
                { note: { contains: search, mode: "insensitive" as const } },
                { referenceType: { contains: search, mode: "insensitive" as const } },
                { referenceId: { contains: search, mode: "insensitive" as const } },
                { createdByUser: { username: { contains: search, mode: "insensitive" as const } } },
                { createdByUser: { displayName: { contains: search, mode: "insensitive" as const } } },
                { cashRegisterAccount: { cashRegister: { name: { contains: search, mode: "insensitive" as const } } } },
                { bankAccount: { name: { contains: search, mode: "insensitive" as const } } },
                { bankAccount: { bankName: { contains: search, mode: "insensitive" as const } } },
              ],
            },
          ],
        }
      : {})
  };
  const [items, total] = await Promise.all([
    prisma.moneyTransaction.findMany({
    where,
    include: {
      currency: true,
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
    prisma.moneyTransaction.count({ where })
  ]);

  const partyTransactionIds = items
    .filter((item) => item.referenceId && (
      item.referenceType === "CUSTOMER_PAYMENT" ||
      item.referenceType === "SUPPLIER_PAYMENT" ||
      item.referenceType === "CUSTOMER_PAYMENT_CANCEL" ||
      item.referenceType === "SUPPLIER_PAYMENT_CANCEL"
    ))
    .map((item) => item.referenceId as string);
  const partyTransactions = partyTransactionIds.length > 0
    ? await prisma.partyTransaction.findMany({
        where: {
          id: {
            in: partyTransactionIds
          }
        },
        include: {
          party: {
            include: {
              accounts: true
            }
          },
          currency: true
        }
      })
    : [];
  const partyTransactionsById = new Map(
    partyTransactions.map((transaction) => [transaction.id, transaction])
  );

  return c.json({
    data: items.map((item) => ({
      ...item,
      partyTransaction: item.referenceId
        ? partyTransactionsById.get(item.referenceId) ?? null
        : null
    })),
    pagination: createPaginationMeta({ ...pagination, total })
  });
});

moneyTransfersRoute.post("/:transferGroupId/cancel", async (c) => {
  const authUser = getAuthUser(c);
  const transferGroupId = c.req.param("transferGroupId");
  const body = await c.req.json().catch(() => ({}));
  const parsed = cancelTransferSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const transactions = await prisma.moneyTransaction.findMany({
    where: {
      transferGroupId,
      type: MoneyTransactionType.TRANSFER
    }
  });

  if (transactions.length === 0) {
    return c.json({ message: "Money transfer not found" }, 404);
  }

  const existingCancel = await prisma.moneyTransaction.findFirst({
    where: {
      referenceType: "MONEY_TRANSFER_CANCEL",
      referenceId: transferGroupId
    }
  });

  if (existingCancel) {
    return c.json({ message: "Money transfer is already cancelled" }, 400);
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const cancelTransactions = [];

      for (const transaction of transactions) {
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
              throw new Error("Not enough cash balance to cancel transfer");
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
              throw new Error("Not enough bank balance to cancel transfer");
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
            referenceType: "MONEY_TRANSFER_CANCEL",
            referenceId: transferGroupId,
            note: parsed.data.reason ?? "Money transfer cancellation",
            createdByUserId: authUser?.id ?? null
          }
        });

        cancelTransactions.push(cancelTransaction);
      }

      const journalEntry = await createReversalJournal(tx, {
        sourceType: "MONEY_TRANSFER",
        sourceId: transferGroupId,
        reversalSourceType: "MONEY_TRANSFER_CANCEL",
        reversalSourceId: transferGroupId,
        entryNoPrefix: "JE-TRFC",
        description: "Money transfer cancellation",
        createdByUserId: authUser?.id ?? null
      });

      return {
        transferGroupId,
        transactions: cancelTransactions,
        journalEntry
      };
    });

    await writeAudit(c, {
      action: "MONEY_TRANSFER_CANCELLED",
      entityType: "MoneyTransaction",
      entityId: transferGroupId,
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
            : "Money transfer cancellation failed"
      },
      400
    );
  }
});
