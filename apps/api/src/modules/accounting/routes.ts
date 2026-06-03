import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { zodError } from "../../lib/api";
import { getAuthUser, writeAudit } from "../../lib/auth";
import { getBaseCurrency } from "../../lib/currency-rates";
import { createPaginationMeta, getPagePagination } from "../../lib/pagination";

export const accountingRoute = new Hono();

function accountingReportRange(fromQuery?: string, toQuery?: string) {
  const now = new Date();
  const fromDate = fromQuery ? new Date(fromQuery) : new Date(now.getFullYear(), now.getMonth(), 1);
  const toDate = toQuery ? new Date(toQuery) : now;

  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    throw new Error("Invalid accounting report date range");
  }

  fromDate.setHours(0, 0, 0, 0);
  toDate.setHours(23, 59, 59, 999);

  if (fromDate > toDate) {
    throw new Error("Accounting report start date must be before end date");
  }

  return { fromDate, toDate };
}

function isInReportRange(date: Date, fromDate: Date, toDate: Date) {
  return date >= fromDate && date <= toDate;
}

async function sumJournalLines(where: any) {
  const result = await prisma.journalLine.aggregate({
    where,
    _sum: {
      baseDebit: true,
      baseCredit: true
    }
  });

  return {
    debit: Number(result._sum.baseDebit || 0),
    credit: Number(result._sum.baseCredit || 0)
  };
}

function ledgerOrderBy() {
  return [
    {
      journalEntry: {
        date: "asc" as const
      }
    },
    {
      createdAt: "asc" as const
    },
    {
      id: "asc" as const
    }
  ];
}

function beforeLedgerLine(line: { id: string; createdAt: Date; journalEntry: { date: Date } }) {
  return {
    OR: [
      {
        journalEntry: {
          date: {
            lt: line.journalEntry.date
          }
        }
      },
      {
        AND: [
          {
            journalEntry: {
              date: line.journalEntry.date
            }
          },
          {
            createdAt: {
              lt: line.createdAt
            }
          }
        ]
      },
      {
        AND: [
          {
            journalEntry: {
              date: line.journalEntry.date
            }
          },
          {
            createdAt: line.createdAt
          },
          {
            id: {
              lt: line.id
            }
          }
        ]
      }
    ]
  };
}

const accountSchema = z.object({
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  type: z.string().trim().min(1),
  currencyId: z.string().trim().optional().nullable(),
  isCash: z.boolean().optional(),
  isBank: z.boolean().optional(),
  isActive: z.boolean().optional()
});

const partySchema = z.object({
  name: z.string().trim().min(1),
  phone: z.string().trim().optional().nullable(),
  email: z.string().trim().optional().nullable(),
  address: z.string().trim().optional().nullable(),
  type: z.string().trim().default("CUSTOMER"),
  openingBalance: z.coerce.number().default(0),
  openingType: z.string().trim().default("DEBIT"),
  accountId: z.string().trim().optional().nullable(),
  isActive: z.boolean().optional()
});

const journalLineSchema = z.object({
  accountId: z.string().min(1),
  partyId: z.string().optional().nullable(),
  debit: z.coerce.number().default(0),
  credit: z.coerce.number().default(0),
  note: z.string().optional().nullable()
});

const journalEntrySchema = z.object({
  entryNo: z.string().trim().optional().nullable(),
  date: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  sourceType: z.string().optional().nullable(),
  sourceId: z.string().optional().nullable(),
  lines: z.array(journalLineSchema).min(2)
});


const postPurchaseJournalSchema = z.object({
  purchaseId: z.string().min(1),
  invoiceNo: z.string().trim().min(1),
  subtotal: z.coerce.number().default(0),
  discount: z.coerce.number().default(0),
  paidAmount: z.coerce.number().default(0),
  supplierId: z.string().optional().nullable(),
  paymentType: z.string().trim().default("CASH")
});

const postExpenseJournalSchema = z.object({
  expenseId: z.string().min(1),
  title: z.string().trim().min(1),
  amount: z.coerce.number().default(0),
  paidAmount: z.coerce.number().optional(),
  partyId: z.string().optional().nullable()
});

const postCustomerReceiptJournalSchema = z.object({
  receiptId: z.string().min(1),
  customerId: z.string().min(1),
  amount: z.coerce.number().default(0),
  note: z.string().optional().nullable()
});

const postSupplierPaymentJournalSchema = z.object({
  paymentId: z.string().min(1),
  supplierId: z.string().min(1),
  amount: z.coerce.number().default(0),
  note: z.string().optional().nullable()
});

const postSaleCogsJournalSchema = z.object({
  saleId: z.string().min(1),
  invoiceNo: z.string().trim().min(1),
  items: z.array(
    z.object({
      productId: z.string().min(1),
      warehouseId: z.string().optional().nullable(),
      lotId: z.string().optional().nullable(),
      quantity: z.coerce.number().default(0)
    })
  ).default([])
});
const postSaleJournalSchema = z.object({
  saleId: z.string().min(1),
  invoiceNo: z.string().trim().min(1),
  subtotal: z.coerce.number().default(0),
  discount: z.coerce.number().default(0),
  paidAmount: z.coerce.number().default(0),
  partyId: z.string().optional().nullable()
});

function normalizePartyType(value?: string | null) {
  const upper = String(value || "CUSTOMER").toUpperCase();

  if (upper === "SUPPLIER") return "SUPPLIER" as any;
  if (upper === "VENDOR") return "SUPPLIER" as any;
  if (upper === "CUSTOMER") return "CUSTOMER" as any;

  return "CUSTOMER" as any;
}

function makeEntryNo() {
  return `JE-${Date.now()}`;
}

function round4(value: number) {
  return Math.round(Number(value || 0) * 10000) / 10000;
}

function validateDoubleEntry(lines: Array<{ debit: number; credit: number }>) {
  const totalDebit = round4(lines.reduce((sum, line) => sum + Number(line.debit || 0), 0));
  const totalCredit = round4(lines.reduce((sum, line) => sum + Number(line.credit || 0), 0));

  if (totalDebit <= 0 && totalCredit <= 0) {
    return {
      ok: false,
      message: "Debit/Credit amount is required"
    };
  }

  if (totalDebit !== totalCredit) {
    return {
      ok: false,
      message: `Journal entry is not balanced. Debit=${totalDebit}, Credit=${totalCredit}`
    };
  }

  for (const line of lines) {
    if (Number(line.debit || 0) > 0 && Number(line.credit || 0) > 0) {
      return {
        ok: false,
        message: "A journal line cannot have both debit and credit"
      };
    }
  }

  return {
    ok: true,
    message: ""
  };
}


function quoteDbIdent(name: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid database identifier: ${name}`);
  }

  return `"${name}"`;
}

async function getTableColumns(tableName: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
    `,
    tableName
  );

  return rows.map((row) => row.column_name);
}

