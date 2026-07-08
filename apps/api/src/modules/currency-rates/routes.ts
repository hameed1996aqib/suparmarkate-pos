import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { zodError } from "../../lib/api";
import { getAuthUser, writeAudit } from "../../lib/auth";
import { getBaseCurrency } from "../../lib/currency-rates";
import { createPaginationMeta, getPagePagination } from "../../lib/pagination";

export const currencyRatesRoute = new Hono();

const createRateSchema = z.object({
  currencyId: z.string().min(1),
  rateToBase: z.coerce.number().positive(),
  effectiveAt: z.string().trim().optional().nullable(),
  note: z.string().trim().max(500).optional().nullable()
});

function parseDate(value?: string | null) {
  if (!value) return new Date();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

currencyRatesRoute.get("/", async (c) => {
  const pagination = getPagePagination(c, { defaultLimit: 50, maxLimit: 200 });
  const currencyId = c.req.query("currencyId");
  const search = c.req.query("search")?.trim();
  const from = parseDate(c.req.query("from"));
  const to = parseDate(c.req.query("to"));
  if (to) to.setHours(23, 59, 59, 999);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const tomorrow = new Date(todayStart);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const baseWhere = {
      deletedAt: null,
      ...(currencyId ? { currencyId } : {}),
      ...(search
        ? {
            OR: [
              { note: { contains: search, mode: "insensitive" as const } },
              { currency: { code: { contains: search, mode: "insensitive" as const } } },
              { currency: { name: { contains: search, mode: "insensitive" as const } } },
            ],
          }
        : {})
    };
  const where = {
      ...baseWhere,
      ...(from || to
        ? {
            effectiveAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {})
            }
          }
        : {})
    };
  const [rates, total, todayCount, latestRate] = await Promise.all([
    prisma.currencyRate.findMany({
    where,
    include: {
      currency: true
    },
    orderBy: [
      { effectiveAt: "desc" },
      { createdAt: "desc" }
    ],
    skip: pagination.skip,
    take: pagination.limit
  }),
    prisma.currencyRate.count({ where }),
    prisma.currencyRate.count({
      where: {
        ...baseWhere,
        effectiveAt: { gte: todayStart, lt: tomorrow }
      }
    }),
    prisma.currencyRate.findFirst({
      where: baseWhere,
      orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }],
      select: { effectiveAt: true }
    })
  ]);

  return c.json({
    data: rates,
    pagination: createPaginationMeta({ ...pagination, total }),
    summary: {
      todayCount,
      latestRateAt: latestRate?.effectiveAt ?? null
    }
  });
});

currencyRatesRoute.get("/latest", async (c) => {
  const currencyId = c.req.query("currencyId");

  if (!currencyId) {
    return c.json({ message: "currencyId is required" }, 400);
  }

  const currency = await prisma.currency.findUnique({ where: { id: currencyId } });

  if (!currency || currency.deletedAt) {
    return c.json({ message: "Currency not found" }, 404);
  }

  const baseCurrency = await getBaseCurrency(prisma);

  if (currency.isBase || currency.id === baseCurrency?.id) {
    return c.json({
      data: {
        currencyId: currency.id,
        rateToBase: 1,
        effectiveAt: new Date().toISOString(),
        isBaseRate: true
      }
    });
  }

  const rate = await prisma.currencyRate.findFirst({
    where: {
      currencyId,
      deletedAt: null,
      effectiveAt: { lte: new Date() }
    },
    include: {
      currency: true
    },
    orderBy: [
      { effectiveAt: "desc" },
      { createdAt: "desc" }
    ]
  });

  if (!rate) {
    return c.json({ message: "برای این کرنسی نرخ فعال ثبت نشده است" }, 404);
  }

  return c.json({ data: rate });
});

currencyRatesRoute.post("/", async (c) => {
  const authUser = getAuthUser(c);
  const body = await c.req.json().catch(() => null);
  const parsed = createRateSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const effectiveAt = parseDate(parsed.data.effectiveAt);

  if (!effectiveAt) {
    return c.json({ message: "Invalid effectiveAt" }, 400);
  }

  const currency = await prisma.currency.findUnique({
    where: { id: parsed.data.currencyId }
  });

  if (!currency || currency.deletedAt || !currency.isActive) {
    return c.json({ message: "Currency not found or inactive" }, 404);
  }

  if (currency.isBase && parsed.data.rateToBase !== 1) {
    return c.json({ message: "نرخ کرنسی پایه باید 1 باشد" }, 400);
  }

  const item = await prisma.currencyRate.create({
    data: {
      currencyId: parsed.data.currencyId,
      rateToBase: parsed.data.rateToBase,
      effectiveAt,
      note: parsed.data.note ?? null,
      createdByUserId: authUser?.id ?? null
    },
    include: {
      currency: true
    }
  });

  await writeAudit(c, {
    action: "CURRENCY_RATE_CREATED",
    entityType: "CurrencyRate",
    entityId: item.id,
    metadata: {
      currencyId: item.currencyId,
      rateToBase: Number(item.rateToBase)
    }
  });

  return c.json({ data: item }, 201);
});

currencyRatesRoute.delete("/:id", async (c) => {
  const authUser = getAuthUser(c);
  const id = c.req.param("id");

  const rate = await prisma.currencyRate.findUnique({
    where: { id },
    include: {
      currency: true
    }
  });

  if (!rate || rate.deletedAt) {
    return c.json({ message: "Currency rate not found" }, 404);
  }

  if (rate.currency.isBase) {
    return c.json({ message: "نرخ کرنسی پایه قابل حذف نیست" }, 400);
  }

  const latestRate = await prisma.currencyRate.findFirst({
    where: {
      currencyId: rate.currencyId,
      deletedAt: null,
      effectiveAt: { lte: new Date() }
    },
    orderBy: [
      { effectiveAt: "desc" },
      { createdAt: "desc" }
    ]
  });

  if (latestRate?.id === rate.id) {
    return c.json({
      message: "آخرین نرخ فعال قابل حذف نیست؛ برای اصلاح، نرخ جدید ثبت کنید."
    }, 400);
  }

  const exchangeRate = Number(rate.rateToBase);
  const usedSnapshot = await Promise.all([
    prisma.purchase.count({ where: { currencyId: rate.currencyId, exchangeRate } }),
    prisma.purchaseReturn.count({ where: { currencyId: rate.currencyId, exchangeRate } }),
    prisma.sale.count({ where: { currencyId: rate.currencyId, exchangeRate } }),
    prisma.saleReturn.count({ where: { currencyId: rate.currencyId, exchangeRate } }),
    prisma.moneyTransaction.count({ where: { currencyId: rate.currencyId, exchangeRate } }),
    prisma.employeePayment.count({ where: { currencyId: rate.currencyId, exchangeRate } })
  ]);

  if (usedSnapshot.some((count) => count > 0)) {
    return c.json(
      { message: "این نرخ در سند مالی استفاده شده و قابل حذف نیست." },
      400
    );
  }

  const item = await prisma.currencyRate.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      deletedByUserId: authUser?.id ?? null
    }
  });

  await writeAudit(c, {
    action: "CURRENCY_RATE_DELETED",
    entityType: "CurrencyRate",
    entityId: item.id
  });

  return c.json({ data: item });
});
