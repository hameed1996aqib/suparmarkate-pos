import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { zodError } from "../../lib/api";
import { getAuthUser, writeAudit } from "../../lib/auth";
import { snapshotBaseFields, toBaseAmount } from "../../lib/currency-rates";
import { createPostedJournal, createReversalJournal, treasuryAccountCode } from "../../lib/journal";
import { getRequestPosDevice } from "../../lib/pos-device";
import {
  MoneyDirection,
  MoneyTransactionType,
  PartyAccountSide,
  PartyTransactionType,
  StockMovementType
} from "../../generated/prisma/enums";
import { createPaginationMeta, getPagePagination } from "../../lib/pagination";
import { getRecentDateRange } from "../../lib/recent-date-range";
import { normalizeBarcodeText } from "../../lib/barcode";

export const saleReturnsRoute = new Hono();

const accountTypeSchema = z.enum(["CASH", "BANK"]);

const saleReturnSchema = z.object({
  saleId: z.string().min(1),
  returnNo: z.string().trim().max(120).optional().nullable(),
  refundAccountType: accountTypeSchema.optional().nullable(),
  refundAccountId: z.string().trim().optional().nullable(),
  refundAmount: z.coerce.number().nonnegative().default(0),
  note: z.string().trim().max(500).optional().nullable(),
  items: z.array(
    z.object({
      saleItemId: z.string().min(1),
      quantity: z.coerce.number().positive()
    })
  ).min(1)
});

const cancelSaleReturnSchema = z.object({
  reason: z.string().trim().min(1).max(500)
});

async function getTreasuryAccount(type: "CASH" | "BANK", id: string) {
  if (type === "CASH") {
    const account = await prisma.cashRegisterAccount.findUnique({
      where: { id }
    });

    return account
      ? { type, id: account.id, currencyId: account.currencyId, balance: Number(account.balance) }
      : null;
  }

  const account = await prisma.bankAccount.findUnique({
    where: { id }
  });

  return account
    ? { type, id: account.id, currencyId: account.currencyId, balance: Number(account.balance) }
    : null;
}

