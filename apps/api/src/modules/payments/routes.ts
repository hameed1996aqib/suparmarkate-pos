import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { zodError } from "../../lib/api";
import { getAuthUser, writeAudit } from "../../lib/auth";
import { resolveCurrencySnapshot, snapshotBaseFields, toBaseAmount } from "../../lib/currency-rates";
import { createPostedJournal, createReversalJournal, treasuryAccountCode } from "../../lib/journal";
import { getRequestPosDevice } from "../../lib/pos-device";
import {
  MoneyDirection,
  MoneyTransactionType,
  PartyAccountSide,
  PartyTransactionType,
  PartyType
} from "../../generated/prisma/enums";

export const paymentsRoute = new Hono();

const paymentAccountTypeSchema = z.enum(["CASH", "BANK"]);

const customerPaymentSchema = z.object({
  customerId: z.string().min(1),
  currencyId: z.string().min(1),
  amount: z.coerce.number().positive(),
  paymentAccountType: paymentAccountTypeSchema,
  paymentAccountId: z.string().min(1),
  note: z.string().trim().max(500).optional().nullable()
});

const supplierPaymentSchema = z.object({
  supplierId: z.string().min(1),
  currencyId: z.string().min(1),
  amount: z.coerce.number().positive(),
  paymentAccountType: paymentAccountTypeSchema,
  paymentAccountId: z.string().min(1),
  note: z.string().trim().max(500).optional().nullable()
});

const cancelPaymentSchema = z.object({
  reason: z.string().trim().max(500).optional().nullable()
});

