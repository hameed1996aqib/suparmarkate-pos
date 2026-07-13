import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { zodError } from "../../lib/api";
import { attachAuditUsers, auditCreateData, auditDeleteData, auditUpdateData } from "../../lib/audit-meta";
import { getAuthUser, writeAudit } from "../../lib/auth";
import {
  PartyAccountSide,
  PartyTransactionType,
  PartyType
} from "../../generated/prisma/enums";
import { createPaginationMeta, getPagePagination } from "../../lib/pagination";
import { getRecentDateRange } from "../../lib/recent-date-range";
import { Prisma } from "../../generated/prisma/client";

export const partiesRoute = new Hono();

const partyTypeSchema = z.nativeEnum(PartyType);

async function attachAccountCurrencyRates(items: any[]) {
  const currencyIds = Array.from(
    new Set(
      items.flatMap((item) =>
        Array.isArray(item.accounts)
          ? item.accounts
              .map((account: any) => account.currencyId)
              .filter(Boolean)
          : []
      )
    )
  );

  if (currencyIds.length === 0) return items;

  const currencies = await prisma.currency.findMany({
    where: { id: { in: currencyIds } },
    select: { id: true, isBase: true }
  });
  const baseByCurrency = new Map(
    currencies.map((currency) => [currency.id, currency.isBase])
  );
  const latestRates = await Promise.all(
    currencyIds.map(async (currencyId) => {
      if (baseByCurrency.get(currencyId)) {
        return { currencyId, latestRate: 1, latestRateAt: null };
      }

      const rate = await prisma.currencyRate.findFirst({
        where: {
          currencyId,
          deletedAt: null,
          effectiveAt: { lte: new Date() }
        },
        orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }]
      });

      return {
        currencyId,
        latestRate: rate ? Number(rate.rateToBase) : null,
        latestRateAt: rate?.effectiveAt ?? null
      };
    })
  );
  const rateByCurrency = new Map(
    latestRates.map((rate) => [rate.currencyId, rate])
  );

  return items.map((item) => ({
    ...item,
    accounts: Array.isArray(item.accounts)
      ? item.accounts.map((account: any) => {
          const rate = rateByCurrency.get(account.currencyId);

          return {
            ...account,
            currency: account.currency
              ? {
                  ...account.currency,
                  latestRate: rate?.latestRate ?? null,
                  latestRateAt: rate?.latestRateAt ?? null
                }
              : account.currency
          };
        })
      : item.accounts
  }));
}

const createPartySchema = z.object({
  type: partyTypeSchema.default(PartyType.CUSTOMER),
  code: z.string().trim().max(60).optional().nullable(),
  name: z.string().trim().min(2).max(160),
  companyName: z.string().trim().max(160).optional().nullable(),
  contactPerson: z.string().trim().max(160).optional().nullable(),
  phone: z.string().trim().max(50).optional().nullable(),
  secondaryPhone: z.string().trim().max(50).optional().nullable(),
  email: z.string().trim().email().max(160).optional().nullable(),
  taxNumber: z.string().trim().max(80).optional().nullable(),
  licenseNumber: z.string().trim().max(80).optional().nullable(),
  province: z.string().trim().max(120).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  address: z.string().trim().max(300).optional().nullable(),
  creditLimit: z.coerce.number().nonnegative().optional(),
  paymentTermsDays: z.coerce.number().int().nonnegative().optional(),
  openingBalanceAmount: z.coerce.number().nonnegative().optional().default(0),
  openingBalanceCurrencyId: z.string().trim().optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
  isActive: z.boolean().optional()
});

const updatePartySchema = createPartySchema.partial();

const partyTransactionSchema = z.object({
  currencyId: z.string().min(1),
  type: z.nativeEnum(PartyTransactionType).default(PartyTransactionType.OPENING_BALANCE),
  side: z.nativeEnum(PartyAccountSide),
  amount: z.coerce.number().positive(),
  referenceType: z.string().trim().max(80).optional().nullable(),
  referenceId: z.string().trim().max(120).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable()
});

function normalizePartyType(value: string | undefined) {
  if (!value) return undefined;

  const upper = value.toUpperCase();

  if (upper === "CUSTOMER") return PartyType.CUSTOMER;
  if (upper === "SUPPLIER") return PartyType.SUPPLIER;
  if (upper === "BOTH") return PartyType.BOTH;

  return undefined;
}

