import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { zodError } from "../../lib/api";
import { getAuthUser, writeAudit } from "../../lib/auth";
import { normalizeBarcodeText } from "../../lib/barcode";
import { resolveCurrencySnapshot, snapshotBaseFields, toBaseAmount } from "../../lib/currency-rates";
import { createPostedJournal, createReversalJournal, treasuryAccountCode } from "../../lib/journal";
import { getRequestPosDevice } from "../../lib/pos-device";
import { createPaginationMeta, getPagePagination } from "../../lib/pagination";
import { getRecentDateRange } from "../../lib/recent-date-range";
import { parseKabulDateInput } from "../../lib/kabul-date";
import {
  MoneyDirection,
  MoneyTransactionType,
  PartyAccountSide,
  PartyTransactionType,
  PartyType,
  SalePaymentStatus,
  SaleStatus,
  StockMovementType
} from "../../generated/prisma/enums";

export const salesRoute = new Hono();

const paymentAccountTypeSchema = z.enum(["CASH", "BANK"]);

const paymentLineSchema = z.object({
  paymentAccountType: paymentAccountTypeSchema,
  paymentAccountId: z.string().trim().min(1),
  amount: z.coerce.number().positive()
});

const saleItemSchema = z.object({
  productId: z.string().min(1),
  warehouseId: z.string().min(1),
  unitId: z.string().min(1),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().nonnegative(),
  discount: z.coerce.number().nonnegative().default(0),
  lotId: z.string().trim().optional().nullable()
});

const createSaleSchema = z.object({
  invoiceNo: z.string().trim().max(120).optional().nullable(),
  customerId: z.string().trim().optional().nullable(),
  currencyId: z.string().min(1),
  saleDate: z.string().trim().optional().nullable(),
  discount: z.coerce.number().nonnegative().default(0),
  paidAmount: z.coerce.number().nonnegative().default(0),
  paymentAccountType: paymentAccountTypeSchema.optional().nullable(),
  paymentAccountId: z.string().trim().optional().nullable(),
  paymentLines: z.array(paymentLineSchema).optional().default([]),
  note: z.string().trim().max(500).optional().nullable(),
  items: z.array(saleItemSchema).min(1)
});

const salePaymentSchema = z.object({
  amount: z.coerce.number().positive(),
  paymentAccountType: paymentAccountTypeSchema,
  paymentAccountId: z.string().trim().min(1),
  note: z.string().trim().max(500).optional().nullable()
});

const cancelSaleSchema = z.object({
  reason: z.string().trim().max(500).optional().nullable()
});

function parseDate(value: string | null | undefined) {
  if (!value) return null;

  const date = parseKabulDateInput(value);

  if (!date || date === "INVALID_DATE" || Number.isNaN(date.getTime())) {
    return "INVALID_DATE";
  }

  return date;
}