async function getPaymentAccount(
  type: "CASH" | "BANK",
  id: string
) {
  if (type === "CASH") {
    const account = await prisma.cashRegisterAccount.findUnique({
      where: { id },
      include: {
        cashRegister: true,
        currency: true
      }
    });

    return account
      ? {
          kind: "CASH" as const,
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
        kind: "BANK" as const,
        id: account.id,
        currencyId: account.currencyId,
        balance: Number(account.balance),
        raw: account
      }
    : null;
}

paymentsRoute.post("/customer-receipts", async (c) => {
  const authUser = getAuthUser(c);
  const posDevice = await getRequestPosDevice(c, authUser?.id || null);
  const body = await c.req.json().catch(() => null);
  const parsed = customerPaymentSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const customer = await prisma.party.findUnique({
    where: { id: parsed.data.customerId }
  });

  if (!customer) {
    return c.json({ message: "Customer not found" }, 404);
  }

  if (customer.type !== PartyType.CUSTOMER && customer.type !== PartyType.BOTH) {
    return c.json({ message: "Selected party is not a customer" }, 400);
  }

  const currency = await prisma.currency.findUnique({
    where: { id: parsed.data.currencyId }
  });

  if (!currency) {
    return c.json({ message: "Currency not found" }, 404);
  }

  const paymentAccount = await getPaymentAccount(
    parsed.data.paymentAccountType,
    parsed.data.paymentAccountId
  );

  if (!paymentAccount) {
    return c.json({ message: "Payment account not found" }, 404);
  }

  if (paymentAccount.currencyId !== parsed.data.currencyId) {
    return c.json({ message: "Payment account currency must match selected currency" }, 400);
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
    const partyAccount = await tx.partyAccount.upsert({
      where: {
        partyId_currencyId: {
          partyId: parsed.data.customerId,
          currencyId: parsed.data.currencyId
        }
      },
      create: {
        partyId: parsed.data.customerId,
        currencyId: parsed.data.currencyId,
        debitBalance: 0,
        creditBalance: parsed.data.amount
      },
      update: {
        creditBalance: {
          increment: parsed.data.amount
        }
      },
      include: {
        currency: true
      }
    });

    const partyTransaction = await tx.partyTransaction.create({
      data: {
        partyId: parsed.data.customerId,
        currencyId: parsed.data.currencyId,
        type: PartyTransactionType.PAYMENT_RECEIVED,
        side: PartyAccountSide.CREDIT,
        amount: parsed.data.amount,
        referenceType: "CUSTOMER_PAYMENT",
        note: parsed.data.note ?? "Customer payment received"
      },
      include: {
        party: true,
        currency: true
      }
    });

    let moneyTransaction = null;

    if (paymentAccount.kind === "CASH") {
      const updatedAccount = await tx.cashRegisterAccount.update({
        where: { id: paymentAccount.id },
        data: {
          balance: {
            increment: parsed.data.amount
          }
        },
        include: {
          cashRegister: true,
          currency: true
        }
      });

      moneyTransaction = await tx.moneyTransaction.create({
        data: {
          currencyId: parsed.data.currencyId,
          cashRegisterAccountId: paymentAccount.id,
          type: MoneyTransactionType.CUSTOMER_PAYMENT,
          direction: MoneyDirection.IN,
          amount: parsed.data.amount,
          balanceAfter: updatedAccount.balance,
          ...snapshotBaseFields(currencySnapshot, {
            amount: parsed.data.amount,
            balanceAfter: Number(updatedAccount.balance)
          }),
          referenceType: "CUSTOMER_PAYMENT",
          referenceId: partyTransaction.id,
          note: parsed.data.note ?? "Customer payment received",
          createdByUserId: authUser?.id || null,
          posDeviceId: posDevice?.id || null
        }
      });
    } else {
      const updatedAccount = await tx.bankAccount.update({
        where: { id: paymentAccount.id },
        data: {
          balance: {
            increment: parsed.data.amount
          }
        },
        include: {
          currency: true
        }
      });

      moneyTransaction = await tx.moneyTransaction.create({
        data: {
          currencyId: parsed.data.currencyId,
          bankAccountId: paymentAccount.id,
          type: MoneyTransactionType.CUSTOMER_PAYMENT,
          direction: MoneyDirection.IN,
          amount: parsed.data.amount,
          balanceAfter: updatedAccount.balance,
          ...snapshotBaseFields(currencySnapshot, {
            amount: parsed.data.amount,
            balanceAfter: Number(updatedAccount.balance)
          }),
          referenceType: "CUSTOMER_PAYMENT",
          referenceId: partyTransaction.id,
          note: parsed.data.note ?? "Customer payment received",
          createdByUserId: authUser?.id || null,
          posDeviceId: posDevice?.id || null
        }
      });
    }

    const journalEntry = await createPostedJournal(tx, {
      entryNoPrefix: "JE-REC",
      sourceType: "CUSTOMER_RECEIPT",
      sourceId: partyTransaction.id,
      description: "Customer receipt",
      createdByUserId: authUser?.id || null,
      lines: [
        {
          accountCode: treasuryAccountCode(parsed.data.paymentAccountType),
          partyId: parsed.data.customerId,
          debit: parsed.data.amount,
          exchangeRate: currencySnapshot.exchangeRate,
          baseCurrencyId: currencySnapshot.baseCurrencyId,
          note: parsed.data.note ?? "Customer payment received"
        },
        {
          accountCode: "1200",
          partyId: parsed.data.customerId,
          credit: parsed.data.amount,
          exchangeRate: currencySnapshot.exchangeRate,
          baseCurrencyId: currencySnapshot.baseCurrencyId,
          note: "Customer receivable reduced"
        }
      ]
    });

    return {
      partyAccount,
      partyTransaction,
      moneyTransaction,
      journalEntry
    };
  });

  await writeAudit(c, {
    action: "CUSTOMER_PAYMENT_RECEIVED",
    entityType: "PartyTransaction",
    entityId: result.partyTransaction.id,
    metadata: {
      customerId: parsed.data.customerId,
      amount: parsed.data.amount
    }
  });

  return c.json({ data: result }, 201);
});

