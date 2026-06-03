import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { zodError } from "../../lib/api";
import { attachAuditUsers, auditCreateData, auditDeleteData, auditUpdateData } from "../../lib/audit-meta";
import { getAuthUser, writeAudit } from "../../lib/auth";

export const currenciesRoute = new Hono();
const BASE_CURRENCY_CODE = "AFN";

const createCurrencySchema = z.object({
  code: z.string().trim().min(2).max(10).transform((v) => v.toUpperCase()),
  name: z.string().trim().min(2).max(100),
  symbol: z.string().trim().max(10).optional().nullable(),
  isBase: z.boolean().optional(),
  isActive: z.boolean().optional()
});

const updateCurrencySchema = createCurrencySchema.partial();

async function attachLatestRates<T extends { id: string; isBase?: boolean }>(
  items: T[]
) {
  const latestRates = await Promise.all(
    items.map(async (currency) => {
      if (currency.isBase) {
        return {
          currencyId: currency.id,
          latestRate: 1,
          latestRateAt: null
        };
      }

      const rate = await prisma.currencyRate.findFirst({
        where: {
          currencyId: currency.id,
          deletedAt: null,
          effectiveAt: { lte: new Date() }
        },
        orderBy: [
          { effectiveAt: "desc" },
          { createdAt: "desc" }
        ]
      });

      return {
        currencyId: currency.id,
        latestRate: rate ? Number(rate.rateToBase) : null,
        latestRateAt: rate?.effectiveAt ?? null
      };
    })
  );
  const latestByCurrency = new Map(
    latestRates.map((rate) => [rate.currencyId, rate])
  );

  return items.map((item) => ({
    ...item,
    latestRate: latestByCurrency.get(item.id)?.latestRate ?? null,
    latestRateAt: latestByCurrency.get(item.id)?.latestRateAt ?? null
  }));
}

currenciesRoute.get("/", async (c) => {
  const [
    partyAccounts,
    cashAccounts,
    bankAccounts,
    moneyTransactions,
    employeePayments,
    purchases,
    purchaseReturns,
    sales,
    saleReturns
  ] = await Promise.all([
    prisma.partyAccount.findMany({ select: { currencyId: true }, distinct: ["currencyId"] }),
    prisma.cashRegisterAccount.findMany({ select: { currencyId: true }, distinct: ["currencyId"] }),
    prisma.bankAccount.findMany({ select: { currencyId: true }, distinct: ["currencyId"] }),
    prisma.moneyTransaction.findMany({ select: { currencyId: true }, distinct: ["currencyId"] }),
    prisma.employeePayment.findMany({ select: { currencyId: true }, distinct: ["currencyId"] }),
    prisma.purchase.findMany({ select: { currencyId: true }, distinct: ["currencyId"] }),
    prisma.purchaseReturn.findMany({ select: { currencyId: true }, distinct: ["currencyId"] }),
    prisma.sale.findMany({ select: { currencyId: true }, distinct: ["currencyId"] }),
    prisma.saleReturn.findMany({ select: { currencyId: true }, distinct: ["currencyId"] })
  ]);
  const usedCurrencyIds = Array.from(
    new Set(
      [
        ...partyAccounts,
        ...cashAccounts,
        ...bankAccounts,
        ...moneyTransactions,
        ...employeePayments,
        ...purchases,
        ...purchaseReturns,
        ...sales,
        ...saleReturns
      ].map((row) => row.currencyId)
    )
  );

  const items = await prisma.currency.findMany({
    where: {
      OR: [
        {
          deletedAt: null
        },
        {
          id: {
            in: usedCurrencyIds
          }
        }
      ]
    },
    orderBy: [{ isBase: "desc" }, { code: "asc" }]
  });

  const withAudit = await attachAuditUsers(items);

  return c.json({ data: await attachLatestRates(withAudit) });
});

currenciesRoute.get("/:id", async (c) => {
  const id = c.req.param("id");

  const item = await prisma.currency.findUnique({
    where: { id }
  });

  if (!item || item.deletedAt) {
    return c.json({ message: "Currency not found" }, 404);
  }

  const [withAudit] = await attachLatestRates([await attachAuditUsers(item)]);

  return c.json({ data: withAudit });
});