async function findPublicTableByRequiredColumns(requiredColumns: string[]) {
  const tables = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
    `
  );

  for (const table of tables) {
    const columns = await getTableColumns(table.table_name);
    const lowerColumns = columns.map((col) => col.toLowerCase());

    const hasAll = requiredColumns.every((required) => {
      return lowerColumns.includes(required.toLowerCase());
    });

    if (hasAll) {
      return {
        tableName: table.table_name,
        columns
      };
    }
  }

  return null;
}

function findColumn(columns: string[], candidates: string[]) {
  const lowerMap = new Map(columns.map((col) => [col.toLowerCase(), col]));

  for (const candidate of candidates) {
    const found = lowerMap.get(candidate.toLowerCase());
    if (found) return found;
  }

  return null;
}

async function calculateAverageCostForProduct(input: {
  productId: string;
  warehouseId?: string | null;
  lotId?: string | null;
}) {
  if (input.lotId) {
    const rows = await prisma.$queryRawUnsafe<Array<{ unitCost: number }>>(
      `
        SELECT COALESCE("unitCost", 0)::float AS "unitCost"
        FROM "StockLot"
        WHERE "id" = $1
        LIMIT 1
      `,
      input.lotId
    );

    const unitCost = Number(rows[0]?.unitCost || 0);

    if (unitCost > 0) {
      return {
        ok: true,
        avgCost: unitCost,
        reason: ""
      };
    }
  }

  const values: unknown[] = [input.productId];
  const whereParts = [`"productId" = $1`];

  if (input.warehouseId) {
    values.push(input.warehouseId);
    whereParts.push(`"warehouseId" = $${values.length}`);
  }

  const rows = await prisma.$queryRawUnsafe<Array<{ avgCost: number }>>(
    `
      SELECT
        COALESCE(
          SUM(COALESCE("remainingQuantity", 0) * COALESCE("unitCost", 0))
            / NULLIF(SUM(COALESCE("remainingQuantity", 0)), 0),
          SUM(COALESCE("initialQuantity", 0) * COALESCE("unitCost", 0))
            / NULLIF(SUM(COALESCE("initialQuantity", 0)), 0),
          AVG(COALESCE("unitCost", 0)),
          0
        )::float AS "avgCost"
      FROM "StockLot"
      WHERE ${whereParts.join(" AND ")}
    `,
    ...values
  );

  const avgCost = Number(rows[0]?.avgCost || 0);

  if (avgCost <= 0) {
    return {
      ok: false,
      avgCost: 0,
      reason: "StockLot.unitCost was not found or is zero"
    };
  }

  return {
    ok: true,
    avgCost,
    reason: ""
  };
}
async function calculateCogsTotal(items: Array<{
  productId: string;
  warehouseId?: string | null;
  lotId?: string | null;
  quantity: number;
}>) {
  let total = 0;
  const details: Array<{
    productId: string;
    warehouseId?: string | null;
    lotId?: string | null;
    quantity: number;
    avgCost: number;
    lineCost: number;
    skipped?: boolean;
    reason?: string;
  }> = [];

  for (const item of items) {
    const quantity = Number(item.quantity || 0);

    if (!item.productId || quantity <= 0) continue;

    const cost = await calculateAverageCostForProduct({
      productId: item.productId,
      warehouseId: item.warehouseId || null,
      lotId: item.lotId || null
    });

    if (!cost.ok || cost.avgCost <= 0) {
      details.push({
        productId: item.productId,
        warehouseId: item.warehouseId || null,
      lotId: item.lotId || null,
        quantity,
        avgCost: 0,
        lineCost: 0,
        skipped: true,
        reason: cost.reason || "Average cost is zero"
      });

      continue;
    }

    const lineCost = round4(quantity * cost.avgCost);
    total += lineCost;

    details.push({
      productId: item.productId,
      warehouseId: item.warehouseId || null,
      lotId: item.lotId || null,
      quantity,
      avgCost: cost.avgCost,
      lineCost
    });
  }

  return {
    total: round4(total),
    details
  };
}
async function getAccountByCode(code: string) {
  const account = await prisma.accountingAccount.findUnique({
    where: { code }
  });

  if (!account) {
    throw new Error(`Accounting account ${code} not found`);
  }

  return account;
}

/**
 * ACCOUNTS
 */
accountingRoute.get("/accounts", async (c) => {
  const type = c.req.query("type");
  const isCash = c.req.query("isCash");

  const accounts = await prisma.accountingAccount.findMany({
    where: {
      ...(type ? { type } : {}),
      ...(isCash === "true" ? { isCash: true } : {}),
      isActive: true
    },
    orderBy: [
      { type: "asc" },
      { code: "asc" }
    ]
  });

  return c.json({
    data: accounts
  });
});

accountingRoute.post("/accounts", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = accountSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const account = await prisma.accountingAccount.create({
    data: {
      code: parsed.data.code,
      name: parsed.data.name,
      type: parsed.data.type,
      currencyId: parsed.data.currencyId || null,
      isCash: parsed.data.isCash || false,
      isBank: parsed.data.isBank || false,
      isActive: parsed.data.isActive ?? true
    }
  });

  return c.json({ data: account }, 201);
});

accountingRoute.patch("/accounts/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const parsed = accountSchema.partial().safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const account = await prisma.accountingAccount.update({
    where: { id },
    data: {
      ...parsed.data,
      currencyId: parsed.data.currencyId === undefined ? undefined : parsed.data.currencyId || null
    }
  });

  return c.json({ data: account });
});

/**
 * PARTIES / CUSTOMERS / SUPPLIERS
 */
accountingRoute.get("/parties", async (c) => {
  const type = c.req.query("type");
  const q = c.req.query("q")?.trim();

  const parties = await prisma.party.findMany({
    where: {
      isActive: true,
      ...(type ? { type: normalizePartyType(type) } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { phone: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } }
            ]
          }
        : {})
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return c.json({
    data: parties
  });
});

accountingRoute.post("/parties", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = partySchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const party = await prisma.party.create({
    data: {
      name: parsed.data.name,
      phone: parsed.data.phone || null,
      email: parsed.data.email || null,
      address: parsed.data.address || null,
      type: normalizePartyType(parsed.data.type),
      openingBalance: parsed.data.openingBalance,
      openingType: parsed.data.openingType,
      accountId: parsed.data.accountId || null,
      isActive: parsed.data.isActive ?? true
    }
  });

  return c.json({ data: party }, 201);
});

accountingRoute.patch("/parties/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const parsed = partySchema.partial().safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const data: any = {
    ...parsed.data
  };

  if (parsed.data.type !== undefined) {
    data.type = normalizePartyType(parsed.data.type);
  }

  if (parsed.data.accountId !== undefined) {
    data.accountId = parsed.data.accountId || null;
  }

  const party = await prisma.party.update({
    where: { id },
    data
  });

  return c.json({ data: party });
});

/**
 * JOURNAL
 */
accountingRoute.get("/journal-entries", async (c) => {
  const sourceType = c.req.query("sourceType");
  const sourceId = c.req.query("sourceId");
  const page = Math.max(1, Number.parseInt(c.req.query("page") || "1", 10) || 1);
  const limit = Math.min(100, Math.max(10, Number.parseInt(c.req.query("limit") || "20", 10) || 20));
  const { fromDate, toDate } = accountingReportRange(c.req.query("from"), c.req.query("to"));
  const where = {
    date: { gte: fromDate, lte: toDate },
    ...(sourceType ? { sourceType } : {}),
    ...(sourceId ? { sourceId } : {})
  };

  const [total, entries] = await Promise.all([
    prisma.journalEntry.count({ where }),
    prisma.journalEntry.findMany({
      where,
      include: {
        lines: {
          include: {
            account: true,
            party: true
          }
        }
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit
    })
  ]);

  return c.json({
    data: entries,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit))
    }
  });
});

accountingRoute.post("/journal-entries", async (c) => {
  const authUser = getAuthUser(c);
  const body = await c.req.json().catch(() => ({}));
  const parsed = journalEntrySchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const balance = validateDoubleEntry(parsed.data.lines);

  if (!balance.ok) {
    return c.json({ message: balance.message }, 400);
  }

  const baseCurrency = await getBaseCurrency(prisma);
  const accountIds = [...new Set(parsed.data.lines.map((line) => line.accountId))];
  const accounts = await prisma.accountingAccount.findMany({
    where: { id: { in: accountIds }, isActive: true }
  });

  if (accounts.length !== accountIds.length) {
    return c.json({ message: "یکی از حساب‌های ژورنال یافت نشد یا غیرفعال است" }, 400);
  }

  if (accounts.some((account) => account.currencyId && account.currencyId !== baseCurrency?.id)) {
    return c.json(
      { message: "سند دستی فقط با حساب‌های کرنسی پایه قابل ثبت است" },
      400
    );
  }

  const entry = await prisma.journalEntry.create({
    data: {
      entryNo: parsed.data.entryNo || makeEntryNo(),
      date: parsed.data.date ? new Date(parsed.data.date) : new Date(),
      description: parsed.data.description || null,
      sourceType: parsed.data.sourceType || null,
      sourceId: parsed.data.sourceId || null,
      createdByUserId: authUser?.id || null,
      lines: {
        create: parsed.data.lines.map((line) => ({
          accountId: line.accountId,
          partyId: line.partyId || null,
          debit: line.debit,
          credit: line.credit,
          exchangeRate: 1,
          baseCurrencyId: baseCurrency?.id || null,
          baseDebit: line.debit,
          baseCredit: line.credit,
          note: line.note || null
        }))
      }
    },
    include: {
      lines: {
        include: {
          account: true,
          party: true
        }
      }
    }
  });

  await writeAudit(c, {
    action: "JOURNAL_ENTRY_CREATED",
    entityType: "JournalEntry",
    entityId: entry.id,
    metadata: {
      entryNo: entry.entryNo,
      sourceType: entry.sourceType
    }
  });

  return c.json({ data: entry }, 201);
});

/**
 * POST SALE JOURNAL
 */
accountingRoute.post("/post-sale", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = postSaleJournalSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const existing = await prisma.journalEntry.findFirst({
    where: {
      sourceType: "POS_SALE",
      sourceId: parsed.data.saleId
    },
    include: {
      lines: {
        include: {
          account: true,
          party: true
        }
      }
    }
  });

  if (existing) {
    return c.json({
      data: existing,
      message: "Journal already exists for this sale"
    });
  }

  const subtotal = round4(parsed.data.subtotal);
  const discount = round4(parsed.data.discount);
  const payableTotal = round4(Math.max(0, subtotal - discount));

  if (subtotal <= 0) {
    return c.json({ message: "Subtotal must be greater than zero" }, 400);
  }

  const cashAccount = await getAccountByCode("1000");
  const salesAccount = await getAccountByCode("4000");
  const salesDiscountAccount = await getAccountByCode("4100");

  const lines: Array<{
    accountId: string;
    partyId?: string | null;
    debit: number;
    credit: number;
    note?: string | null;
  }> = [
    {
      accountId: cashAccount.id,
      partyId: parsed.data.partyId || null,
      debit: payableTotal,
      credit: 0,
      note: "Cash received from POS sale"
    },
    {
      accountId: salesAccount.id,
      partyId: parsed.data.partyId || null,
      debit: 0,
      credit: subtotal,
      note: "POS sales revenue"
    }
  ];

  if (discount > 0) {
    lines.push({
      accountId: salesDiscountAccount.id,
      partyId: parsed.data.partyId || null,
      debit: discount,
      credit: 0,
      note: "POS sales discount"
    });
  }

  const balance = validateDoubleEntry(lines);

  if (!balance.ok) {
    return c.json({ message: balance.message }, 400);
  }

  const baseCurrencyId = (await getBaseCurrency(prisma))?.id || null;
  const entry = await prisma.journalEntry.create({
    data: {
      entryNo: `JE-POS-${Date.now()}`,
      date: new Date(),
      description: `POS Sale ${parsed.data.invoiceNo}`,
      sourceType: "POS_SALE",
      sourceId: parsed.data.saleId,
      lines: {
        create: lines.map((line) => ({
          accountId: line.accountId,
          partyId: line.partyId || null,
          debit: line.debit,
          credit: line.credit,
          exchangeRate: 1,
          baseCurrencyId,
          baseDebit: line.debit,
          baseCredit: line.credit,
          note: line.note || null
        }))
      }
    },
    include: {
      lines: {
        include: {
          account: true,
          party: true
        }
      }
    }
  });

  return c.json({
    data: entry
  }, 201);
});

/**
 * BALANCES
 */
accountingRoute.get("/balances", async (c) => {
  const accounts = await prisma.accountingAccount.findMany({
    where: {
      isActive: true
    },
    include: {
      journalLines: true
    },
    orderBy: [
      { type: "asc" },
      { code: "asc" }
    ]
  });

  const data = accounts.map((account) => {
    const debit = account.journalLines.reduce((sum, line) => {
      return sum + Number(line.baseDebit || line.debit || 0);
    }, 0);

    const credit = account.journalLines.reduce((sum, line) => {
      return sum + Number(line.baseCredit || line.credit || 0);
    }, 0);

    return {
      id: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
      currencyId: account.currencyId,
      debit,
      credit,
      balance: debit - credit
    };
  });

  return c.json({
    data
  });
});

accountingRoute.get("/party-balances", async (c) => {
  const type = c.req.query("type");

  const parties = await prisma.party.findMany({
    where: {
      isActive: true,
      ...(type ? { type: normalizePartyType(type) } : {})
    },
    orderBy: {
      name: "asc"
    }
  });

  const partyIds = parties.map((party) => party.id);

  const journalLines = await prisma.journalLine.findMany({
    where: {
      partyId: {
        in: partyIds
      }
    }
  });

  const data = parties.map((party) => {
    const lines = journalLines.filter((line) => line.partyId === party.id);

    const debit = lines.reduce((sum, line) => {
      return sum + Number(line.baseDebit || line.debit || 0);
    }, Number(party.openingType === "DEBIT" ? party.openingBalance : 0));

    const credit = lines.reduce((sum, line) => {
      return sum + Number(line.baseCredit || line.credit || 0);
    }, Number(party.openingType === "CREDIT" ? party.openingBalance : 0));

    return {
      id: party.id,
      name: party.name,
      phone: party.phone,
      type: party.type,
      debit,
      credit,
      balance: debit - credit
    };
  });

  return c.json({
    data
  });
});

/**
 * POST PURCHASE JOURNAL
 * Cash purchase:
 *   Debit  Inventory
 *   Credit Cash
 *
 * Credit purchase:
 *   Debit  Inventory
 *   Credit Cash for paid amount
 *   Credit Accounts Payable for remaining amount
 */
accountingRoute.post("/post-purchase", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = postPurchaseJournalSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const existing = await prisma.journalEntry.findFirst({
    where: {
      sourceType: "PURCHASE",
      sourceId: parsed.data.purchaseId
    },
    include: {
      lines: {
        include: {
          account: true,
          party: true
        }
      }
    }
  });

  if (existing) {
    return c.json({
      data: existing,
      message: "Journal already exists for this purchase"
    });
  }

  const subtotal = round4(parsed.data.subtotal);
  const discount = round4(parsed.data.discount);
  const netTotal = round4(Math.max(0, subtotal - discount));
  const paidAmount = round4(Math.max(0, parsed.data.paidAmount));
  const payableAmount = round4(Math.max(0, netTotal - paidAmount));

  if (netTotal <= 0) {
    return c.json({ message: "Purchase total must be greater than zero" }, 400);
  }

  const inventoryAccount = await getAccountByCode("1300");
  const cashAccount = await getAccountByCode("1000");
  const payableAccount = await getAccountByCode("2000");

  const lines: Array<{
    accountId: string;
    partyId?: string | null;
    debit: number;
    credit: number;
    note?: string | null;
  }> = [
    {
      accountId: inventoryAccount.id,
      partyId: parsed.data.supplierId || null,
      debit: netTotal,
      credit: 0,
      note: "Inventory purchased"
    }
  ];

  if (paidAmount > 0) {
    lines.push({
      accountId: cashAccount.id,
      partyId: parsed.data.supplierId || null,
      debit: 0,
      credit: paidAmount,
      note: "Cash paid for purchase"
    });
  }

  if (payableAmount > 0) {
    lines.push({
      accountId: payableAccount.id,
      partyId: parsed.data.supplierId || null,
      debit: 0,
      credit: payableAmount,
      note: "Purchase payable to supplier"
    });
  }

  const balance = validateDoubleEntry(lines);

  if (!balance.ok) {
    return c.json({ message: balance.message }, 400);
  }

  const baseCurrencyId = (await getBaseCurrency(prisma))?.id || null;
  const entry = await prisma.journalEntry.create({
    data: {
      entryNo: `JE-PUR-${Date.now()}`,
      date: new Date(),
      description: `Purchase ${parsed.data.invoiceNo}`,
      sourceType: "PURCHASE",
      sourceId: parsed.data.purchaseId,
      lines: {
        create: lines.map((line) => ({
          accountId: line.accountId,
          partyId: line.partyId || null,
          debit: line.debit,
          credit: line.credit,
          exchangeRate: 1,
          baseCurrencyId,
          baseDebit: line.debit,
          baseCredit: line.credit,
          note: line.note || null
        }))
      }
    },
    include: {
      lines: {
        include: {
          account: true,
          party: true
        }
      }
    }
  });

  return c.json({ data: entry }, 201);
});

/**
 * POST EXPENSE JOURNAL
 * Debit  General Expenses
 * Credit Cash
 */
accountingRoute.post("/post-expense", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = postExpenseJournalSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const existing = await prisma.journalEntry.findFirst({
    where: {
      sourceType: "EXPENSE",
      sourceId: parsed.data.expenseId
    },
    include: {
      lines: {
        include: {
          account: true,
          party: true
        }
      }
    }
  });

  if (existing) {
    return c.json({
      data: existing,
      message: "Journal already exists for this expense"
    });
  }

  const amount = round4(parsed.data.amount);

  if (amount <= 0) {
    return c.json({ message: "Expense amount must be greater than zero" }, 400);
  }

  const expenseAccount = await getAccountByCode("6000");
  const cashAccount = await getAccountByCode("1000");

  const lines = [
    {
      accountId: expenseAccount.id,
      partyId: parsed.data.partyId || null,
      debit: amount,
      credit: 0,
      note: parsed.data.title
    },
    {
      accountId: cashAccount.id,
      partyId: parsed.data.partyId || null,
      debit: 0,
      credit: amount,
      note: "Cash paid for expense"
    }
  ];

  const balance = validateDoubleEntry(lines);

  if (!balance.ok) {
    return c.json({ message: balance.message }, 400);
  }

  const baseCurrencyId = (await getBaseCurrency(prisma))?.id || null;
  const entry = await prisma.journalEntry.create({
    data: {
      entryNo: `JE-EXP-${Date.now()}`,
      date: new Date(),
      description: `Expense: ${parsed.data.title}`,
      sourceType: "EXPENSE",
      sourceId: parsed.data.expenseId,
      lines: {
        create: lines.map((line) => ({
          accountId: line.accountId,
          partyId: line.partyId || null,
          debit: line.debit,
          credit: line.credit,
          exchangeRate: 1,
          baseCurrencyId,
          baseDebit: line.debit,
          baseCredit: line.credit,
          note: line.note || null
        }))
      }
    },
    include: {
      lines: {
        include: {
          account: true,
          party: true
        }
      }
    }
  });

  return c.json({ data: entry }, 201);
});

/**
 * CUSTOMER RECEIPT
 * Debit  Cash
 * Credit Accounts Receivable
 */
accountingRoute.post("/post-customer-receipt", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = postCustomerReceiptJournalSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const existing = await prisma.journalEntry.findFirst({
    where: {
      sourceType: "CUSTOMER_RECEIPT",
      sourceId: parsed.data.receiptId
    },
    include: {
      lines: {
        include: {
          account: true,
          party: true
        }
      }
    }
  });

  if (existing) {
    return c.json({
      data: existing,
      message: "Journal already exists for this receipt"
    });
  }

  const amount = round4(parsed.data.amount);

  if (amount <= 0) {
    return c.json({ message: "Receipt amount must be greater than zero" }, 400);
  }

  const cashAccount = await getAccountByCode("1000");
  const receivableAccount = await getAccountByCode("1200");

  const lines = [
    {
      accountId: cashAccount.id,
      partyId: parsed.data.customerId,
      debit: amount,
      credit: 0,
      note: parsed.data.note || "Cash received from customer"
    },
    {
      accountId: receivableAccount.id,
      partyId: parsed.data.customerId,
      debit: 0,
      credit: amount,
      note: "Customer receivable reduced"
    }
  ];

  const balance = validateDoubleEntry(lines);

  if (!balance.ok) {
    return c.json({ message: balance.message }, 400);
  }

  const baseCurrencyId = (await getBaseCurrency(prisma))?.id || null;
  const entry = await prisma.journalEntry.create({
    data: {
      entryNo: `JE-REC-${Date.now()}`,
      date: new Date(),
      description: "Customer receipt",
      sourceType: "CUSTOMER_RECEIPT",
      sourceId: parsed.data.receiptId,
      lines: {
        create: lines.map((line) => ({
          accountId: line.accountId,
          partyId: line.partyId,
          debit: line.debit,
          credit: line.credit,
          exchangeRate: 1,
          baseCurrencyId,
          baseDebit: line.debit,
          baseCredit: line.credit,
          note: line.note || null
        }))
      }
    },
    include: {
      lines: {
        include: {
          account: true,
          party: true
        }
      }
    }
  });

  return c.json({ data: entry }, 201);
});

/**
 * SUPPLIER PAYMENT
 * Debit  Accounts Payable
 * Credit Cash
 */
accountingRoute.post("/post-supplier-payment", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = postSupplierPaymentJournalSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const existing = await prisma.journalEntry.findFirst({
    where: {
      sourceType: "SUPPLIER_PAYMENT",
      sourceId: parsed.data.paymentId
    },
    include: {
      lines: {
        include: {
          account: true,
          party: true
        }
      }
    }
  });

  if (existing) {
    return c.json({
      data: existing,
      message: "Journal already exists for this supplier payment"
    });
  }

  const amount = round4(parsed.data.amount);

  if (amount <= 0) {
    return c.json({ message: "Payment amount must be greater than zero" }, 400);
  }

  const payableAccount = await getAccountByCode("2000");
  const cashAccount = await getAccountByCode("1000");

  const lines = [
    {
      accountId: payableAccount.id,
      partyId: parsed.data.supplierId,
      debit: amount,
      credit: 0,
      note: parsed.data.note || "Supplier payable reduced"
    },
    {
      accountId: cashAccount.id,
      partyId: parsed.data.supplierId,
      debit: 0,
      credit: amount,
      note: "Cash paid to supplier"
    }
  ];

  const balance = validateDoubleEntry(lines);

  if (!balance.ok) {
    return c.json({ message: balance.message }, 400);
  }

  const baseCurrencyId = (await getBaseCurrency(prisma))?.id || null;
  const entry = await prisma.journalEntry.create({
    data: {
      entryNo: `JE-PAY-${Date.now()}`,
      date: new Date(),
      description: "Supplier payment",
      sourceType: "SUPPLIER_PAYMENT",
      sourceId: parsed.data.paymentId,
      lines: {
        create: lines.map((line) => ({
          accountId: line.accountId,
          partyId: line.partyId,
          debit: line.debit,
          credit: line.credit,
          exchangeRate: 1,
          baseCurrencyId,
          baseDebit: line.debit,
          baseCredit: line.credit,
          note: line.note || null
        }))
      }
    },
    include: {
      lines: {
        include: {
          account: true,
          party: true
        }
      }
    }
  });

  return c.json({ data: entry }, 201);
});

/**
 * REPORTS: DASHBOARD SUMMARY
 */
accountingRoute.get("/dashboard-summary", async (c) => {
  const { fromDate, toDate } = accountingReportRange(c.req.query("from"), c.req.query("to"));
  const accounts = await prisma.accountingAccount.findMany({
    where: {
      isActive: true
    },
    include: {
      journalLines: {
        include: {
          journalEntry: {
            select: {
              date: true
            }
          }
        }
      }
    }
  });

  function balanceByCode(code: string) {
    const account = accounts.find((item) => item.code === code);

    if (!account) {
      return 0;
    }

    const debit = account.journalLines.reduce((sum, line) => {
      return sum + Number(line.baseDebit || line.debit || 0);
    }, 0);

    const credit = account.journalLines.reduce((sum, line) => {
      return sum + Number(line.baseCredit || line.credit || 0);
    }, 0);

    return debit - credit;
  }

  function debitByCode(code: string, periodOnly = false) {
    const account = accounts.find((item) => item.code === code);

    if (!account) {
      return 0;
    }

    return account.journalLines.filter((line) => !periodOnly || isInReportRange(line.journalEntry.date, fromDate, toDate)).reduce((sum, line) => {
      return sum + Number(line.baseDebit || line.debit || 0);
    }, 0);
  }

  function creditByCode(code: string, periodOnly = false) {
    const account = accounts.find((item) => item.code === code);

    if (!account) {
      return 0;
    }

    return account.journalLines.filter((line) => !periodOnly || isInReportRange(line.journalEntry.date, fromDate, toDate)).reduce((sum, line) => {
      return sum + Number(line.baseCredit || line.credit || 0);
    }, 0);
  }

  const cash = balanceByCode("1000");
  const bank = balanceByCode("1100");
  const receivable = balanceByCode("1200");
  const inventory = balanceByCode("1300");
  const payable = balanceByCode("2000");

  const periodBalanceByCode = (code: string) => debitByCode(code, true) - creditByCode(code, true);
  const salesRevenue = Math.abs(periodBalanceByCode("4000"));
  const otherIncome = Math.abs(periodBalanceByCode("7000"));
  const salesDiscount = periodBalanceByCode("4100");
  const cogs = periodBalanceByCode("5000");
  const expenses = periodBalanceByCode("6000");

  const totalExpenses = salesDiscount + cogs + expenses;
  const grossProfit = salesRevenue - cogs - salesDiscount;
  const netProfit = salesRevenue + otherIncome - totalExpenses;

  const cashIn = debitByCode("1000", true);
  const cashOut = creditByCode("1000", true);

  return c.json({
    data: {
      period: {
        from: fromDate.toISOString(),
        to: toDate.toISOString()
      },
      assets: {
        cash,
        bank,
        receivable,
        inventory,
        totalAssets: cash + bank + receivable + inventory
      },
      liabilities: {
        payable,
        totalLiabilities: Math.abs(payable)
      },
      income: {
        salesRevenue,
        otherIncome,
        salesDiscount,
        netSales: salesRevenue + otherIncome - salesDiscount
      },
      expenses: {
        cogs,
        generalExpenses: expenses,
        totalExpenses
      },
      profit: {
        grossProfit,
        netProfit
      },
      cashFlow: {
        cashIn,
        cashOut,
        netCashFlow: cashIn - cashOut
      }
    }
  });
});

/**
 * REPORTS: TRIAL BALANCE
 */
accountingRoute.get("/trial-balance", async (c) => {
  const accounts = await prisma.accountingAccount.findMany({
    where: {
      isActive: true
    },
    include: {
      journalLines: true
    },
    orderBy: [
      { type: "asc" },
      { code: "asc" }
    ]
  });

  const rows = accounts.map((account) => {
    const debit = account.journalLines.reduce((sum, line) => {
      return sum + Number(line.baseDebit || line.debit || 0);
    }, 0);

    const credit = account.journalLines.reduce((sum, line) => {
      return sum + Number(line.baseCredit || line.credit || 0);
    }, 0);

    return {
      id: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
      debit,
      credit,
      balance: debit - credit
    };
  });

  const totalDebit = rows.reduce((sum, row) => sum + row.debit, 0);
  const totalCredit = rows.reduce((sum, row) => sum + row.credit, 0);

  return c.json({
    data: {
      rows,
      totalDebit,
      totalCredit,
      difference: totalDebit - totalCredit,
      isBalanced: Math.round((totalDebit - totalCredit) * 10000) / 10000 === 0
    }
  });
});

/**
 * REPORTS: ACCOUNT DEBIT/CREDIT PERIOD SUMMARY
 */
accountingRoute.get("/account-period-balances", async (c) => {
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
  const fromQuery = c.req.query("from");
  const toQuery = c.req.query("to");
  const fromDate = fromQuery ? new Date(fromQuery) : defaultFrom;
  const toDate = toQuery ? new Date(toQuery) : now;

  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return c.json({ message: "Invalid date range" }, 400);
  }

  fromDate.setHours(0, 0, 0, 0);
  toDate.setHours(23, 59, 59, 999);

  if (fromDate > toDate) {
    return c.json({ message: "From date must be before to date" }, 400);
  }

  const accounts = await prisma.accountingAccount.findMany({
    where: {
      isActive: true
    },
    include: {
      journalLines: {
        where: {
          journalEntry: {
            date: {
              lte: toDate
            }
          }
        },
        include: {
          journalEntry: true,
          party: true
        }
      }
    },
    orderBy: [
      { type: "asc" },
      { code: "asc" }
    ]
  });

  const rows = accounts.map((account) => {
    let openingDebit = 0;
    let openingCredit = 0;
    let periodDebit = 0;
    let periodCredit = 0;

    for (const line of account.journalLines) {
      const lineDate = line.journalEntry.date;
      const debit = Number(line.baseDebit || line.debit || 0);
      const credit = Number(line.baseCredit || line.credit || 0);

      if (lineDate < fromDate) {
        openingDebit += debit;
        openingCredit += credit;
      } else if (lineDate <= toDate) {
        periodDebit += debit;
        periodCredit += credit;
      }
    }

    const openingBalance = openingDebit - openingCredit;
    const periodBalance = periodDebit - periodCredit;
    const closingBalance = openingBalance + periodBalance;

    return {
      id: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
      isCash: account.isCash,
      isBank: account.isBank,
      openingDebit,
      openingCredit,
      openingBalance,
      debit: periodDebit,
      credit: periodCredit,
      periodBalance,
      closingBalance,
      lineCount: account.journalLines.filter((line) => {
        const lineDate = line.journalEntry.date;
        return lineDate >= fromDate && lineDate <= toDate;
      }).length
    };
  });

  const totals = rows.reduce(
    (sum, row) => ({
      openingDebit: sum.openingDebit + row.openingDebit,
      openingCredit: sum.openingCredit + row.openingCredit,
      openingBalance: sum.openingBalance + row.openingBalance,
      debit: sum.debit + row.debit,
      credit: sum.credit + row.credit,
      periodBalance: sum.periodBalance + row.periodBalance,
      closingBalance: sum.closingBalance + row.closingBalance,
      lineCount: sum.lineCount + row.lineCount
    }),
    {
      openingDebit: 0,
      openingCredit: 0,
      openingBalance: 0,
      debit: 0,
      credit: 0,
      periodBalance: 0,
      closingBalance: 0,
      lineCount: 0
    }
  );

  return c.json({
    data: {
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      totals,
      rows,
      isBalanced:
        Math.round((totals.openingBalance + totals.periodBalance - totals.closingBalance) * 10000) /
          10000 ===
        0
    }
  });
});

/**
 * REPORTS: PROFIT AND LOSS
 */
accountingRoute.get("/profit-loss", async (c) => {
  const { fromDate, toDate } = accountingReportRange(c.req.query("from"), c.req.query("to"));
  const accounts = await prisma.accountingAccount.findMany({
    where: {
      isActive: true
    },
    include: {
      journalLines: {
        where: {
          journalEntry: {
            date: {
              gte: fromDate,
              lte: toDate
            }
          }
        }
      }
    }
  });

  function accountBalance(code: string) {
    const account = accounts.find((item) => item.code === code);

    if (!account) {
      return 0;
    }

    const debit = account.journalLines.reduce((sum, line) => {
      return sum + Number(line.baseDebit || line.debit || 0);
    }, 0);

    const credit = account.journalLines.reduce((sum, line) => {
      return sum + Number(line.baseCredit || line.credit || 0);
    }, 0);

    return debit - credit;
  }

  const salesRevenue = Math.abs(accountBalance("4000"));
  const otherIncome = Math.abs(accountBalance("7000"));
  const salesDiscount = accountBalance("4100");
  const netSales = salesRevenue + otherIncome - salesDiscount;
  const cogs = accountBalance("5000");
  const grossProfit = netSales - cogs;
  const generalExpenses = accountBalance("6000");
  const netProfit = grossProfit - generalExpenses;

  return c.json({
    data: {
      period: {
        from: fromDate.toISOString(),
        to: toDate.toISOString()
      },
      salesRevenue,
      otherIncome,
      salesDiscount,
      netSales,
      cogs,
      grossProfit,
      generalExpenses,
      netProfit
    }
  });
});

/**
 * REPORTS: RECEIVABLES AND PAYABLES
 */
accountingRoute.get("/receivables-payables", async (c) => {
  const parties = await prisma.party.findMany({
    where: {
      isActive: true
    },
    orderBy: {
      name: "asc"
    }
  });

  const partyIds = parties.map((party) => party.id);

  const journalLines = await prisma.journalLine.findMany({
    where: {
      partyId: {
        in: partyIds
      }
    }
  });

  const rows = parties.map((party) => {
    const lines = journalLines.filter((line) => line.partyId === party.id);

    const debit = lines.reduce((sum, line) => {
      return sum + Number(line.baseDebit || line.debit || 0);
    }, Number(party.openingType === "DEBIT" ? party.openingBalance : 0));

    const credit = lines.reduce((sum, line) => {
      return sum + Number(line.baseCredit || line.credit || 0);
    }, Number(party.openingType === "CREDIT" ? party.openingBalance : 0));

    return {
      id: party.id,
      name: party.name,
      phone: party.phone,
      type: party.type,
      debit,
      credit,
      balance: debit - credit
    };
  });

  const receivables = rows.filter((item) => item.type === "CUSTOMER");
  const payables = rows.filter((item) => item.type === "SUPPLIER");

  return c.json({
    data: {
      receivables,
      payables,
      totalReceivable: receivables.reduce((sum, item) => sum + Number(item.balance || 0), 0),
      totalPayable: payables.reduce((sum, item) => sum + Math.abs(Number(item.balance || 0)), 0)
    }
  });
});

/**
 * LEDGER: PERIOD TRANSACTION LINES
 */
accountingRoute.get("/account-period-ledger", async (c) => {
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
  const fromQuery = c.req.query("from");
  const toQuery = c.req.query("to");
  const accountId = c.req.query("accountId");
  const pagination = getPagePagination(c, { defaultLimit: 50, maxLimit: 250 });
  const fromDate = fromQuery ? new Date(fromQuery) : defaultFrom;
  const toDate = toQuery ? new Date(toQuery) : now;

  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return c.json({ message: "Invalid date range" }, 400);
  }

  fromDate.setHours(0, 0, 0, 0);
  toDate.setHours(23, 59, 59, 999);

  if (fromDate > toDate) {
    return c.json({ message: "From date must be before to date" }, 400);
  }

  const account = accountId
    ? await prisma.accountingAccount.findUnique({ where: { id: accountId } })
    : null;

  if (accountId && !account) {
    return c.json({ message: "Account not found" }, 404);
  }

  const accountFilter = accountId ? { accountId } : {};

  const periodWhere = {
    ...accountFilter,
    journalEntry: {
      date: {
        gte: fromDate,
        lte: toDate
      }
    }
  };
  const [openingSums, periodSums, lineCount, periodLines] = await Promise.all([
    sumJournalLines({
      ...accountFilter,
      journalEntry: {
        date: {
          lt: fromDate
        }
      }
    }),
    sumJournalLines(periodWhere),
    prisma.journalLine.count({ where: periodWhere }),
    prisma.journalLine.findMany({
      where: periodWhere,
      include: {
        account: true,
        party: true,
        journalEntry: true
      },
      orderBy: ledgerOrderBy(),
      skip: pagination.skip,
      take: pagination.limit
    })
  ]);

  const openingDebit = openingSums.debit;
  const openingCredit = openingSums.credit;
  const totalDebit = periodSums.debit;
  const totalCredit = periodSums.credit;
  const openingBalance = openingDebit - openingCredit;
  const closingBalance = openingBalance + totalDebit - totalCredit;
  const prefixSums =
    accountId && periodLines[0] && pagination.skip > 0
      ? await sumJournalLines({
          ...periodWhere,
          ...beforeLedgerLine(periodLines[0])
        })
      : { debit: 0, credit: 0 };
  let runningBalance = openingBalance + prefixSums.debit - prefixSums.credit;

  const rows = periodLines.map((line) => {
    const debit = Number(line.baseDebit || line.debit || 0);
    const credit = Number(line.baseCredit || line.credit || 0);
    runningBalance += debit - credit;

    return {
      id: line.id,
      date: line.journalEntry.date,
      entryNo: line.journalEntry.entryNo,
      description: line.journalEntry.description,
      sourceType: line.journalEntry.sourceType,
      sourceId: line.journalEntry.sourceId,
      account: {
        id: line.account.id,
        code: line.account.code,
        name: line.account.name,
        type: line.account.type
      },
      party: line.party
        ? {
            id: line.party.id,
            name: line.party.name,
            phone: line.party.phone,
            type: line.party.type
          }
        : null,
      debit,
      credit,
      balance: accountId ? runningBalance : null,
      note: line.note
    };
  });

  return c.json({
    data: {
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      account,
      totals: {
        openingDebit,
        openingCredit,
        openingBalance,
        totalDebit,
        totalCredit,
        closingBalance,
        lineCount
      },
      rows,
      pagination: createPaginationMeta({
        page: pagination.page,
        limit: pagination.limit,
        total: lineCount
      })
    }
  });
});

/**
 * LEDGER: PARTY PERIOD STATEMENT
 */
accountingRoute.get("/party-period-ledger", async (c) => {
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
  const fromQuery = c.req.query("from");
  const toQuery = c.req.query("to");
  const partyId = c.req.query("partyId");
  const pagination = getPagePagination(c, { defaultLimit: 50, maxLimit: 250 });
  const fromDate = fromQuery ? new Date(fromQuery) : defaultFrom;
  const toDate = toQuery ? new Date(toQuery) : now;

  if (!partyId) {
    return c.json({ message: "Party is required" }, 400);
  }

  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return c.json({ message: "Invalid date range" }, 400);
  }

  fromDate.setHours(0, 0, 0, 0);
  toDate.setHours(23, 59, 59, 999);

  if (fromDate > toDate) {
    return c.json({ message: "From date must be before to date" }, 400);
  }

  const party = await prisma.party.findUnique({ where: { id: partyId } });

  if (!party) {
    return c.json({ message: "Party not found" }, 404);
  }

  const periodWhere = {
    partyId,
    journalEntry: {
      date: {
        gte: fromDate,
        lte: toDate
      }
    }
  };
  const [openingSums, periodSums, lineCount, periodLines] = await Promise.all([
    sumJournalLines({
      partyId,
      journalEntry: {
        date: {
          lt: fromDate
        }
      }
    }),
    sumJournalLines(periodWhere),
    prisma.journalLine.count({ where: periodWhere }),
    prisma.journalLine.findMany({
      where: periodWhere,
      include: {
        account: true,
        party: true,
        journalEntry: true
      },
      orderBy: ledgerOrderBy(),
      skip: pagination.skip,
      take: pagination.limit
    })
  ]);

  const initialDebit =
    party.openingType === "DEBIT" ? Number(party.openingBalance || 0) : 0;
  const initialCredit =
    party.openingType === "CREDIT" ? Number(party.openingBalance || 0) : 0;
  const openingDebit =
    initialDebit +
    openingSums.debit;
  const openingCredit =
    initialCredit +
    openingSums.credit;
  const totalDebit = periodSums.debit;
  const totalCredit = periodSums.credit;
  const openingBalance = openingDebit - openingCredit;
  const closingBalance = openingBalance + totalDebit - totalCredit;
  const prefixSums =
    periodLines[0] && pagination.skip > 0
      ? await sumJournalLines({
          ...periodWhere,
          ...beforeLedgerLine(periodLines[0])
        })
      : { debit: 0, credit: 0 };
  let runningBalance = openingBalance + prefixSums.debit - prefixSums.credit;

  const rows = periodLines.map((line) => {
    const debit = Number(line.baseDebit || line.debit || 0);
    const credit = Number(line.baseCredit || line.credit || 0);
    runningBalance += debit - credit;

    return {
      id: line.id,
      date: line.journalEntry.date,
      entryNo: line.journalEntry.entryNo,
      description: line.journalEntry.description,
      sourceType: line.journalEntry.sourceType,
      sourceId: line.journalEntry.sourceId,
      account: {
        id: line.account.id,
        code: line.account.code,
        name: line.account.name,
        type: line.account.type
      },
      party: {
        id: party.id,
        name: party.name,
        phone: party.phone,
        type: party.type
      },
      debit,
      credit,
      balance: runningBalance,
      note: line.note
    };
  });

  return c.json({
    data: {
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      party: {
        id: party.id,
        name: party.name,
        phone: party.phone,
        type: party.type,
        code: party.code,
        companyName: party.companyName
      },
      totals: {
        openingDebit,
        openingCredit,
        openingBalance,
        totalDebit,
        totalCredit,
        closingBalance,
        lineCount
      },
      rows,
      pagination: createPaginationMeta({
        page: pagination.page,
        limit: pagination.limit,
        total: lineCount
      })
    }
  });
});

/**
 * LEDGER: ACCOUNT LEDGER
 */
accountingRoute.get("/account-ledger/:accountId", async (c) => {
  const accountId = c.req.param("accountId");

  const account = await prisma.accountingAccount.findUnique({
    where: {
      id: accountId
    }
  });

  if (!account) {
    return c.json({ message: "Account not found" }, 404);
  }

  const lines = await prisma.journalLine.findMany({
    where: {
      accountId
    },
    include: {
      journalEntry: true,
      party: true
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  let runningBalance = 0;

  const rows = lines.map((line) => {
    const debit = Number(line.baseDebit || line.debit || 0);
    const credit = Number(line.baseCredit || line.credit || 0);

    runningBalance += debit - credit;

    return {
      id: line.id,
      date: line.journalEntry.date,
      entryNo: line.journalEntry.entryNo,
      description: line.journalEntry.description,
      sourceType: line.journalEntry.sourceType,
      sourceId: line.journalEntry.sourceId,
      party: line.party
        ? {
            id: line.party.id,
            name: line.party.name,
            phone: line.party.phone,
            type: line.party.type
          }
        : null,
      debit,
      credit,
      balance: runningBalance,
      note: line.note
    };
  });

  const totalDebit = rows.reduce((sum, row) => sum + row.debit, 0);
  const totalCredit = rows.reduce((sum, row) => sum + row.credit, 0);

  return c.json({
    data: {
      account,
      rows,
      totalDebit,
      totalCredit,
      balance: totalDebit - totalCredit
    }
  });
});

/**
 * LEDGER: PARTY STATEMENT
 */
accountingRoute.get("/party-ledger/:partyId", async (c) => {
  const partyId = c.req.param("partyId");

  const party = await prisma.party.findUnique({
    where: {
      id: partyId
    }
  });

  if (!party) {
    return c.json({ message: "Party not found" }, 404);
  }

  const lines = await prisma.journalLine.findMany({
    where: {
      partyId
    },
    include: {
      journalEntry: true,
      account: true
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  let runningBalance =
    party.openingType === "DEBIT"
      ? Number(party.openingBalance || 0)
      : -Number(party.openingBalance || 0);

  const openingRow = Number(party.openingBalance || 0) > 0
    ? [
        {
          id: "opening-balance",
          date: party.createdAt,
          entryNo: "OPENING",
          description: "مانده اول دوره",
          sourceType: "OPENING",
          sourceId: party.id,
          account: null,
          debit: party.openingType === "DEBIT" ? Number(party.openingBalance || 0) : 0,
          credit: party.openingType === "CREDIT" ? Number(party.openingBalance || 0) : 0,
          balance: runningBalance,
          note: "Opening balance"
        }
      ]
    : [];

  const rows = lines.map((line) => {
    const debit = Number(line.baseDebit || line.debit || 0);
    const credit = Number(line.baseCredit || line.credit || 0);

    runningBalance += debit - credit;

    return {
      id: line.id,
      date: line.journalEntry.date,
      entryNo: line.journalEntry.entryNo,
      description: line.journalEntry.description,
      sourceType: line.journalEntry.sourceType,
      sourceId: line.journalEntry.sourceId,
      account: line.account
        ? {
            id: line.account.id,
            code: line.account.code,
            name: line.account.name,
            type: line.account.type
          }
        : null,
      debit,
      credit,
      balance: runningBalance,
      note: line.note
    };
  });

  const allRows = [...openingRow, ...rows];

  const totalDebit = allRows.reduce((sum, row) => sum + row.debit, 0);
  const totalCredit = allRows.reduce((sum, row) => sum + row.credit, 0);

  return c.json({
    data: {
      party,
      rows: allRows,
      totalDebit,
      totalCredit,
      balance: totalDebit - totalCredit
    }
  });
});

/**
 * LEDGER: JOURNAL ENTRY DETAIL
 */
accountingRoute.get("/journal-entries/:id", async (c) => {
  const id = c.req.param("id");

  const entry = await prisma.journalEntry.findUnique({
    where: {
      id
    },
    include: {
      lines: {
        include: {
          account: true,
          party: true
        }
      }
    }
  });

  if (!entry) {
    return c.json({ message: "Journal entry not found" }, 404);
  }

  const totalDebit = entry.lines.reduce((sum, line) => {
    return sum + Number(line.baseDebit || line.debit || 0);
  }, 0);

  const totalCredit = entry.lines.reduce((sum, line) => {
    return sum + Number(line.baseCredit || line.credit || 0);
  }, 0);

  return c.json({
    data: {
      ...entry,
      totalDebit,
      totalCredit,
      difference: totalDebit - totalCredit
    }
  });
});

/**
 * POST SALE COGS JOURNAL
 * Debit  Cost of Goods Sold
 * Credit Inventory
 */
accountingRoute.post("/post-sale-cogs", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = postSaleCogsJournalSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const existing = await prisma.journalEntry.findFirst({
    where: {
      sourceType: "POS_SALE_COGS",
      sourceId: parsed.data.saleId
    },
    include: {
      lines: {
        include: {
          account: true,
          party: true
        }
      }
    }
  });

  if (existing) {
    return c.json({
      data: existing,
      message: "COGS journal already exists for this sale"
    });
  }

  const saleItems = await prisma.saleItem.findMany({
    where: { saleId: parsed.data.saleId }
  });
  const cogs = {
    total: round4(
      saleItems.reduce(
        (sum, item) => sum + Number(item.baseTotalCost ?? item.totalCost ?? 0),
        0
      )
    ),
    details: saleItems.map((item) => ({
      productId: item.productId,
      warehouseId: item.warehouseId,
      lotId: item.lotId,
      quantity: Number(item.quantityBase || 0),
      avgCost:
        Number(item.quantityBase || 0) > 0
          ? Number(item.baseTotalCost ?? item.totalCost ?? 0) /
            Number(item.quantityBase)
          : 0,
      lineCost: Number(item.baseTotalCost ?? item.totalCost ?? 0)
    }))
  };

  if (cogs.total <= 0) {
    return c.json({
      data: null,
      skipped: true,
      message: "COGS was not posted because product cost was not available",
      details: cogs.details
    });
  }

  const cogsAccount = await getAccountByCode("5000");
  const inventoryAccount = await getAccountByCode("1300");

  const lines = [
    {
      accountId: cogsAccount.id,
      debit: cogs.total,
      credit: 0,
      note: "Cost of goods sold for POS sale"
    },
    {
      accountId: inventoryAccount.id,
      debit: 0,
      credit: cogs.total,
      note: "Inventory reduced by POS sale cost"
    }
  ];

  const balance = validateDoubleEntry(lines);

  if (!balance.ok) {
    return c.json({ message: balance.message }, 400);
  }

  const baseCurrencyId = (await getBaseCurrency(prisma))?.id || null;
  const entry = await prisma.journalEntry.create({
    data: {
      entryNo: `JE-COGS-${Date.now()}`,
      date: new Date(),
      description: `COGS for POS Sale ${parsed.data.invoiceNo}`,
      sourceType: "POS_SALE_COGS",
      sourceId: parsed.data.saleId,
      lines: {
        create: lines.map((line) => ({
          accountId: line.accountId,
          debit: line.debit,
          credit: line.credit,
          exchangeRate: 1,
          baseCurrencyId,
          baseDebit: line.debit,
          baseCredit: line.credit,
          note: line.note
        }))
      }
    },
    include: {
      lines: {
        include: {
          account: true,
          party: true
        }
      }
    }
  });

  return c.json({
    data: entry,
    cogs
  }, 201);
});