salesRoute.get("/", async (c) => {
  const customerId = c.req.query("customerId");
  const pagination = getPagePagination(c);
  const saleDate = getRecentDateRange(c);
  const where = {
    ...(customerId ? { customerId } : {}),
    saleDate
  };

  const [items, total, summary] = await Promise.all([
    prisma.sale.findMany({
    where,
    include: {
      customer: true,
      currency: true,
      items: {
        include: {
          product: true,
          warehouse: true,
          unit: true,
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
    prisma.sale.count({ where }),
    prisma.sale.aggregate({
      where: { ...where, status: { not: SaleStatus.CANCELLED } },
      _count: true,
      _sum: { baseTotal: true, basePaidAmount: true, baseRemainingAmount: true }
    })
  ]);

  return c.json({
    data: items,
    pagination: createPaginationMeta({ ...pagination, total }),
    summary: {
      count: summary._count,
      total: Number(summary._sum.baseTotal || 0),
      paid: Number(summary._sum.basePaidAmount || 0),
      remaining: Number(summary._sum.baseRemainingAmount || 0)
    }
  });
});

salesRoute.get("/scan/:barcode", async (c) => {
  const barcode = normalizeBarcodeText(c.req.param("barcode"));
  const warehouseId = c.req.query("warehouseId");

  const product = await prisma.product.findUnique({
    where: { barcode },
    include: {
      baseUnit: true,
      units: {
        include: {
          unit: true
        }
      }
    }
  });

  if (!product) {
    return c.json({ message: "Product not found" }, 404);
  }

  const lots = await prisma.stockLot.findMany({
    where: {
      productId: product.id,
      remainingQuantity: {
        gt: 0
      },
      ...(warehouseId ? { warehouseId } : {})
    },
    include: {
      warehouse: true
    },
    orderBy: [
      { expiryDate: "asc" },
      { createdAt: "asc" }
    ]
  });

  const totalStock = lots.reduce((sum, lot) => sum + Number(lot.remainingQuantity), 0);

  return c.json({
    data: {
      product,
      totalStock,
      lots
    }
  });
});

salesRoute.get("/:id", async (c) => {
  const id = c.req.param("id");

  const item = await prisma.sale.findUnique({
    where: { id },
    include: {
      customer: true,
      currency: true,
      items: {
        include: {
          product: true,
          warehouse: true,
          unit: true,
          lot: true
        }
      }
    }
  });

  if (!item) {
    return c.json({ message: "Sale not found" }, 404);
  }

  return c.json({ data: item });
});

salesRoute.post("/:id/cancel", async (c) => {
  const authUser = getAuthUser(c);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const parsed = cancelSaleSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const sale = await prisma.sale.findUnique({
    where: { id },
    include: {
      items: true,
      returns: true
    }
  });

  if (!sale) {
    return c.json({ message: "Sale not found" }, 404);
  }

  if (sale.status === SaleStatus.CANCELLED) {
    return c.json({ message: "Sale is already cancelled" }, 400);
  }

  if (sale.returns.some((item) => !item.cancelledAt)) {
    return c.json({ message: "Sale has returns. Cancel the return workflow manually instead." }, 400);
  }

  const moneyTransactions = await prisma.moneyTransaction.findMany({
    where: {
      referenceId: sale.id,
      direction: MoneyDirection.IN
    }
  });

  const result = await prisma.$transaction(async (tx) => {
    for (const item of sale.items) {
      if (item.lotId) {
        await tx.stockLot.update({
          where: { id: item.lotId },
          data: {
            remainingQuantity: {
              increment: item.quantityBase
            }
          }
        });
      }

      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          warehouseId: item.warehouseId,
          lotId: item.lotId,
          type: StockMovementType.SALE_RETURN,
          quantity: item.quantityBase,
          unitCost: item.unitCostBase,
          currencyId: sale.currencyId,
          referenceType: "SALE_CANCEL",
          referenceId: sale.id,
          note: parsed.data.reason ?? "Sale cancelled",
          createdByUserId: authUser?.id ?? null
        }
      });
    }

    for (const transaction of moneyTransactions) {
      const amount = Number(transaction.amount);

      if (transaction.cashRegisterAccountId) {
        const account = await tx.cashRegisterAccount.findUnique({
          where: { id: transaction.cashRegisterAccountId }
        });

        if (!account || Number(account.balance) < amount) {
          throw new Error("Not enough cash balance to cancel this sale");
        }

        const updated = await tx.cashRegisterAccount.update({
          where: { id: transaction.cashRegisterAccountId },
          data: { balance: { decrement: amount } }
        });

        await tx.moneyTransaction.create({
          data: {
            currencyId: transaction.currencyId,
            cashRegisterAccountId: transaction.cashRegisterAccountId,
            type: MoneyTransactionType.ADJUSTMENT,
            direction: MoneyDirection.OUT,
            amount,
            balanceAfter: updated.balance,
            exchangeRate: Number(transaction.exchangeRate || 1),
            baseCurrencyId: transaction.baseCurrencyId,
            baseAmount: toBaseAmount(amount, {
              exchangeRate: Number(transaction.exchangeRate || 1),
              baseCurrencyId: transaction.baseCurrencyId
            }),
            baseBalanceAfter: toBaseAmount(Number(updated.balance), {
              exchangeRate: Number(transaction.exchangeRate || 1),
              baseCurrencyId: transaction.baseCurrencyId
            }),
            referenceType: "SALE_CANCEL",
            referenceId: sale.id,
            note: parsed.data.reason ?? "Sale cancellation",
            createdByUserId: authUser?.id ?? null
          }
        });
      }

      if (transaction.bankAccountId) {
        const account = await tx.bankAccount.findUnique({
          where: { id: transaction.bankAccountId }
        });

        if (!account || Number(account.balance) < amount) {
          throw new Error("Not enough bank balance to cancel this sale");
        }

        const updated = await tx.bankAccount.update({
          where: { id: transaction.bankAccountId },
          data: { balance: { decrement: amount } }
        });

        await tx.moneyTransaction.create({
          data: {
            currencyId: transaction.currencyId,
            bankAccountId: transaction.bankAccountId,
            type: MoneyTransactionType.ADJUSTMENT,
            direction: MoneyDirection.OUT,
            amount,
            balanceAfter: updated.balance,
            exchangeRate: Number(transaction.exchangeRate || 1),
            baseCurrencyId: transaction.baseCurrencyId,
            baseAmount: toBaseAmount(amount, {
              exchangeRate: Number(transaction.exchangeRate || 1),
              baseCurrencyId: transaction.baseCurrencyId
            }),
            baseBalanceAfter: toBaseAmount(Number(updated.balance), {
              exchangeRate: Number(transaction.exchangeRate || 1),
              baseCurrencyId: transaction.baseCurrencyId
            }),
            referenceType: "SALE_CANCEL",
            referenceId: sale.id,
            note: parsed.data.reason ?? "Sale cancellation",
            createdByUserId: authUser?.id ?? null
          }
        });
      }
    }

    const partyTransactions = await tx.partyTransaction.findMany({
      where: {
        referenceId: sale.id
      }
    });

    for (const transaction of partyTransactions) {
      const account = await tx.partyAccount.findUnique({
        where: {
          partyId_currencyId: {
            partyId: transaction.partyId,
            currencyId: transaction.currencyId
          }
        }
      });

      if (!account) continue;

      if (transaction.side === PartyAccountSide.DEBIT) {
        await tx.partyAccount.update({
          where: { id: account.id },
          data: { debitBalance: { decrement: transaction.amount } }
        });
      } else {
        await tx.partyAccount.update({
          where: { id: account.id },
          data: { creditBalance: { decrement: transaction.amount } }
        });
      }

      await tx.partyTransaction.create({
        data: {
          partyId: transaction.partyId,
          currencyId: transaction.currencyId,
          type: PartyTransactionType.ADJUSTMENT,
          side: transaction.side === PartyAccountSide.DEBIT ? PartyAccountSide.CREDIT : PartyAccountSide.DEBIT,
          amount: transaction.amount,
          referenceType: "SALE_CANCEL",
          referenceId: sale.id,
          note: parsed.data.reason ?? "Sale cancellation"
        }
      });
    }

    const journalEntry = await createReversalJournal(tx, {
      sourceType: "SALE",
      sourceId: sale.id,
      reversalSourceType: "SALE_CANCEL",
      reversalSourceId: sale.id,
      entryNoPrefix: "JE-SC",
      description: "Sale cancellation",
      createdByUserId: authUser?.id ?? null
    });

    const updatedSale = await tx.sale.update({
      where: { id: sale.id },
      data: {
        status: SaleStatus.CANCELLED,
        paymentStatus: SalePaymentStatus.UNPAID,
        paidAmount: 0,
        remainingAmount: 0,
        basePaidAmount: 0,
        baseRemainingAmount: 0,
        note: [sale.note, parsed.data.reason ? `Cancelled: ${parsed.data.reason}` : "Cancelled"]
          .filter(Boolean)
          .join("\n")
      },
      include: {
        customer: true,
        currency: true,
        cashier: true,
        posDevice: true,
        items: {
          include: {
            product: true,
            warehouse: true,
            unit: true,
            lot: true
          }
        }
      }
    });

    return { sale: updatedSale, journalEntry };
  });

  await writeAudit(c, {
    action: "SALE_CANCELLED",
    entityType: "Sale",
    entityId: sale.id,
    metadata: {
      reason: parsed.data.reason ?? null
    }
  });

  return c.json({ data: result });
});

salesRoute.post("/:id/payments", async (c) => {
  const id = c.req.param("id");
  const authUser = getAuthUser(c);
  const posDevice = await getRequestPosDevice(c, authUser?.id || null);
  const body = await c.req.json().catch(() => null);
  const parsed = salePaymentSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const sale = await prisma.sale.findUnique({
    where: { id },
    include: {
      customer: true,
      currency: true
    }
  });

  if (!sale) {
    return c.json({ message: "Sale not found" }, 404);
  }

  const remainingAmount = Number(sale.remainingAmount);

  if (remainingAmount <= 0) {
    return c.json({ message: "Sale is already fully paid" }, 400);
  }

  if (parsed.data.amount > remainingAmount) {
    return c.json({ message: "Payment amount cannot be greater than remaining sale amount" }, 400);
  }

  if (!sale.customerId) {
    return c.json({ message: "Customer is required for invoice payment" }, 400);
  }

  let paymentAccount:
    | {
        kind: "CASH" | "BANK";
        id: string;
        currencyId: string;
      }
    | null = null;

  if (parsed.data.paymentAccountType === "CASH") {
    const account = await prisma.cashRegisterAccount.findUnique({
      where: { id: parsed.data.paymentAccountId }
    });

    if (!account) {
      return c.json({ message: "Cash account not found" }, 404);
    }

    paymentAccount = {
      kind: "CASH",
      id: account.id,
      currencyId: account.currencyId
    };
  } else {
    const account = await prisma.bankAccount.findUnique({
      where: { id: parsed.data.paymentAccountId }
    });

    if (!account) {
      return c.json({ message: "Bank account not found" }, 404);
    }

    paymentAccount = {
      kind: "BANK",
      id: account.id,
      currencyId: account.currencyId
    };
  }

  if (paymentAccount.currencyId !== sale.currencyId) {
    return c.json({ message: "Payment account currency must match sale currency" }, 400);
  }

  const nextPaid = Number(sale.paidAmount) + parsed.data.amount;
  const nextRemaining = remainingAmount - parsed.data.amount;
  const saleSnapshot = {
    exchangeRate: Number(sale.exchangeRate || 1),
    baseCurrencyId: sale.baseCurrencyId ?? null
  };
  const nextStatus =
    nextRemaining <= 0
      ? SalePaymentStatus.PAID
      : nextPaid > 0
        ? SalePaymentStatus.PARTIAL
        : SalePaymentStatus.UNPAID;

  const result = await prisma.$transaction(async (tx) => {
    const updatedSale = await tx.sale.update({
      where: { id: sale.id },
      data: {
        paidAmount: nextPaid,
        remainingAmount: nextRemaining,
        basePaidAmount: toBaseAmount(nextPaid, saleSnapshot),
        baseRemainingAmount: toBaseAmount(nextRemaining, saleSnapshot),
        paymentStatus: nextStatus
      },
      include: {
        customer: true,
        currency: true,
        cashier: true,
        posDevice: true,
        items: {
          include: {
            product: true,
            warehouse: true,
            unit: true,
            lot: true
          }
        }
      }
    });

    await tx.partyAccount.upsert({
      where: {
        partyId_currencyId: {
          partyId: sale.customerId!,
          currencyId: sale.currencyId
        }
      },
      create: {
        partyId: sale.customerId!,
        currencyId: sale.currencyId,
        debitBalance: 0,
        creditBalance: parsed.data.amount
      },
      update: {
        creditBalance: {
          increment: parsed.data.amount
        }
      }
    });

    const partyTransaction = await tx.partyTransaction.create({
      data: {
        partyId: sale.customerId!,
        currencyId: sale.currencyId,
        type: PartyTransactionType.PAYMENT_RECEIVED,
        side: PartyAccountSide.CREDIT,
        amount: parsed.data.amount,
        referenceType: "SALE_PAYMENT",
        referenceId: sale.id,
        note: parsed.data.note ?? "Sale invoice payment"
      }
    });

    let moneyTransaction = null;

    if (paymentAccount.kind === "CASH") {
      const updatedAccount = await tx.cashRegisterAccount.update({
        where: { id: paymentAccount.id },
        data: { balance: { increment: parsed.data.amount } }
      });

      moneyTransaction = await tx.moneyTransaction.create({
        data: {
          currencyId: sale.currencyId,
          cashRegisterAccountId: paymentAccount.id,
          type: MoneyTransactionType.CUSTOMER_PAYMENT,
          direction: MoneyDirection.IN,
          amount: parsed.data.amount,
          balanceAfter: updatedAccount.balance,
          ...snapshotBaseFields(saleSnapshot, {
            amount: parsed.data.amount,
            balanceAfter: Number(updatedAccount.balance)
          }),
          referenceType: "SALE_PAYMENT",
          referenceId: partyTransaction.id,
          note: parsed.data.note ?? "Sale invoice payment",
          createdByUserId: authUser?.id || null,
          posDeviceId: posDevice?.id || null
        }
      });
    } else {
      const updatedAccount = await tx.bankAccount.update({
        where: { id: paymentAccount.id },
        data: { balance: { increment: parsed.data.amount } }
      });

      moneyTransaction = await tx.moneyTransaction.create({
        data: {
          currencyId: sale.currencyId,
          bankAccountId: paymentAccount.id,
          type: MoneyTransactionType.CUSTOMER_PAYMENT,
          direction: MoneyDirection.IN,
          amount: parsed.data.amount,
          balanceAfter: updatedAccount.balance,
          ...snapshotBaseFields(saleSnapshot, {
            amount: parsed.data.amount,
            balanceAfter: Number(updatedAccount.balance)
          }),
          referenceType: "SALE_PAYMENT",
          referenceId: partyTransaction.id,
          note: parsed.data.note ?? "Sale invoice payment",
          createdByUserId: authUser?.id || null,
          posDeviceId: posDevice?.id || null
        }
      });
    }

    const journalEntry = await createPostedJournal(tx, {
      entryNoPrefix: "JE-SREC",
      sourceType: "SALE_PAYMENT",
      sourceId: partyTransaction.id,
      description: "Sale invoice payment",
      createdByUserId: authUser?.id || null,
      lines: [
        {
          accountCode: treasuryAccountCode(paymentAccount.kind),
          partyId: sale.customerId,
          debit: parsed.data.amount,
          exchangeRate: saleSnapshot.exchangeRate,
          baseCurrencyId: saleSnapshot.baseCurrencyId,
          note: parsed.data.note ?? "Sale payment received"
        },
        {
          accountCode: "1200",
          partyId: sale.customerId,
          credit: parsed.data.amount,
          exchangeRate: saleSnapshot.exchangeRate,
          baseCurrencyId: saleSnapshot.baseCurrencyId,
          note: "Customer receivable reduced"
        }
      ]
    });

    return { sale: updatedSale, partyTransaction, moneyTransaction, journalEntry };
  });

  await writeAudit(c, {
    action: "SALE_PAYMENT_RECEIVED",
    entityType: "Sale",
    entityId: sale.id,
    metadata: {
      amount: parsed.data.amount,
      remainingAmount: nextRemaining
    }
  });

  return c.json({ data: result }, 201);
});

salesRoute.post("/", async (c) => {
  const authUser = getAuthUser(c);
  const posDevice = await getRequestPosDevice(c, authUser?.id || null);
  const body = await c.req.json().catch(() => null);
  const parsed = createSaleSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const currency = await prisma.currency.findUnique({
    where: { id: parsed.data.currencyId }
  });

  if (!currency) {
    return c.json({ message: "Currency not found" }, 404);
  }

  if (parsed.data.customerId) {
    const customer = await prisma.party.findUnique({
      where: { id: parsed.data.customerId }
    });

    if (!customer) {
      return c.json({ message: "Customer not found" }, 404);
    }

    if (customer.type !== PartyType.CUSTOMER && customer.type !== PartyType.BOTH) {
      return c.json({ message: "Selected party is not a customer" }, 400);
    }
  }

  const saleDate = parseDate(parsed.data.saleDate);

  if (saleDate === "INVALID_DATE") {
    return c.json({ message: "Invalid saleDate" }, 400);
  }

  const preparedItems: Array<{
    productId: string;
    warehouseId: string;
    unitId: string;
    quantity: number;
    conversionRate: number;
    quantityBase: number;
    unitPrice: number;
    discount: number;
    totalPrice: number;
    allocations: Array<{
      lotId: string;
      quantityBase: number;
      quantity: number;
      unitCostBase: number;
      totalCost: number;
      baseUnitCost: number;
      baseTotalCost: number;
      costExchangeRate: number;
      currencyId: string | null;
      expiryDate: Date | null;
    }>;
  }> = [];

  for (const rawItem of parsed.data.items) {
    const product = await prisma.product.findUnique({
      where: { id: rawItem.productId },
      include: {
        units: true
      }
    });

    if (!product) {
      return c.json({ message: `Product not found: ${rawItem.productId}` }, 404);
    }

    const warehouse = await prisma.warehouse.findUnique({
      where: { id: rawItem.warehouseId }
    });

    if (!warehouse) {
      return c.json({ message: `Warehouse not found: ${rawItem.warehouseId}` }, 404);
    }

    let conversionRate = 1;

    const productUnit = product.units.find((unit) => unit.unitId === rawItem.unitId);

    if (productUnit) {
      conversionRate = Number(productUnit.conversionRate);
    } else if (product.baseUnitId === rawItem.unitId) {
      conversionRate = 1;
    } else {
      return c.json(
        {
          message: `Unit is not configured for product: ${product.name}`
        },
        400
      );
    }

    const quantityBase = rawItem.quantity * conversionRate;

    const lots = await prisma.stockLot.findMany({
      where: {
        productId: rawItem.productId,
        warehouseId: rawItem.warehouseId,
        remainingQuantity: {
          gt: 0
        },
        ...(rawItem.lotId ? { id: rawItem.lotId } : {})
      },
      orderBy: [
        { expiryDate: "asc" },
        { createdAt: "asc" }
      ]
    });

    let remainingToAllocate = quantityBase;

    const allocations: Array<{
      lotId: string;
      quantityBase: number;
      quantity: number;
      unitCostBase: number;
      totalCost: number;
      baseUnitCost: number;
      baseTotalCost: number;
      costExchangeRate: number;
      currencyId: string | null;
      expiryDate: Date | null;
    }> = [];

    for (const lot of lots) {
      if (remainingToAllocate <= 0) break;

      const available = Number(lot.remainingQuantity);
      const allocatedBase = Math.min(available, remainingToAllocate);
      const allocatedQuantity = allocatedBase / conversionRate;
      const unitCostBase = Number(lot.unitCost);
      const costExchangeRate = Number(lot.exchangeRate || 1);
      const baseUnitCost = Number(lot.baseUnitCost || unitCostBase * costExchangeRate);

      allocations.push({
        lotId: lot.id,
        quantityBase: allocatedBase,
        quantity: allocatedQuantity,
        unitCostBase,
        totalCost: allocatedBase * unitCostBase,
        baseUnitCost,
        baseTotalCost: allocatedBase * baseUnitCost,
        costExchangeRate,
        currencyId: lot.currencyId,
        expiryDate: lot.expiryDate
      });

      remainingToAllocate -= allocatedBase;
    }

    if (remainingToAllocate > 0) {
      return c.json(
        {
          message: `Not enough stock for product: ${product.name}`,
          required: quantityBase,
          missing: remainingToAllocate
        },
        400
      );
    }

    const grossTotal = rawItem.quantity * rawItem.unitPrice;

    if (rawItem.discount > grossTotal) {
      return c.json(
        {
          message: `Discount cannot be greater than item total for product: ${product.name}`
        },
        400
      );
    }

    preparedItems.push({
      productId: rawItem.productId,
      warehouseId: rawItem.warehouseId,
      unitId: rawItem.unitId,
      quantity: rawItem.quantity,
      conversionRate,
      quantityBase,
      unitPrice: rawItem.unitPrice,
      discount: rawItem.discount,
      totalPrice: grossTotal - rawItem.discount,
      allocations
    });
  }

  const subtotal = preparedItems.reduce((sum, item) => sum + item.totalPrice, 0);
  const total = subtotal - parsed.data.discount;

  if (total < 0) {
    return c.json({ message: "Discount cannot be greater than subtotal" }, 400);
  }

  if (parsed.data.paidAmount > total) {
    return c.json({ message: "Paid amount cannot be greater than total" }, 400);
  }

  const requestedPaymentLines =
    parsed.data.paymentLines.length > 0
      ? parsed.data.paymentLines
      : parsed.data.paidAmount > 0 && parsed.data.paymentAccountType && parsed.data.paymentAccountId
        ? [
            {
              paymentAccountType: parsed.data.paymentAccountType,
              paymentAccountId: parsed.data.paymentAccountId,
              amount: parsed.data.paidAmount
            }
          ]
        : [];

  const paymentLinesTotal = requestedPaymentLines.reduce((sum, line) => sum + line.amount, 0);

  if (Math.abs(paymentLinesTotal - parsed.data.paidAmount) > 0.0001) {
    return c.json({ message: "Payment lines total must equal paidAmount" }, 400);
  }

  const remainingAmount = total - parsed.data.paidAmount;

  if (remainingAmount > 0 && !parsed.data.customerId) {
    return c.json({ message: "Customer is required for credit sale" }, 400);
  }

  if (parsed.data.paidAmount > 0 && requestedPaymentLines.length === 0) {
    return c.json({ message: "Payment account is required when paidAmount is greater than zero" }, 400);
  }

  const paymentLines: Array<{
    kind: "CASH" | "BANK";
    id: string;
    currencyId: string;
    amount: number;
  }> = [];

  for (const line of requestedPaymentLines) {
    let paymentAccount:
      | {
          kind: "CASH" | "BANK";
          id: string;
          currencyId: string;
        }
      | null = null;

    if (line.paymentAccountType === "CASH") {
      const account = await prisma.cashRegisterAccount.findUnique({
        where: { id: line.paymentAccountId }
      });

      if (!account) {
        return c.json({ message: "Cash account not found" }, 404);
      }

      paymentAccount = {
        kind: "CASH",
        id: account.id,
        currencyId: account.currencyId
      };
    } else {
      const account = await prisma.bankAccount.findUnique({
        where: { id: line.paymentAccountId }
      });

      if (!account) {
        return c.json({ message: "Bank account not found" }, 404);
      }

      paymentAccount = {
        kind: "BANK",
        id: account.id,
        currencyId: account.currencyId
      };
    }

    if (paymentAccount.currencyId !== parsed.data.currencyId) {
      return c.json({ message: "Payment account currency must match sale currency" }, 400);
    }

    paymentLines.push({
      ...paymentAccount,
      amount: line.amount
    });
  }

  const paymentStatus =
    remainingAmount === 0
      ? SalePaymentStatus.PAID
      : parsed.data.paidAmount > 0
        ? SalePaymentStatus.PARTIAL
      : SalePaymentStatus.UNPAID;

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
    const sale = await tx.sale.create({
      data: {
        invoiceNo: parsed.data.invoiceNo ?? null,
        customerId: parsed.data.customerId ?? null,
        currencyId: parsed.data.currencyId,
        status: SaleStatus.COMPLETED,
        paymentStatus,
        subtotal,
        discount: parsed.data.discount,
        total,
        paidAmount: parsed.data.paidAmount,
        remainingAmount,
        ...snapshotBaseFields(currencySnapshot, {
          subtotal,
          total,
          paidAmount: parsed.data.paidAmount,
          remainingAmount
        }),
        saleDate: saleDate || new Date(),
        note: parsed.data.note ?? null,
        cashierId: authUser?.id || null,
        posDeviceId: posDevice?.id || null
      }
    });

    const createdItems = [];

    for (const preparedItem of preparedItems) {
      for (const allocation of preparedItem.allocations) {
        const stockUpdate = await tx.stockLot.updateMany({
          where: {
            id: allocation.lotId,
            remainingQuantity: {
              gte: allocation.quantityBase
            }
          },
          data: {
            remainingQuantity: {
              decrement: allocation.quantityBase
            }
          }
        });

        if (stockUpdate.count !== 1) {
          throw new Error("Not enough stock for concurrent sale");
        }

        await tx.stockMovement.create({
          data: {
            productId: preparedItem.productId,
            warehouseId: preparedItem.warehouseId,
            lotId: allocation.lotId,
            type: StockMovementType.SALE,
            quantity: allocation.quantityBase,
            unitCost: allocation.unitCostBase,
            currencyId: allocation.currencyId,
            exchangeRate: allocation.costExchangeRate,
            baseUnitCost: allocation.baseUnitCost,
            referenceType: "SALE",
            referenceId: sale.id,
            note: parsed.data.note ?? null,
            createdByUserId: authUser?.id || null
          }
        });

        const allocationRatio = allocation.quantity / preparedItem.quantity;
        const lineDiscount = preparedItem.discount * allocationRatio;
        const lineGrossTotal = allocation.quantity * preparedItem.unitPrice;
        const lineTotal = lineGrossTotal - lineDiscount;

        const saleItem = await tx.saleItem.create({
          data: {
            saleId: sale.id,
            productId: preparedItem.productId,
            warehouseId: preparedItem.warehouseId,
            unitId: preparedItem.unitId,
            lotId: allocation.lotId,
            quantity: allocation.quantity,
            conversionRate: preparedItem.conversionRate,
            quantityBase: allocation.quantityBase,
            unitPrice: preparedItem.unitPrice,
            discount: lineDiscount,
            totalPrice: lineTotal,
            unitCostBase: allocation.unitCostBase,
            totalCost: allocation.totalCost,
            baseTotalCost: allocation.baseTotalCost,
            expiryDate: allocation.expiryDate
          },
          include: {
            product: true,
            warehouse: true,
            unit: true,
            lot: true
          }
        });

        createdItems.push(saleItem);
      }
    }

    const moneyTransactions = [];

    for (const paymentLine of paymentLines) {
      if (paymentLine.kind === "CASH") {
        const updatedAccount = await tx.cashRegisterAccount.update({
          where: { id: paymentLine.id },
          data: {
            balance: {
              increment: paymentLine.amount
            }
          }
        });

        const moneyTransaction = await tx.moneyTransaction.create({
          data: {
            currencyId: parsed.data.currencyId,
            cashRegisterAccountId: paymentLine.id,
            type: MoneyTransactionType.SALE_PAYMENT,
            direction: MoneyDirection.IN,
            amount: paymentLine.amount,
            balanceAfter: updatedAccount.balance,
            ...snapshotBaseFields(currencySnapshot, {
              amount: paymentLine.amount,
              balanceAfter: Number(updatedAccount.balance)
            }),
            referenceType: "SALE",
            referenceId: sale.id,
            note: "Sale payment",
            createdByUserId: authUser?.id || null,
            posDeviceId: posDevice?.id || null
          }
        });

        moneyTransactions.push(moneyTransaction);
      } else {
        const updatedAccount = await tx.bankAccount.update({
          where: { id: paymentLine.id },
          data: {
            balance: {
              increment: paymentLine.amount
            }
          }
        });

        const moneyTransaction = await tx.moneyTransaction.create({
          data: {
            currencyId: parsed.data.currencyId,
            bankAccountId: paymentLine.id,
            type: MoneyTransactionType.SALE_PAYMENT,
            direction: MoneyDirection.IN,
            amount: paymentLine.amount,
            balanceAfter: updatedAccount.balance,
            ...snapshotBaseFields(currencySnapshot, {
              amount: paymentLine.amount,
              balanceAfter: Number(updatedAccount.balance)
            }),
            referenceType: "SALE",
            referenceId: sale.id,
            note: "Sale payment",
            createdByUserId: authUser?.id || null,
            posDeviceId: posDevice?.id || null
          }
        });

        moneyTransactions.push(moneyTransaction);
      }
    }

    let customerTransaction = null;

    if (parsed.data.customerId && remainingAmount > 0) {
      await tx.partyAccount.upsert({
        where: {
          partyId_currencyId: {
            partyId: parsed.data.customerId,
            currencyId: parsed.data.currencyId
          }
        },
        create: {
          partyId: parsed.data.customerId,
          currencyId: parsed.data.currencyId,
          debitBalance: remainingAmount,
          creditBalance: 0
        },
        update: {
          debitBalance: {
            increment: remainingAmount
          }
        }
      });

      customerTransaction = await tx.partyTransaction.create({
        data: {
          partyId: parsed.data.customerId,
          currencyId: parsed.data.currencyId,
          type: PartyTransactionType.SALE_CREDIT,
          side: PartyAccountSide.DEBIT,
          amount: remainingAmount,
          referenceType: "SALE",
          referenceId: sale.id,
          note: "Credit sale"
        }
      });
    }

    const journalEntry = await createPostedJournal(tx, {
      entryNoPrefix: "JE-POS",
      sourceType: "POS_SALE",
      sourceId: sale.id,
      description: `POS Sale ${sale.invoiceNo || sale.id}`,
      createdByUserId: authUser?.id || null,
      lines: [
        ...paymentLines.map((line) => ({
          accountCode: treasuryAccountCode(line.kind),
          partyId: parsed.data.customerId || null,
          debit: line.amount,
          exchangeRate: currencySnapshot.exchangeRate,
          baseCurrencyId: currencySnapshot.baseCurrencyId,
          note: "Sale payment received"
        })),
        ...(remainingAmount > 0
          ? [{
              accountCode: "1200",
              partyId: parsed.data.customerId || null,
              debit: remainingAmount,
              exchangeRate: currencySnapshot.exchangeRate,
              baseCurrencyId: currencySnapshot.baseCurrencyId,
              note: "Customer receivable"
            }]
          : []),
        {
          accountCode: "4000",
          partyId: parsed.data.customerId || null,
          credit: subtotal,
          exchangeRate: currencySnapshot.exchangeRate,
          baseCurrencyId: currencySnapshot.baseCurrencyId,
          note: "Sales revenue"
        },
        ...(parsed.data.discount > 0
          ? [{
              accountCode: "4100",
              partyId: parsed.data.customerId || null,
              debit: parsed.data.discount,
              exchangeRate: currencySnapshot.exchangeRate,
              baseCurrencyId: currencySnapshot.baseCurrencyId,
              note: "Sales discount"
            }]
          : [])
      ]
    });

    const fullSale = await tx.sale.findUnique({
      where: { id: sale.id },
      include: {
        customer: true,
        currency: true,
        cashier: true,
        posDevice: true,
        items: {
          include: {
            product: true,
            warehouse: true,
            unit: true,
            lot: true
          }
        }
      }
    });

    return {
      sale: fullSale,
      items: createdItems,
      moneyTransactions,
      customerTransaction,
      journalEntry
    };
  });

  await writeAudit(c, {
    action: "SALE_CREATED",
    entityType: "Sale",
    entityId: result.sale?.id || null,
    metadata: {
      total,
      paidAmount: parsed.data.paidAmount,
      invoiceNo: parsed.data.invoiceNo || null
    }
  });

  return c.json({ data: result }, 201);
});