function partyTypeWhere(type?: PartyType) {
  if (type === PartyType.CUSTOMER) {
    return { type: { in: [PartyType.CUSTOMER, PartyType.BOTH] } };
  }

  if (type === PartyType.SUPPLIER) {
    return { type: { in: [PartyType.SUPPLIER, PartyType.BOTH] } };
  }

  return type ? { type } : {};
}

function partyTypeSql(type?: PartyType) {
  if (type === PartyType.CUSTOMER) {
    return Prisma.sql`p.type IN ('CUSTOMER', 'BOTH')`;
  }

  if (type === PartyType.SUPPLIER) {
    return Prisma.sql`p.type IN ('SUPPLIER', 'BOTH')`;
  }

  if (type === PartyType.BOTH) {
    return Prisma.sql`p.type = 'BOTH'::"PartyType"`;
  }

  return Prisma.sql`TRUE`;
}

partiesRoute.get("/", async (c) => {
  const pagination = getPagePagination(c);
  const search = c.req.query("search");
  const type = normalizePartyType(c.req.query("type"));
  const where = {
      AND: [
        {
          OR: [
            {
              deletedAt: null
            },
            {
              accounts: { some: {} }
            },
            {
              transactions: { some: {} }
            },
            {
              purchases: { some: {} }
            },
            {
              purchaseReturns: { some: {} }
            },
            {
              sales: { some: {} }
            },
            {
              saleReturns: { some: {} }
            },
            {
              journalLines: { some: {} }
            }
          ]
        },
        partyTypeWhere(type),
        ...(search
          ? [
              {
                OR: [
                  { name: { contains: search, mode: "insensitive" as const } },
                  { code: { contains: search, mode: "insensitive" as const } },
                  { companyName: { contains: search, mode: "insensitive" as const } },
                  { contactPerson: { contains: search, mode: "insensitive" as const } },
                  { phone: { contains: search, mode: "insensitive" as const } },
                  { secondaryPhone: { contains: search, mode: "insensitive" as const } }
                ]
              }
            ]
          : [])
      ]
  };
  const summaryType = type ?? PartyType.CUSTOMER;
  const summaryTypeFilter = partyTypeSql(summaryType);
  const [items, total, summaryRows] = await Promise.all([
    prisma.party.findMany({
    where,
    include: {
      accounts: {
        include: {
          currency: true
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    },
    skip: pagination.skip,
    take: pagination.limit
  }),
    prisma.party.count({ where }),
    prisma.$queryRaw<Array<{ count: number; active: number; inactive: number; balance: unknown }>>(Prisma.sql`
      SELECT
        COUNT(DISTINCT p.id)::int count,
        COUNT(DISTINCT p.id) FILTER (WHERE p."isActive" = true)::int active,
        COUNT(DISTINCT p.id) FILTER (WHERE p."isActive" = false)::int inactive,
        COALESCE(SUM(
          GREATEST(
            COALESCE(
              CASE
                WHEN ${summaryType} = 'CUSTOMER' THEN pa."debitBalance" - pa."creditBalance"
                ELSE pa."creditBalance" - pa."debitBalance"
              END,
              0
            ),
            0
          ) * COALESCE(
            CASE WHEN c."isBase" = true THEN 1 ELSE latest_rate."rateToBase" END,
            1
          )
        ), 0) balance
      FROM "Party" p
      LEFT JOIN "PartyAccount" pa ON pa."partyId" = p.id
      LEFT JOIN "Currency" c ON c.id = pa."currencyId"
      LEFT JOIN LATERAL (
        SELECT cr."rateToBase"
        FROM "CurrencyRate" cr
        WHERE cr."currencyId" = pa."currencyId"
          AND cr."deletedAt" IS NULL
          AND cr."effectiveAt" <= NOW()
        ORDER BY cr."effectiveAt" DESC, cr."createdAt" DESC
        LIMIT 1
      ) latest_rate ON true
      WHERE p."deletedAt" IS NULL
        AND ${summaryTypeFilter}
    `)
  ]);

  const summary = summaryRows[0];
  const itemsWithRates = await attachAccountCurrencyRates(items);
  return c.json({
    data: await attachAuditUsers(itemsWithRates),
    pagination: createPaginationMeta({ ...pagination, total }),
    summary: {
      count: summary?.count ?? 0,
      active: summary?.active ?? 0,
      inactive: summary?.inactive ?? 0,
      balance: Number(summary?.balance ?? 0)
    }
  });
});

partiesRoute.get("/lookup", async (c) => {
  const search = (c.req.query("search") || "").trim();
  const type = normalizePartyType(c.req.query("type"));
  const requestedLimit = Number.parseInt(c.req.query("limit") || "60", 10);
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 60, 1), 100);

  const items = await prisma.party.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      ...(type === PartyType.CUSTOMER
        ? { type: { in: [PartyType.CUSTOMER, PartyType.BOTH] } }
        : type === PartyType.SUPPLIER
          ? { type: { in: [PartyType.SUPPLIER, PartyType.BOTH] } }
          : type
            ? { type }
            : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { code: { contains: search, mode: "insensitive" as const } },
              { companyName: { contains: search, mode: "insensitive" as const } },
              { phone: { contains: search, mode: "insensitive" as const } }
            ]
          }
        : {})
    },
    select: {
      id: true,
      code: true,
      name: true,
      companyName: true,
      phone: true,
      email: true,
      type: true,
      isActive: true,
      accounts: {
        select: {
          id: true,
          currencyId: true,
          debitBalance: true,
          creditBalance: true,
          currency: {
            select: {
              id: true,
              code: true,
              symbol: true,
              isBase: true
            }
          }
        }
      }
    },
    orderBy: { name: "asc" },
    take: limit
  });

  return c.json({ data: await attachAccountCurrencyRates(items) });
});