paymentsRoute.post("/supplier-payments", async (c) => {
  const authUser = getAuthUser(c);
  const posDevice = await getRequestPosDevice(c, authUser?.id || null);
  const body = await c.req.json().catch(() => null);
  const parsed = supplierPaymentSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const supplier = await prisma.party.findUnique({
    where: { id: parsed.data.supplierId }
  });

  if (!supplier) {
    return c.json({ message: "Supplier not found" }, 404);
  }

  if (supplier.type !== PartyType.SUPPLIER && supplier.type !== PartyType.BOTH) {
    return c.json({ message: "Selected party is not a supplier" }, 400);
  }

  const currency = await prisma.currency.findUnique({
    where: { id: parsed.data.currencyId }
  });

  if (!currency) {
    return c.json({ message: "Currency not found" }, 404);
  }

  const paymentAccount = await getPaymentAccount(
    parsed.data.paymentAccountType,
    parsed.data.paymentAccountId
  );

  if (!paymentAccount) {
    return c.json({ message: "Payment account not found" }, 404);
  }

  if (paymentAccount.currencyId !== parsed.data.currencyId) {
    return c.json({ message: "Payment account currency must match selected currency" }, 400);
  }

  if (paymentAccount.balance < parsed.data.amount) {
    return c.json({ message: "Not enough balance in payment account" }, 400);
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
    const partyAccount = await tx.partyAccount.upsert({
      where: {
        partyId_currencyId: {
          partyId: parsed.data.supplierId,
          currencyId: parsed.data.currencyId
        }
      },
      create: {
        partyId: parsed.data.supplierId,
        currencyId: parsed.data.currencyId,
        debitBalance: parsed.data.amount,
        creditBalance: 0
      },
      update: {
        debitBalance: {
          increment: parsed.data.amount
        }
      },
      include: {
        currency: true
      }
    });

    const partyTransaction = await tx.partyTransaction.create({
      data: {
        partyId: parsed.data.supplierId,
        currencyId: parsed.data.currencyId,
        type: PartyTransactionType.PAYMENT_PAID,
        side: PartyAccountSide.DEBIT,
        amount: parsed.data.amount,
        referenceType: "SUPPLIER_PAYMENT",
        note: parsed.data.note ?? "Supplier payment paid"
      },
      include: {
        party: true,
        currency: true
      }
    });

    let moneyTransaction = null;

    if (paymentAccount.kind === "CASH") {
      const updatedAccount = await tx.cashRegisterAccount.update({
        where: { id: paymentAccount.id },
        data: {
          balance: {
            decrement: parsed.data.amount
          }
        },
        include: {
          cashRegister: true,
          currency: true
        }
      });

      moneyTransaction = await tx.moneyTransaction.create({
        data: {
          currencyId: parsed.data.currencyId,
          cashRegisterAccountId: paymentAccount.id,
          type: MoneyTransactionType.SUPPLIER_PAYMENT,
          direction: MoneyDirection.OUT,
          amount: parsed.data.amount,
          balanceAfter: updatedAccount.balance,
          ...snapshotBaseFields(currencySnapshot, {
            amount: parsed.data.amount,
            balanceAfter: Number(updatedAccount.balance)
          }),
          referenceType: "SUPPLIER_PAYMENT",
          referenceId: partyTransaction.id,
          note: parsed.data.note ?? "Supplier payment paid",
          createdByUserId: authUser?.id || null,
          posDeviceId: posDevice?.id || null
        }
      });
    } else {
      const updatedAccount = await tx.bankAccount.update({
        where: { id: paymentAccount.id },
        data: {
          balance: {
            decrement: parsed.data.amount
          }
        },
        include: {
          currency: true
        }
      });

      moneyTransaction = await tx.moneyTransaction.create({
        data: {
          currencyId: parsed.data.currencyId,
          bankAccountId: paymentAccount.id,
          type: MoneyTransactionType.SUPPLIER_PAYMENT,
          direction: MoneyDirection.OUT,
          amount: parsed.data.amount,
          balanceAfter: updatedAccount.balance,
          ...snapshotBaseFields(currencySnapshot, {
            amount: parsed.data.amount,
            balanceAfter: Number(updatedAccount.balance)
          }),
          referenceType: "SUPPLIER_PAYMENT",
          referenceId: partyTransaction.id,
          note: parsed.data.note ?? "Supplier payment paid",
          createdByUserId: authUser?.id || null,
          posDeviceId: posDevice?.id || null
        }
      });
    }

    const journalEntry = await createPostedJournal(tx, {
      entryNoPrefix: "JE-PAY",
      sourceType: "SUPPLIER_PAYMENT",
      sourceId: partyTransaction.id,
      description: "Supplier payment",
      createdByUserId: authUser?.id || null,
      lines: [
        {
          accountCode: "2000",
          partyId: parsed.data.supplierId,
          debit: parsed.data.amount,
          exchangeRate: currencySnapshot.exchangeRate,
          baseCurrencyId: currencySnapshot.baseCurrencyId,
          note: parsed.data.note ?? "Supplier payable reduced"
        },
        {
          accountCode: treasuryAccountCode(parsed.data.paymentAccountType),
          partyId: parsed.data.supplierId,
          credit: parsed.data.amount,
          exchangeRate: currencySnapshot.exchangeRate,
          baseCurrencyId: currencySnapshot.baseCurrencyId,
          note: "Paid to supplier"
        }
      ]
    });

    return {
      partyAccount,
      partyTransaction,
      moneyTransaction,
      journalEntry
    };
  });

  await writeAudit(c, {
    action: "SUPPLIER_PAYMENT_PAID",
    entityType: "PartyTransaction",
    entityId: result.partyTransaction.id,
    metadata: {
      supplierId: parsed.data.supplierId,
      amount: parsed.data.amount
    }
  });

  return c.json({ data: result }, 201);
});