currenciesRoute.post("/", async (c) => {
  const authUser = getAuthUser(c);
  const body = await c.req.json().catch(() => null);
  const parsed = createCurrencySchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  if (parsed.data.isBase && parsed.data.code !== BASE_CURRENCY_CODE) {
    return c.json({ message: "Only AFN can be the base currency" }, 400);
  }

  const item = await prisma.$transaction(async (tx) => {
    return tx.currency.create({
      data: {
        ...parsed.data,
        isBase: parsed.data.code === BASE_CURRENCY_CODE,
        ...auditCreateData(authUser?.id)
      }
    });
  });

  await writeAudit(c, {
    action: "CURRENCY_CREATED",
    entityType: "Currency",
    entityId: item.id,
    metadata: { code: item.code, name: item.name }
  });

  return c.json({ data: item }, 201);
});

currenciesRoute.patch("/:id", async (c) => {
  const authUser = getAuthUser(c);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = updateCurrencySchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const existing = await prisma.currency.findUnique({ where: { id } });

  if (!existing || existing.deletedAt) {
    return c.json({ message: "Currency not found" }, 404);
  }

  const nextCode = parsed.data.code ?? existing.code;
  if (parsed.data.isBase && nextCode !== BASE_CURRENCY_CODE) {
    return c.json({ message: "Only AFN can be the base currency" }, 400);
  }
  if (existing.code === BASE_CURRENCY_CODE && parsed.data.isBase === false) {
    return c.json({ message: "AFN must remain the base currency" }, 400);
  }
  if (existing.code === BASE_CURRENCY_CODE && nextCode !== BASE_CURRENCY_CODE) {
    return c.json({ message: "The base AFN currency code cannot be changed" }, 400);
  }

  const item = await prisma.$transaction(async (tx) => {
    return tx.currency.update({
      where: { id },
      data: {
        ...parsed.data,
        isBase: nextCode === BASE_CURRENCY_CODE,
        ...auditUpdateData(authUser?.id)
      }
    });
  });

  await writeAudit(c, {
    action: "CURRENCY_UPDATED",
    entityType: "Currency",
    entityId: item.id,
    metadata: { code: item.code, name: item.name }
  });

  return c.json({ data: item });
});

currenciesRoute.delete("/:id", async (c) => {
  const authUser = getAuthUser(c);
  const id = c.req.param("id");

  const currency = await prisma.currency.findUnique({ where: { id } });

  if (!currency || currency.deletedAt) {
    return c.json({ message: "Currency not found" }, 404);
  }

  if (currency.isBase) {
    return c.json(
      {
        message: "کرنسی اصلی سیستم قابل حذف نیست. اگر لازم است فقط آن را غیرفعال کنید."
      },
      400
    );
  }

  const [
    partyAccounts,
    cashAccounts,
    bankAccounts,
    moneyTransactions,
    employeePayments,
    purchases,
    purchaseReturns,
    sales,
    saleReturns
  ] = await Promise.all([
    prisma.partyAccount.count({ where: { currencyId: id } }),
    prisma.cashRegisterAccount.count({ where: { currencyId: id } }),
    prisma.bankAccount.count({ where: { currencyId: id } }),
    prisma.moneyTransaction.count({ where: { currencyId: id } }),
    prisma.employeePayment.count({ where: { currencyId: id } }),
    prisma.purchase.count({ where: { currencyId: id } }),
    prisma.purchaseReturn.count({ where: { currencyId: id } }),
    prisma.sale.count({ where: { currencyId: id } }),
    prisma.saleReturn.count({ where: { currencyId: id } })
  ]);
  const usageCount =
    partyAccounts +
    cashAccounts +
    bankAccounts +
    moneyTransactions +
    employeePayments +
    purchases +
    purchaseReturns +
    sales +
    saleReturns;

  if (usageCount > 0) {
    return c.json(
      {
        message:
          "این کرنسی در حساب‌ها یا معاملات استفاده شده است و قابل حذف نیست. اگر لازم است، آن را غیرفعال کنید.",
        usage: {
          partyAccounts,
          cashAccounts,
          bankAccounts,
          moneyTransactions,
          employeePayments,
          purchases,
          purchaseReturns,
          sales,
          saleReturns
        }
      },
      400
    );
  }

  const item = await prisma.currency.update({
    where: { id },
    data: auditDeleteData(authUser?.id)
  });

  await writeAudit(c, {
    action: "CURRENCY_DELETED",
    entityType: "Currency",
    entityId: item.id,
    metadata: { code: item.code, name: item.name }
  });

  return c.json({ message: "Currency deactivated", data: item });
});