saleReturnsRoute.get("/", async (c) => {
  const pagination = getPagePagination(c);
  const search = c.req.query("search")?.trim();
  const where = {
    createdAt: getRecentDateRange(c),
    ...(search
      ? {
          OR: [
            { returnNo: { contains: search, mode: "insensitive" as const } },
            { note: { contains: search, mode: "insensitive" as const } },
            { sale: { invoiceNo: { contains: search, mode: "insensitive" as const } } },
            { customer: { name: { contains: search, mode: "insensitive" as const } } },
            { customer: { phone: { contains: search, mode: "insensitive" as const } } },
            { items: { some: { product: { name: { contains: search, mode: "insensitive" as const } } } } },
            { items: { some: { product: { barcode: { contains: search, mode: "insensitive" as const } } } } },
            { items: { some: { product: { barcodeNormalized: { contains: normalizeBarcodeText(search), mode: "insensitive" as const } } } } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.saleReturn.findMany({
    where,
    include: {
      sale: true,
      customer: true,
      currency: true,
      createdByUser: true,
      posDevice: true,
      items: {
        include: {
          product: true,
          warehouse: true,
          lot: true
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    },
    skip: pagination.skip,
    take: pagination.limit
  }),
    prisma.saleReturn.count({ where })
  ]);

  return c.json({ data: items, pagination: createPaginationMeta({ ...pagination, total }) });
});

saleReturnsRoute.post("/", async (c) => {
  const authUser = getAuthUser(c);
  const posDevice = await getRequestPosDevice(c, authUser?.id || null);
  const body = await c.req.json().catch(() => null);
  const parsed = saleReturnSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const sale = await prisma.sale.findUnique({
    where: { id: parsed.data.saleId },
    include: {
      customer: true,
      items: {
        include: {
          product: true,
          warehouse: true,
          lot: true,
          returnItems: {
            include: {
              saleReturn: true
            }
          }
        }
      }
    }
  });

  if (!sale) {
    return c.json({ message: "Sale not found" }, 404);
  }

  const requestedByItem = new Map(parsed.data.items.map((item) => [item.saleItemId, item]));
  const preparedItems: any[] = [];

  for (const requestItem of parsed.data.items) {
    const saleItem = sale.items.find((item) => item.id === requestItem.saleItemId);

    if (!saleItem) {
      return c.json({ message: `Sale item not found: ${requestItem.saleItemId}` }, 404);
    }

    const quantityBase = requestItem.quantity * Number(saleItem.conversionRate);
    const returnedBase = saleItem.returnItems.filter((item) => !item.saleReturn.cancelledAt).reduce(
      (sum, item) => sum + Number(item.quantityBase || 0),
      0
    );
    const availableBase = Number(saleItem.quantityBase) - returnedBase;

    if (quantityBase > availableBase + 0.0001) {
      return c.json({
        message: `Return quantity exceeds sold quantity for ${saleItem.product.name}`,
        availableBase
      }, 400);
    }

    const ratio = requestItem.quantity / Number(saleItem.quantity);
    const totalPrice = Number(saleItem.totalPrice) * ratio;
    const totalCost = saleItem.totalCost === null ? null : Number(saleItem.totalCost) * ratio;
    const baseTotalCost =
      saleItem.baseTotalCost === null
        ? totalCost
        : Number(saleItem.baseTotalCost) * ratio;

    preparedItems.push({
      saleItem,
      quantity: requestItem.quantity,
      quantityBase,
      unitPrice: Number(saleItem.unitPrice),
      totalPrice,
      unitCostBase: saleItem.unitCostBase === null ? null : Number(saleItem.unitCostBase),
      totalCost,
      baseTotalCost
    });
  }

  if (requestedByItem.size !== parsed.data.items.length) {
    return c.json({ message: "Duplicate return item was provided" }, 400);
  }

  const subtotal = preparedItems.reduce((sum, item) => sum + item.totalPrice, 0);

  if (parsed.data.refundAmount > subtotal) {
    return c.json({ message: "Refund amount cannot exceed return total" }, 400);
  }

  const receivableAdjustment = subtotal - parsed.data.refundAmount;
  const saleSnapshot = {
    exchangeRate: Number(sale.exchangeRate || 1),
    baseCurrencyId: sale.baseCurrencyId ?? null
  };

  if (receivableAdjustment > 0 && !sale.customerId) {
    return c.json({ message: "Customer is required when return is not fully refunded" }, 400);
  }

  let refundAccount: Awaited<ReturnType<typeof getTreasuryAccount>> = null;

  if (parsed.data.refundAmount > 0) {
    if (!parsed.data.refundAccountType || !parsed.data.refundAccountId) {
      return c.json({ message: "Refund account is required" }, 400);
    }

    refundAccount = await getTreasuryAccount(parsed.data.refundAccountType, parsed.data.refundAccountId);

    if (!refundAccount) {
      return c.json({ message: "Refund account not found" }, 404);
    }

    if (refundAccount.currencyId !== sale.currencyId) {
      return c.json({ message: "Refund account currency must match sale currency" }, 400);
    }

    if (refundAccount.balance < parsed.data.refundAmount) {
      return c.json({ message: "Not enough balance for refund" }, 400);
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const saleReturn = await tx.saleReturn.create({
      data: {
        returnNo: parsed.data.returnNo ?? `SR-${Date.now()}`,
        saleId: sale.id,
        customerId: sale.customerId,
        currencyId: sale.currencyId,
        subtotal,
        refundAmount: parsed.data.refundAmount,
        receivableAdjustment,
        ...snapshotBaseFields(saleSnapshot, {
          subtotal,
          paidAmount: parsed.data.refundAmount,
          remainingAmount: receivableAdjustment
        }),
        note: parsed.data.note ?? null,
        createdByUserId: authUser?.id || null,
        posDeviceId: posDevice?.id || null
      }
    });

    const createdItems = [];
    let baseTotalCost = 0;

    for (const item of preparedItems) {
      if (item.saleItem.lotId) {
        await tx.stockLot.update({
          where: { id: item.saleItem.lotId },
          data: {
            remainingQuantity: {
              increment: item.quantityBase
            }
          }
        });
      }

      await tx.stockMovement.create({
        data: {
          productId: item.saleItem.productId,
          warehouseId: item.saleItem.warehouseId,
          lotId: item.saleItem.lotId,
          type: StockMovementType.SALE_RETURN,
          quantity: item.quantityBase,
          unitCost: item.unitCostBase,
          currencyId: item.saleItem.lot?.currencyId || sale.currencyId,
          exchangeRate: Number(item.saleItem.lot?.exchangeRate || 1),
          baseUnitCost: Number(item.saleItem.lot?.baseUnitCost || item.unitCostBase || 0),
          referenceType: "SALE_RETURN",
          referenceId: saleReturn.id,
          note: parsed.data.note ?? null,
          createdByUserId: authUser?.id || null
        }
      });

      const returnItem = await tx.saleReturnItem.create({
        data: {
          saleReturnId: saleReturn.id,
          saleItemId: item.saleItem.id,
          productId: item.saleItem.productId,
          warehouseId: item.saleItem.warehouseId,
          lotId: item.saleItem.lotId,
          quantity: item.quantity,
          quantityBase: item.quantityBase,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
          unitCostBase: item.unitCostBase,
          totalCost: item.totalCost,
          baseTotalCost: item.baseTotalCost
        }
      });

      baseTotalCost += Number(item.baseTotalCost || 0);
      createdItems.push(returnItem);
    }

    let moneyTransaction = null;

    if (refundAccount && parsed.data.refundAmount > 0) {
      if (refundAccount.type === "CASH") {
        const updated = await tx.cashRegisterAccount.update({
          where: { id: refundAccount.id },
          data: { balance: { decrement: parsed.data.refundAmount } }
        });

        moneyTransaction = await tx.moneyTransaction.create({
          data: {
            currencyId: sale.currencyId,
            cashRegisterAccountId: refundAccount.id,
            type: MoneyTransactionType.ADJUSTMENT,
            direction: MoneyDirection.OUT,
            amount: parsed.data.refundAmount,
            balanceAfter: updated.balance,
            ...snapshotBaseFields(saleSnapshot, {
              amount: parsed.data.refundAmount,
              balanceAfter: Number(updated.balance)
            }),
            referenceType: "SALE_RETURN",
            referenceId: saleReturn.id,
            note: parsed.data.note ?? "Sale return refund",
            createdByUserId: authUser?.id || null,
            posDeviceId: posDevice?.id || null
          }
        });
      } else {
        const updated = await tx.bankAccount.update({
          where: { id: refundAccount.id },
          data: { balance: { decrement: parsed.data.refundAmount } }
        });

        moneyTransaction = await tx.moneyTransaction.create({
          data: {
            currencyId: sale.currencyId,
            bankAccountId: refundAccount.id,
            type: MoneyTransactionType.ADJUSTMENT,
            direction: MoneyDirection.OUT,
            amount: parsed.data.refundAmount,
            balanceAfter: updated.balance,
            ...snapshotBaseFields(saleSnapshot, {
              amount: parsed.data.refundAmount,
              balanceAfter: Number(updated.balance)
            }),
            referenceType: "SALE_RETURN",
            referenceId: saleReturn.id,
            note: parsed.data.note ?? "Sale return refund",
            createdByUserId: authUser?.id || null,
            posDeviceId: posDevice?.id || null
          }
        });
      }
    }

    let partyTransaction = null;

    if (sale.customerId && receivableAdjustment > 0) {
      await tx.partyAccount.upsert({
        where: {
          partyId_currencyId: {
            partyId: sale.customerId,
            currencyId: sale.currencyId
          }
        },
        create: {
          partyId: sale.customerId,
          currencyId: sale.currencyId,
          debitBalance: 0,
          creditBalance: receivableAdjustment
        },
        update: {
          creditBalance: {
            increment: receivableAdjustment
          }
        }
      });

      partyTransaction = await tx.partyTransaction.create({
        data: {
          partyId: sale.customerId,
          currencyId: sale.currencyId,
          type: PartyTransactionType.ADJUSTMENT,
          side: PartyAccountSide.CREDIT,
          amount: receivableAdjustment,
          referenceType: "SALE_RETURN",
          referenceId: saleReturn.id,
          note: parsed.data.note ?? "Sale return receivable adjustment"
        }
      });
    }

    const lines: Array<{
      accountCode: string;
      debit?: number;
      credit?: number;
      exchangeRate?: number;
      baseCurrencyId?: string | null;
      note?: string | null;
    }> = [
      {
        accountCode: "4200",
        debit: subtotal,
        exchangeRate: saleSnapshot.exchangeRate,
        baseCurrencyId: saleSnapshot.baseCurrencyId,
        note: "Sale return"
      }
    ];

    if (refundAccount && parsed.data.refundAmount > 0) {
      lines.push({
        accountCode: treasuryAccountCode(refundAccount.type),
        credit: parsed.data.refundAmount,
        exchangeRate: saleSnapshot.exchangeRate,
        baseCurrencyId: saleSnapshot.baseCurrencyId,
        note: "Sale return refund"
      });
    }

    if (receivableAdjustment > 0) {
      lines.push({
        accountCode: "1200",
        credit: receivableAdjustment,
        exchangeRate: saleSnapshot.exchangeRate,
        baseCurrencyId: saleSnapshot.baseCurrencyId,
        note: "Sale return receivable adjustment"
      });
    }

    if (baseTotalCost > 0) {
      lines.push(
        {
          accountCode: "1300",
          debit: baseTotalCost,
          exchangeRate: 1,
          baseCurrencyId: saleSnapshot.baseCurrencyId,
          note: "Returned inventory"
        },
        {
          accountCode: "5000",
          credit: baseTotalCost,
          exchangeRate: 1,
          baseCurrencyId: saleSnapshot.baseCurrencyId,
          note: "COGS reversed"
        }
      );
    }

    const journalEntry = await createPostedJournal(tx, {
      entryNoPrefix: "JE-SR",
      sourceType: "SALE_RETURN",
      sourceId: saleReturn.id,
      description: "Sale return",
      createdByUserId: authUser?.id || null,
      lines
    });

    return {
      saleReturn,
      items: createdItems,
      moneyTransaction,
      partyTransaction,
      journalEntry
    };
  });

  await writeAudit(c, {
    action: "SALE_RETURN_CREATED",
    entityType: "SaleReturn",
    entityId: result.saleReturn.id,
    metadata: {
      saleId: sale.id,
      subtotal,
      refundAmount: parsed.data.refundAmount
    }
  });

  return c.json({ data: result }, 201);
});

saleReturnsRoute.post("/:id/cancel", async (c) => {
  const authUser = getAuthUser(c);
  const id = c.req.param("id");
  const parsed = cancelSaleReturnSchema.safeParse(await c.req.json().catch(() => ({})));

  if (!parsed.success) return c.json(zodError(parsed.error), 400);

  const saleReturn = await prisma.saleReturn.findUnique({
    where: { id },
    include: { items: true }
  });

  if (!saleReturn) return c.json({ message: "Sale return not found" }, 404);
  if (saleReturn.cancelledAt) return c.json({ message: "Sale return is already cancelled" }, 400);

  const moneyTransactions = await prisma.moneyTransaction.findMany({
    where: { referenceType: "SALE_RETURN", referenceId: id }
  });
  const partyTransactions = await prisma.partyTransaction.findMany({
    where: { referenceType: "SALE_RETURN", referenceId: id }
  });

  try {
    const result = await prisma.$transaction(async (tx) => {
      for (const item of saleReturn.items) {
        if (item.lotId) {
          const updated = await tx.stockLot.updateMany({
            where: { id: item.lotId, remainingQuantity: { gte: item.quantityBase } },
            data: { remainingQuantity: { decrement: item.quantityBase } }
          });
          if (updated.count !== 1) throw new Error("Returned stock was already used and cannot be cancelled");
        }

        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            warehouseId: item.warehouseId,
            lotId: item.lotId,
            type: StockMovementType.SALE,
            quantity: item.quantityBase,
            unitCost: item.unitCostBase,
            currencyId: saleReturn.currencyId,
            exchangeRate: Number(saleReturn.exchangeRate || 1),
            baseUnitCost: Number(item.unitCostBase || 0),
            referenceType: "SALE_RETURN_CANCEL",
            referenceId: id,
            note: parsed.data.reason,
            createdByUserId: authUser?.id ?? null
          }
        });
      }

      for (const transaction of moneyTransactions) {
        const amount = Number(transaction.amount);
        const snapshot = {
          exchangeRate: Number(transaction.exchangeRate || 1),
          baseCurrencyId: transaction.baseCurrencyId
        };
        let balanceAfter = 0;

        if (transaction.cashRegisterAccountId) {
          const updated = await tx.cashRegisterAccount.update({
            where: { id: transaction.cashRegisterAccountId },
            data: { balance: { increment: amount } }
          });
          balanceAfter = Number(updated.balance);
        } else if (transaction.bankAccountId) {
          const updated = await tx.bankAccount.update({
            where: { id: transaction.bankAccountId },
            data: { balance: { increment: amount } }
          });
          balanceAfter = Number(updated.balance);
        }

        await tx.moneyTransaction.create({
          data: {
            currencyId: transaction.currencyId,
            cashRegisterAccountId: transaction.cashRegisterAccountId,
            bankAccountId: transaction.bankAccountId,
            type: MoneyTransactionType.ADJUSTMENT,
            direction: MoneyDirection.IN,
            amount,
            balanceAfter,
            baseAmount: toBaseAmount(amount, snapshot),
            baseBalanceAfter: toBaseAmount(balanceAfter, snapshot),
            ...snapshot,
            referenceType: "SALE_RETURN_CANCEL",
            referenceId: id,
            note: parsed.data.reason,
            createdByUserId: authUser?.id ?? null
          }
        });
      }

      for (const transaction of partyTransactions) {
        await tx.partyAccount.update({
          where: { partyId_currencyId: { partyId: transaction.partyId, currencyId: transaction.currencyId } },
          data: transaction.side === PartyAccountSide.DEBIT
            ? { debitBalance: { decrement: transaction.amount } }
            : { creditBalance: { decrement: transaction.amount } }
        });
        await tx.partyTransaction.create({
          data: {
            partyId: transaction.partyId,
            currencyId: transaction.currencyId,
            type: PartyTransactionType.ADJUSTMENT,
            side: transaction.side === PartyAccountSide.DEBIT ? PartyAccountSide.CREDIT : PartyAccountSide.DEBIT,
            amount: transaction.amount,
            referenceType: "SALE_RETURN_CANCEL",
            referenceId: id,
            note: parsed.data.reason
          }
        });
      }

      const journalEntry = await createReversalJournal(tx, {
        sourceType: "SALE_RETURN",
        sourceId: id,
        reversalSourceType: "SALE_RETURN_CANCEL",
        reversalSourceId: id,
        entryNoPrefix: "JE-SRC",
        description: "Sale return cancellation",
        createdByUserId: authUser?.id ?? null
      });
      const updated = await tx.saleReturn.update({
        where: { id },
        data: {
          cancelledAt: new Date(),
          cancelledByUserId: authUser?.id ?? null,
          cancellationReason: parsed.data.reason
        }
      });

      return { saleReturn: updated, journalEntry };
    });

    await writeAudit(c, {
      action: "SALE_RETURN_CANCELLED",
      entityType: "SaleReturn",
      entityId: id,
      metadata: { reason: parsed.data.reason }
    });
    return c.json({ data: result });
  } catch (error) {
    return c.json({ message: error instanceof Error ? error.message : "Sale return cancellation failed" }, 400);
  }
});