partiesRoute.get("/:id", async (c) => {
  const id = c.req.param("id");

  const item = await prisma.party.findUnique({
    where: { id },
    include: {
      accounts: {
        include: {
          currency: true
        },
        orderBy: {
          createdAt: "asc"
        }
      },
      transactions: {
        include: {
          currency: true
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 100
      }
    }
  });

  if (!item || item.deletedAt) {
    return c.json({ message: "Party not found" }, 404);
  }

  const [itemWithRates] = await attachAccountCurrencyRates([item]);

  return c.json({ data: await attachAuditUsers(itemWithRates) });
});

partiesRoute.post("/", async (c) => {
  const authUser = getAuthUser(c);
  const body = await c.req.json().catch(() => null);
  const parsed = createPartySchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const {
    openingBalanceAmount,
    openingBalanceCurrencyId,
    ...partyData
  } = parsed.data;

  if (Number(openingBalanceAmount || 0) > 0 && !openingBalanceCurrencyId) {
    return c.json({ message: "Opening balance currency is required" }, 400);
  }

  const item = await prisma.$transaction(async (tx) => {
    const party = await tx.party.create({
      data: {
        ...partyData,
        ...auditCreateData(authUser?.id)
      }
    });

    if (Number(openingBalanceAmount || 0) > 0 && openingBalanceCurrencyId) {
      const side =
        party.type === PartyType.SUPPLIER
          ? PartyAccountSide.CREDIT
          : PartyAccountSide.DEBIT;

      await tx.partyAccount.upsert({
        where: {
          partyId_currencyId: {
            partyId: party.id,
            currencyId: openingBalanceCurrencyId
          }
        },
        create: {
          partyId: party.id,
          currencyId: openingBalanceCurrencyId,
          debitBalance: side === PartyAccountSide.DEBIT ? openingBalanceAmount : 0,
          creditBalance: side === PartyAccountSide.CREDIT ? openingBalanceAmount : 0
        },
        update:
          side === PartyAccountSide.DEBIT
            ? { debitBalance: { increment: openingBalanceAmount } }
            : { creditBalance: { increment: openingBalanceAmount } }
      });

      await tx.partyTransaction.create({
        data: {
          partyId: party.id,
          currencyId: openingBalanceCurrencyId,
          type: PartyTransactionType.OPENING_BALANCE,
          side,
          amount: openingBalanceAmount,
          referenceType: "OPENING_BALANCE",
          referenceId: party.id,
          note: "Initial balance"
        }
      });
    }

    return party;
  });

  await writeAudit(c, {
    action: "PARTY_CREATED",
    entityType: "Party",
    entityId: item.id,
    metadata: { name: item.name, type: item.type }
  });

  return c.json({ data: item }, 201);
});

partiesRoute.patch("/:id", async (c) => {
  const authUser = getAuthUser(c);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = updatePartySchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const {
    openingBalanceAmount: _openingBalanceAmount,
    openingBalanceCurrencyId: _openingBalanceCurrencyId,
    ...partyUpdateData
  } = parsed.data;

  const item = await prisma.party.update({
    where: { id },
    data: {
      ...partyUpdateData,
      ...auditUpdateData(authUser?.id)
    }
  });

  await writeAudit(c, {
    action: "PARTY_UPDATED",
    entityType: "Party",
    entityId: item.id,
    metadata: { name: item.name, type: item.type }
  });

  return c.json({ data: item });
});

partiesRoute.delete("/:id", async (c) => {
  const authUser = getAuthUser(c);
  const id = c.req.param("id");

  const [accounts, transactions, purchases, purchaseReturns, sales, saleReturns, journalLines] =
    await Promise.all([
      prisma.partyAccount.count({ where: { partyId: id } }),
      prisma.partyTransaction.count({ where: { partyId: id } }),
      prisma.purchase.count({ where: { supplierId: id } }),
      prisma.purchaseReturn.count({ where: { supplierId: id } }),
      prisma.sale.count({ where: { customerId: id } }),
      prisma.saleReturn.count({ where: { customerId: id } }),
      prisma.journalLine.count({ where: { partyId: id } })
    ]);
  const usageCount =
    accounts +
    transactions +
    purchases +
    purchaseReturns +
    sales +
    saleReturns +
    journalLines;

  if (usageCount > 0) {
    return c.json(
      {
        message:
          "این مشتری/فروشنده در حسابداری، خرید یا فروش استفاده شده است و قابل حذف نیست. اگر لازم است، آن را غیرفعال کنید.",
        usage: {
          accounts,
          transactions,
          purchases,
          purchaseReturns,
          sales,
          saleReturns,
          journalLines
        }
      },
      400
    );
  }

  const item = await prisma.party.update({
    where: { id },
    data: auditDeleteData(authUser?.id)
  });

  await writeAudit(c, {
    action: "PARTY_DELETED",
    entityType: "Party",
    entityId: item.id,
    metadata: { name: item.name, type: item.type }
  });

  return c.json({
    message: "Party deactivated",
    data: item
  });
});

partiesRoute.get("/:id/accounts", async (c) => {
  const id = c.req.param("id");

  const accounts = await prisma.partyAccount.findMany({
    where: {
      partyId: id
    },
    include: {
      currency: true
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  const [partyWithRates] = await attachAccountCurrencyRates([{ accounts }]);

  return c.json({ data: partyWithRates.accounts });
});

partiesRoute.get("/:id/transactions", async (c) => {
  const id = c.req.param("id");
  const pagination = getPagePagination(c, { defaultLimit: 20, maxLimit: 100 });
  const where = {
    partyId: id,
    createdAt: getRecentDateRange(c)
  };

  const [transactions, total] = await Promise.all([
    prisma.partyTransaction.findMany({
    where,
    include: {
      currency: true
    },
    orderBy: {
      createdAt: "desc"
    },
    skip: pagination.skip,
    take: pagination.limit
  }),
    prisma.partyTransaction.count({ where })
  ]);

  return c.json({ data: transactions, pagination: createPaginationMeta({ ...pagination, total }) });
});

partiesRoute.post("/:id/transactions", async (c) => {
  const partyId = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = partyTransactionSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const party = await prisma.party.findUnique({
    where: {
      id: partyId
    }
  });

  if (!party) {
    return c.json({ message: "Party not found" }, 404);
  }

  const currency = await prisma.currency.findUnique({
    where: {
      id: parsed.data.currencyId
    }
  });

  if (!currency) {
    return c.json({ message: "Currency not found" }, 404);
  }

  const result = await prisma.$transaction(async (tx) => {
    const account = await tx.partyAccount.upsert({
      where: {
        partyId_currencyId: {
          partyId,
          currencyId: parsed.data.currencyId
        }
      },
      create: {
        partyId,
        currencyId: parsed.data.currencyId,
        debitBalance:
          parsed.data.side === PartyAccountSide.DEBIT ? parsed.data.amount : 0,
        creditBalance:
          parsed.data.side === PartyAccountSide.CREDIT ? parsed.data.amount : 0
      },
      update:
        parsed.data.side === PartyAccountSide.DEBIT
          ? {
              debitBalance: {
                increment: parsed.data.amount
              }
            }
          : {
              creditBalance: {
                increment: parsed.data.amount
              }
            },
      include: {
        currency: true
      }
    });

    const transaction = await tx.partyTransaction.create({
      data: {
        partyId,
        currencyId: parsed.data.currencyId,
        type: parsed.data.type,
        side: parsed.data.side,
        amount: parsed.data.amount,
        referenceType: parsed.data.referenceType ?? null,
        referenceId: parsed.data.referenceId ?? null,
        note: parsed.data.note ?? null
      },
      include: {
        currency: true
      }
    });

    return {
      account,
      transaction
    };
  });

  return c.json({ data: result }, 201);
});