paymentsRoute.get("/party-transactions/:id", async (c) => {
  const id = c.req.param("id");

  const transaction = await prisma.partyTransaction.findUnique({
    where: { id },
    include: {
      party: true,
      currency: true
    }
  });

  if (!transaction) {
    return c.json({ message: "Payment transaction not found" }, 404);
  }

  const moneyTransaction = await prisma.moneyTransaction.findFirst({
    where: {
      referenceId: transaction.id
    },
    include: {
      cashRegisterAccount: {
        include: {
          cashRegister: true,
          currency: true
        }
      },
      bankAccount: {
        include: {
          currency: true
        }
      }
    }
  });

  return c.json({
    data: {
      partyTransaction: transaction,
      moneyTransaction
    }
  });
});

paymentsRoute.post("/party-transactions/:id/cancel", async (c) => {
  const authUser = getAuthUser(c);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const parsed = cancelPaymentSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const transaction = await prisma.partyTransaction.findUnique({
    where: { id },
    include: {
      party: true,
      currency: true
    }
  });

  if (!transaction) {
    return c.json({ message: "Payment transaction not found" }, 404);
  }

  if (
    transaction.referenceType?.endsWith("_CANCEL") ||
    transaction.type === PartyTransactionType.ADJUSTMENT
  ) {
    return c.json({ message: "This transaction cannot be cancelled directly" }, 400);
  }

  const existingCancel = await prisma.partyTransaction.findFirst({
    where: {
      referenceType: `${transaction.referenceType || transaction.type}_CANCEL`,
      referenceId: transaction.id
    }
  });

  if (existingCancel) {
    return c.json({ message: "Transaction is already cancelled" }, 400);
  }

  const moneyTransaction = await prisma.moneyTransaction.findFirst({
    where: {
      referenceId: transaction.id
    }
  });

  const result = await prisma.$transaction(async (tx) => {
    const partyAccount = await tx.partyAccount.findUnique({
      where: {
        partyId_currencyId: {
          partyId: transaction.partyId,
          currencyId: transaction.currencyId
        }
      }
    });

    if (partyAccount) {
      if (transaction.side === PartyAccountSide.DEBIT) {
        await tx.partyAccount.update({
          where: { id: partyAccount.id },
          data: { debitBalance: { decrement: transaction.amount } }
        });
      } else {
        await tx.partyAccount.update({
          where: { id: partyAccount.id },
          data: { creditBalance: { decrement: transaction.amount } }
        });
      }
    }

    const cancelPartyTransaction = await tx.partyTransaction.create({
      data: {
        partyId: transaction.partyId,
        currencyId: transaction.currencyId,
        type: PartyTransactionType.ADJUSTMENT,
        side:
          transaction.side === PartyAccountSide.DEBIT
            ? PartyAccountSide.CREDIT
            : PartyAccountSide.DEBIT,
        amount: transaction.amount,
        referenceType: `${transaction.referenceType || transaction.type}_CANCEL`,
        referenceId: transaction.id,
        note: parsed.data.reason ?? "Payment cancelled"
      },
      include: {
        party: true,
        currency: true
      }
    });

    let cancelMoneyTransaction = null;

    if (moneyTransaction) {
      const amount = Number(moneyTransaction.amount);
      const cancelDirection =
        moneyTransaction.direction === MoneyDirection.IN
          ? MoneyDirection.OUT
          : MoneyDirection.IN;

      if (moneyTransaction.cashRegisterAccountId) {
        if (cancelDirection === MoneyDirection.OUT) {
          const account = await tx.cashRegisterAccount.findUnique({
            where: { id: moneyTransaction.cashRegisterAccountId }
          });

          if (!account || Number(account.balance) < amount) {
            throw new Error("Not enough cash balance to cancel payment");
          }
        }

        const updated = await tx.cashRegisterAccount.update({
          where: { id: moneyTransaction.cashRegisterAccountId },
          data:
            cancelDirection === MoneyDirection.IN
              ? { balance: { increment: amount } }
              : { balance: { decrement: amount } }
        });

        cancelMoneyTransaction = await tx.moneyTransaction.create({
          data: {
            currencyId: moneyTransaction.currencyId,
            cashRegisterAccountId: moneyTransaction.cashRegisterAccountId,
            type: MoneyTransactionType.ADJUSTMENT,
            direction: cancelDirection,
            amount,
            balanceAfter: updated.balance,
            exchangeRate: Number(moneyTransaction.exchangeRate || 1),
            baseCurrencyId: moneyTransaction.baseCurrencyId,
            baseAmount: toBaseAmount(amount, {
              exchangeRate: Number(moneyTransaction.exchangeRate || 1),
              baseCurrencyId: moneyTransaction.baseCurrencyId
            }),
            baseBalanceAfter: toBaseAmount(Number(updated.balance), {
              exchangeRate: Number(moneyTransaction.exchangeRate || 1),
              baseCurrencyId: moneyTransaction.baseCurrencyId
            }),
            referenceType: `${moneyTransaction.referenceType || "PAYMENT"}_CANCEL`,
            referenceId: transaction.id,
            note: parsed.data.reason ?? "Payment cancellation",
            createdByUserId: authUser?.id ?? null
          }
        });
      }

      if (moneyTransaction.bankAccountId) {
        if (cancelDirection === MoneyDirection.OUT) {
          const account = await tx.bankAccount.findUnique({
            where: { id: moneyTransaction.bankAccountId }
          });

          if (!account || Number(account.balance) < amount) {
            throw new Error("Not enough bank balance to cancel payment");
          }
        }

        const updated = await tx.bankAccount.update({
          where: { id: moneyTransaction.bankAccountId },
          data:
            cancelDirection === MoneyDirection.IN
              ? { balance: { increment: amount } }
              : { balance: { decrement: amount } }
        });

        cancelMoneyTransaction = await tx.moneyTransaction.create({
          data: {
            currencyId: moneyTransaction.currencyId,
            bankAccountId: moneyTransaction.bankAccountId,
            type: MoneyTransactionType.ADJUSTMENT,
            direction: cancelDirection,
            amount,
            balanceAfter: updated.balance,
            exchangeRate: Number(moneyTransaction.exchangeRate || 1),
            baseCurrencyId: moneyTransaction.baseCurrencyId,
            baseAmount: toBaseAmount(amount, {
              exchangeRate: Number(moneyTransaction.exchangeRate || 1),
              baseCurrencyId: moneyTransaction.baseCurrencyId
            }),
            baseBalanceAfter: toBaseAmount(Number(updated.balance), {
              exchangeRate: Number(moneyTransaction.exchangeRate || 1),
              baseCurrencyId: moneyTransaction.baseCurrencyId
            }),
            referenceType: `${moneyTransaction.referenceType || "PAYMENT"}_CANCEL`,
            referenceId: transaction.id,
            note: parsed.data.reason ?? "Payment cancellation",
            createdByUserId: authUser?.id ?? null
          }
        });
      }
    }

    const sourceType =
      transaction.referenceType === "SUPPLIER_PAYMENT"
        ? "SUPPLIER_PAYMENT"
        : "CUSTOMER_RECEIPT";

    const journalEntry = await createReversalJournal(tx, {
      sourceType,
      sourceId: transaction.id,
      reversalSourceType: `${sourceType}_CANCEL`,
      reversalSourceId: transaction.id,
      entryNoPrefix: sourceType === "SUPPLIER_PAYMENT" ? "JE-PAYC" : "JE-RECC",
      description: `${sourceType} cancellation`,
      createdByUserId: authUser?.id ?? null
    });

    return {
      partyTransaction: cancelPartyTransaction,
      moneyTransaction: cancelMoneyTransaction,
      journalEntry
    };
  });

  await writeAudit(c, {
    action: "PARTY_PAYMENT_CANCELLED",
    entityType: "PartyTransaction",
    entityId: transaction.id,
    metadata: {
      reason: parsed.data.reason ?? null
    }
  });

  return c.json({ data: result });
});
