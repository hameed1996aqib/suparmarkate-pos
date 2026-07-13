import { Hono } from "hono";
import { prisma } from "../../lib/prisma";
import { getCurrentCurrencyRates } from "../../lib/currency-rates";
import { MoneyDirection, MoneyTransactionType, PartyType } from "../../generated/prisma/enums";
import { Prisma } from "../../generated/prisma/client";
import { cacheGetJson, cacheSetJson } from "../../lib/cache";
import { kabulDateRange, kabulDayRange } from "../../lib/kabul-date";

export const reportsRoute = new Hono();

function toNumber(value: unknown) {
  return Number(value ?? 0);
}

function baseMoney(row: Record<string, unknown>, baseKey: string, amountKey: string) {
  const base = toNumber(row[baseKey]);
  if (base !== 0) return base;
  return toNumber(row[amountKey]) * toNumber(row.exchangeRate || 1);
}

function saleDiscountBase(sale: Record<string, unknown> & { items?: Array<Record<string, unknown>> }) {
  const exchangeRate = toNumber(sale.exchangeRate || 1);
  const invoiceDiscount = toNumber(sale.discount) * exchangeRate;
  const itemDiscount = (sale.items || []).reduce((sum, item) => sum + toNumber(item.discount) * exchangeRate, 0);
  return invoiceDiscount + itemDiscount;
}

function parseReportDate(value?: string) {
  return kabulDayRange(value);
}

function parseReportRange(from?: string, to?: string) {
  return kabulDateRange(from, to);
}

function parseEmployeePerformanceRange(period?: string, date?: string) {
  const day = kabulDayRange(date);
  const source = day.source;
  const end = new Date(day.end.getTime() + 1);
  const start = new Date(end);

  if (period === "week") {
    start.setDate(start.getDate() - 7);
  } else if (period === "month") {
    start.setDate(1);
  } else {
    start.setDate(start.getDate() - 1);
  }

  return {
    key: period === "week" || period === "month" ? period : "day",
    date: source,
    start,
    end
  };
}

function emptyReportRow(id: string, name: string) {
  return {
    id,
    name,
    saleCount: 0,
    totalSales: 0,
    paidSales: 0,
    remainingSales: 0,
    discountTotal: 0,
    moneyIn: 0,
    moneyOut: 0,
    cashIn: 0,
    bankIn: 0,
    netCashFlow: 0
  };
}

reportsRoute.get("/daily-cashier", async (c) => {
  const { source, start, end } = parseReportDate(c.req.query("date"));

  const [sales, moneyTransactions] = await Promise.all([
    prisma.sale.findMany({
      where: {
        saleDate: {
          gte: start,
          lt: end
        },
        status: { not: "CANCELLED" }
      },
      include: {
        cashier: true,
        posDevice: true,
        currency: true,
        items: { select: { discount: true } }
      },
      orderBy: {
        saleDate: "desc"
      }
    }),
    prisma.moneyTransaction.findMany({
      where: {
        createdAt: {
          gte: start,
          lt: end
        }
      },
      include: {
        createdByUser: true,
        posDevice: true,
        cashRegisterAccount: {
          include: {
            cashRegister: true
          }
        },
        bankAccount: true,
        currency: true
      },
      orderBy: {
        createdAt: "desc"
      }
    })
  ]);
  const byCashier = new Map<string, ReturnType<typeof emptyReportRow>>();
  const byDevice = new Map<string, ReturnType<typeof emptyReportRow>>();

  function cashierRow(user?: { id: string; displayName: string; username: string } | null) {
    const id = user?.id || "unknown";
    const name = user?.displayName || user?.username || "بدون کاربر";

    if (!byCashier.has(id)) {
      byCashier.set(id, emptyReportRow(id, name));
    }

    return byCashier.get(id)!;
  }

  function deviceRow(device?: { id: string; name: string; code: string | null } | null) {
    const id = device?.id || "unknown";
    const name = device?.name || device?.code || "بدون دستگاه";

    if (!byDevice.has(id)) {
      byDevice.set(id, emptyReportRow(id, name));
    }

    return byDevice.get(id)!;
  }

  for (const sale of sales) {
    const rows = [cashierRow(sale.cashier), deviceRow(sale.posDevice)];

    for (const row of rows) {
      row.saleCount += 1;
      row.totalSales += baseMoney(sale as Record<string, unknown>, "baseTotal", "total");
      row.paidSales += baseMoney(sale as Record<string, unknown>, "basePaidAmount", "paidAmount");
      row.remainingSales += baseMoney(sale as Record<string, unknown>, "baseRemainingAmount", "remainingAmount");
      row.discountTotal += saleDiscountBase(sale as Record<string, unknown> & { items?: Array<Record<string, unknown>> });
    }
  }

  for (const transaction of moneyTransactions) {
    const rows = [
      cashierRow(transaction.createdByUser),
      deviceRow(transaction.posDevice)
    ];
    const amount = toNumber(transaction.baseAmount);
    const isCash = Boolean(transaction.cashRegisterAccountId);
    const isIn = transaction.direction === MoneyDirection.IN;

    for (const row of rows) {
      if (isIn) {
        row.moneyIn += amount;
        if (isCash) {
          row.cashIn += amount;
        } else {
          row.bankIn += amount;
        }
      } else {
        row.moneyOut += amount;
      }
      row.netCashFlow = row.moneyIn - row.moneyOut;
    }
  }

  const totalSales = sales.reduce((sum, sale) => sum + baseMoney(sale as Record<string, unknown>, "baseTotal", "total"), 0);
  const discountTotal = sales.reduce(
    (sum, sale) => sum + saleDiscountBase(sale as Record<string, unknown> & { items?: Array<Record<string, unknown>> }),
    0
  );
  const paidSales = sales.reduce((sum, sale) => sum + baseMoney(sale as Record<string, unknown>, "basePaidAmount", "paidAmount"), 0);
  const remainingSales = sales.reduce(
    (sum, sale) => sum + baseMoney(sale as Record<string, unknown>, "baseRemainingAmount", "remainingAmount"),
    0
  );
  const moneyIn = moneyTransactions
    .filter((item) => item.direction === MoneyDirection.IN)
    .reduce((sum, item) => sum + toNumber(item.baseAmount), 0);
  const moneyOut = moneyTransactions
    .filter((item) => item.direction === MoneyDirection.OUT)
    .reduce((sum, item) => sum + toNumber(item.baseAmount), 0);

  return c.json({
    data: {
      date: source,
      range: {
        start,
        end
      },
      summary: {
        saleCount: sales.length,
        transactionCount: moneyTransactions.length,
        totalSales,
        discountTotal,
        paidSales,
        remainingSales,
        moneyIn,
        moneyOut,
        netCashFlow: moneyIn - moneyOut
      },
      byCashier: Array.from(byCashier.values()).sort(
        (a, b) => b.totalSales - a.totalSales
      ),
      byDevice: Array.from(byDevice.values()).sort(
        (a, b) => b.totalSales - a.totalSales
      ),
      recentTransactions: moneyTransactions.slice(0, 30).map((item) => ({
        id: item.id,
        createdAt: item.createdAt,
        type: item.type,
        direction: item.direction,
        amount: toNumber(item.baseAmount),
        originalAmount: toNumber(item.amount),
        exchangeRate: toNumber(item.exchangeRate),
        currency: item.currency.code,
        account:
          item.cashRegisterAccount?.cashRegister?.name ||
          item.bankAccount?.name ||
          "-",
        user:
          item.createdByUser?.displayName ||
          item.createdByUser?.username ||
          "-",
        device: item.posDevice?.name || item.posDevice?.code || "-",
        note: item.note
      }))
    }
  });
});

reportsRoute.get("/employee-performance", async (c) => {
  const range = parseEmployeePerformanceRange(c.req.query("period"), c.req.query("date"));

  const [employees, sales, moneyTransactions, attendanceRecords] = await Promise.all([
    prisma.employee.findMany({
      where: { deletedAt: null },
      include: { user: true },
      orderBy: { fullName: "asc" }
    }),
    prisma.sale.findMany({
      where: {
        saleDate: { gte: range.start, lt: range.end },
        status: { not: "CANCELLED" }
      },
      include: { cashier: true, items: { select: { discount: true } } }
    }),
    prisma.moneyTransaction.findMany({
      where: { createdAt: { gte: range.start, lt: range.end } },
      include: { createdByUser: true }
    }),
    prisma.attendanceRecord.findMany({
      where: { date: { gte: range.start, lt: range.end } },
      include: { employee: true }
    })
  ]);

  const rows = new Map<string, ReturnType<typeof emptyReportRow> & {
    employeeId: string | null;
    userId: string | null;
    position: string | null;
    workedHours: number;
    overtimeHours: number;
    presentDays: number;
    halfDays: number;
    absentDays: number;
    lateDays: number;
  }>();
  const employeeByUserId = new Map(
    employees.filter((item) => item.userId).map((item) => [item.userId as string, item])
  );
  const employeeById = new Map(employees.map((item) => [item.id, item]));

  function ensureRow(input: {
    key: string;
    name: string;
    employeeId?: string | null;
    userId?: string | null;
    position?: string | null;
  }) {
    if (!rows.has(input.key)) {
      rows.set(input.key, {
        ...emptyReportRow(input.key, input.name),
        employeeId: input.employeeId ?? null,
        userId: input.userId ?? null,
        position: input.position ?? null,
        workedHours: 0,
        overtimeHours: 0,
        presentDays: 0,
        halfDays: 0,
        absentDays: 0,
        lateDays: 0
      });
    }
    return rows.get(input.key)!;
  }

  for (const employee of employees) {
    ensureRow({
      key: employee.userId || employee.id,
      name: employee.fullName,
      employeeId: employee.id,
      userId: employee.userId,
      position: employee.position
    });
  }

  for (const sale of sales) {
    const employee = sale.cashierId ? employeeByUserId.get(sale.cashierId) : undefined;
    const row = ensureRow({
      key: sale.cashierId || "unknown",
      name: employee?.fullName || sale.cashier?.displayName || sale.cashier?.username || "بدون کاربر",
      employeeId: employee?.id ?? null,
      userId: sale.cashierId || null,
      position: employee?.position ?? null
    });
    row.saleCount += 1;
    row.totalSales += baseMoney(sale as Record<string, unknown>, "baseTotal", "total");
    row.paidSales += baseMoney(sale as Record<string, unknown>, "basePaidAmount", "paidAmount");
    row.remainingSales += baseMoney(sale as Record<string, unknown>, "baseRemainingAmount", "remainingAmount");
    row.discountTotal += saleDiscountBase(sale as Record<string, unknown> & { items?: Array<Record<string, unknown>> });
  }

  for (const transaction of moneyTransactions) {
    const employee = transaction.createdByUserId
      ? employeeByUserId.get(transaction.createdByUserId)
      : undefined;
    const row = ensureRow({
      key: transaction.createdByUserId || "unknown",
      name: employee?.fullName || transaction.createdByUser?.displayName || transaction.createdByUser?.username || "بدون کاربر",
      employeeId: employee?.id ?? null,
      userId: transaction.createdByUserId || null,
      position: employee?.position ?? null
    });
    const amount = toNumber(transaction.baseAmount);
    if (transaction.direction === MoneyDirection.IN) {
      row.moneyIn += amount;
    } else {
      row.moneyOut += amount;
    }
    row.netCashFlow = row.moneyIn - row.moneyOut;
  }

  for (const record of attendanceRecords) {
    const employee = employeeById.get(record.employeeId) || record.employee;
    const row = ensureRow({
      key: employee.userId || employee.id,
      name: employee.fullName,
      employeeId: employee.id,
      userId: employee.userId,
      position: employee.position
    });
    row.workedHours += toNumber(record.workedMinutes) / 60;
    row.overtimeHours += toNumber(record.overtimeMinutes) / 60;
    if (record.status === "HALF_PRESENT" || record.status === "MISSING_CHECKOUT") row.halfDays += 1;
    else if (record.status === "ABSENT") row.absentDays += 1;
    else row.presentDays += 1;
    if (record.status === "LATE" || toNumber(record.lateMinutes) > 0) row.lateDays += 1;
  }

  const dataRows = Array.from(rows.values()).map((row) => ({
    ...row,
    workedHours: Math.round(row.workedHours * 100) / 100,
    overtimeHours: Math.round(row.overtimeHours * 100) / 100,
    averageInvoice: row.saleCount ? row.totalSales / row.saleCount : 0
  }));

  return c.json({
    data: {
      period: range.key,
      date: range.date,
      range: { start: range.start, end: range.end },
      summary: {
        employeeCount: dataRows.length,
        saleCount: dataRows.reduce((sum, row) => sum + row.saleCount, 0),
        totalSales: dataRows.reduce((sum, row) => sum + row.totalSales, 0),
        discountTotal: dataRows.reduce((sum, row) => sum + row.discountTotal, 0),
        moneyIn: dataRows.reduce((sum, row) => sum + row.moneyIn, 0),
        moneyOut: dataRows.reduce((sum, row) => sum + row.moneyOut, 0),
        workedHours: Math.round(dataRows.reduce((sum, row) => sum + row.workedHours, 0) * 100) / 100
      },
      rows: dataRows.sort((a, b) => b.totalSales - a.totalSales)
    }
  });
});

reportsRoute.get("/management", async (c) => {
  const { from, to, start, end } = parseReportRange(c.req.query("from"), c.req.query("to"));
  const cacheKey = `reports:management:v3:${from}:${to}`;
  const cached = await cacheGetJson<Record<string, unknown>>(cacheKey);
  if (cached) return c.json({ data: cached, cache: "hit" });

  const [
    saleRows, purchaseRows, returnRows, moneyRows, cogsRows, topProducts,
    partyBalanceSummaryRows, receivableRows, payableRows, lowStockRows,
    expiryLots, recentSales, recentPurchases, incomeExpenses
  ] = await Promise.all([
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT COUNT(*)::int count,
        COALESCE(SUM(COALESCE(NULLIF("baseTotal", 0), "total" * COALESCE("exchangeRate", 1))), 0) total,
        COALESCE(SUM(COALESCE(NULLIF("basePaidAmount", 0), "paidAmount" * COALESCE("exchangeRate", 1))), 0) paid,
        COALESCE(SUM(COALESCE(NULLIF("baseRemainingAmount", 0), "remainingAmount" * COALESCE("exchangeRate", 1))), 0) remaining
      FROM "Sale" WHERE "saleDate" >= ${start} AND "saleDate" < ${end} AND "status" <> 'CANCELLED'
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT COUNT(*)::int count,
        COALESCE(SUM(COALESCE(NULLIF("baseTotal", 0), "total" * COALESCE("exchangeRate", 1))), 0) total,
        COALESCE(SUM(COALESCE(NULLIF("basePaidAmount", 0), "paidAmount" * COALESCE("exchangeRate", 1))), 0) paid,
        COALESCE(SUM(COALESCE(NULLIF("baseRemainingAmount", 0), "remainingAmount" * COALESCE("exchangeRate", 1))), 0) remaining
      FROM "Purchase" WHERE "purchaseDate" >= ${start} AND "purchaseDate" < ${end} AND "status" <> 'CANCELLED'
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        COALESCE((SELECT SUM(COALESCE(NULLIF("baseSubtotal", 0), "subtotal" * COALESCE("exchangeRate", 1))) FROM "SaleReturn"
          WHERE "createdAt" >= ${start} AND "createdAt" < ${end} AND "cancelledAt" IS NULL), 0) "saleTotal",
        COALESCE((SELECT SUM(COALESCE(NULLIF("baseSubtotal", 0), "subtotal" * COALESCE("exchangeRate", 1))) FROM "PurchaseReturn"
          WHERE "createdAt" >= ${start} AND "createdAt" < ${end} AND "cancelledAt" IS NULL), 0) "purchaseTotal"
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        COALESCE(SUM(mt."baseAmount") FILTER (
          WHERE mt."type" = 'INCOME' AND NOT EXISTS (
            SELECT 1 FROM "MoneyTransaction" cancel
            WHERE cancel."type" = 'ADJUSTMENT' AND cancel."referenceId" = mt.id
              AND cancel."referenceType" = 'INCOME_CANCEL'
          )
        ), 0) income,
        COALESCE(SUM(mt."baseAmount") FILTER (
          WHERE mt."type" = 'EXPENSE' AND NOT EXISTS (
            SELECT 1 FROM "MoneyTransaction" cancel
            WHERE cancel."type" = 'ADJUSTMENT' AND cancel."referenceId" = mt.id
              AND cancel."referenceType" = 'EXPENSE_CANCEL'
          )
        ), 0) expense
      FROM "MoneyTransaction" mt WHERE mt."createdAt" >= ${start} AND mt."createdAt" < ${end}
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        COALESCE((SELECT SUM(COALESCE(si."baseTotalCost", si."totalCost"))
          FROM "SaleItem" si JOIN "Sale" s ON s.id = si."saleId"
          WHERE s."saleDate" >= ${start} AND s."saleDate" < ${end} AND s."status" <> 'CANCELLED'), 0)
        - COALESCE((SELECT SUM(COALESCE(sri."baseTotalCost", sri."totalCost"))
          FROM "SaleReturnItem" sri JOIN "SaleReturn" sr ON sr.id = sri."saleReturnId"
          WHERE sr."createdAt" >= ${start} AND sr."createdAt" < ${end} AND sr."cancelledAt" IS NULL), 0) total
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT p.id, p.name, COALESCE(u."shortName", u.name) unit, COALESCE(SUM(si."quantityBase"), 0) quantity,
        COALESCE(SUM(si."totalPrice" * s."exchangeRate"), 0) "totalSales",
        COALESCE(SUM(COALESCE(si."baseTotalCost", si."totalCost")), 0) cogs
      FROM "SaleItem" si JOIN "Sale" s ON s.id = si."saleId" JOIN "Product" p ON p.id = si."productId"
      JOIN "Unit" u ON u.id = p."baseUnitId"
      WHERE s."saleDate" >= ${start} AND s."saleDate" < ${end} AND s."status" <> 'CANCELLED'
      GROUP BY p.id, p.name, u."shortName", u.name ORDER BY "totalSales" DESC LIMIT 25
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      WITH balances AS (
        SELECT p.type,
          GREATEST(pa."debitBalance" - pa."creditBalance", 0) * COALESCE(rate."rateToBase", 1) receivable,
          GREATEST(pa."creditBalance" - pa."debitBalance", 0) * COALESCE(rate."rateToBase", 1) payable
        FROM "PartyAccount" pa
        JOIN "Party" p ON p.id = pa."partyId"
        LEFT JOIN LATERAL (
          SELECT cr."rateToBase" FROM "CurrencyRate" cr
          WHERE cr."currencyId" = pa."currencyId" AND cr."deletedAt" IS NULL
            AND cr."effectiveAt" <= NOW()
          ORDER BY cr."effectiveAt" DESC, cr."createdAt" DESC LIMIT 1
        ) rate ON true
        WHERE p."deletedAt" IS NULL
      )
      SELECT
        COALESCE(SUM(receivable) FILTER (WHERE type IN ('CUSTOMER', 'BOTH')), 0) receivables,
        COALESCE(SUM(payable) FILTER (WHERE type IN ('SUPPLIER', 'BOTH')), 0) payables
      FROM balances
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT pa.id, pa."partyId", p.name, c.code currency,
        GREATEST(pa."debitBalance" - pa."creditBalance", 0) * COALESCE(rate."rateToBase", 1) receivable
      FROM "PartyAccount" pa JOIN "Party" p ON p.id = pa."partyId"
      JOIN "Currency" c ON c.id = pa."currencyId"
      LEFT JOIN LATERAL (
        SELECT cr."rateToBase" FROM "CurrencyRate" cr
        WHERE cr."currencyId" = pa."currencyId" AND cr."deletedAt" IS NULL
          AND cr."effectiveAt" <= NOW()
        ORDER BY cr."effectiveAt" DESC, cr."createdAt" DESC LIMIT 1
      ) rate ON true
      WHERE p."deletedAt" IS NULL AND p.type IN ('CUSTOMER', 'BOTH')
        AND pa."debitBalance" > pa."creditBalance"
      ORDER BY receivable DESC LIMIT 25
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT pa.id, pa."partyId", p.name, c.code currency,
        GREATEST(pa."creditBalance" - pa."debitBalance", 0) * COALESCE(rate."rateToBase", 1) payable
      FROM "PartyAccount" pa JOIN "Party" p ON p.id = pa."partyId"
      JOIN "Currency" c ON c.id = pa."currencyId"
      LEFT JOIN LATERAL (
        SELECT cr."rateToBase" FROM "CurrencyRate" cr
        WHERE cr."currencyId" = pa."currencyId" AND cr."deletedAt" IS NULL
          AND cr."effectiveAt" <= NOW()
        ORDER BY cr."effectiveAt" DESC, cr."createdAt" DESC LIMIT 1
      ) rate ON true
      WHERE p."deletedAt" IS NULL AND p.type IN ('SUPPLIER', 'BOTH')
        AND pa."creditBalance" > pa."debitBalance"
      ORDER BY payable DESC LIMIT 25
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT sb.id, p.name product, w.name warehouse, sb."quantityBase" quantity,
        p."minStock", u.name unit
      FROM "StockBalance" sb JOIN "Product" p ON p.id = sb."productId"
      JOIN "Warehouse" w ON w.id = sb."warehouseId"
      JOIN "Unit" u ON u.id = p."baseUnitId"
      WHERE p."minStock" > 0 AND p."isActive" = true AND p."deletedAt" IS NULL
        AND sb."quantityBase" <= p."minStock"
      ORDER BY sb."quantityBase" ASC LIMIT 100
    `),
    prisma.stockLot.findMany({
      where: { remainingQuantity: { gt: 0 }, expiryDate: { gte: new Date(), lte: new Date(Date.now() + 45 * 86400000) } },
      include: { product: true, warehouse: true }, orderBy: { expiryDate: "asc" }, take: 25
    }),
    prisma.sale.findMany({
      where: { saleDate: { gte: start, lt: end }, status: { not: "CANCELLED" } },
      include: { cashier: true, customer: true }, orderBy: { saleDate: "desc" }, take: 30
    }),
    prisma.purchase.findMany({
      where: { purchaseDate: { gte: start, lt: end }, status: { not: "CANCELLED" } },
      include: { supplier: true }, orderBy: { purchaseDate: "desc" }, take: 30
    }),
    prisma.moneyTransaction.findMany({
      where: { createdAt: { gte: start, lt: end }, type: { in: [MoneyTransactionType.INCOME, MoneyTransactionType.EXPENSE] } },
      include: { category: true, cashRegisterAccount: { include: { cashRegister: true } }, bankAccount: true, createdByUser: true },
      orderBy: { createdAt: "desc" }, take: 30
    })
  ]);
  const cancelledIncomeExpenseIds = new Set(
    incomeExpenses.length
      ? (
          await prisma.moneyTransaction.findMany({
            where: {
              type: MoneyTransactionType.ADJUSTMENT,
              referenceType: { in: ["INCOME_CANCEL", "EXPENSE_CANCEL"] },
              referenceId: { in: incomeExpenses.map((item) => item.id) }
            },
            select: { referenceId: true }
          })
        )
          .map((item) => item.referenceId)
          .filter((id): id is string => Boolean(id))
      : []
  );

  const sales = saleRows[0], purchases = purchaseRows[0], returns = returnRows[0], money = moneyRows[0];
  const netSales = toNumber(sales.total) - toNumber(returns.saleTotal);
  const netCogs = toNumber(cogsRows[0].total);
  const receivables = toNumber(partyBalanceSummaryRows[0]?.receivables);
  const payables = toNumber(partyBalanceSummaryRows[0]?.payables);
  const data = {
    range: { from, to, start, end },
    summary: {
      salesCount: toNumber(sales.count), salesTotal: toNumber(sales.total), salesPaid: toNumber(sales.paid),
      salesRemaining: toNumber(sales.remaining), salesReturnTotal: toNumber(returns.saleTotal), netSales,
      purchasesCount: toNumber(purchases.count), purchasesTotal: toNumber(purchases.total), purchasesPaid: toNumber(purchases.paid),
      purchasesRemaining: toNumber(purchases.remaining), purchaseReturnTotal: toNumber(returns.purchaseTotal),
      netPurchases: toNumber(purchases.total) - toNumber(returns.purchaseTotal), cogs: netCogs,
      grossProfit: netSales - netCogs, incomeTotal: toNumber(money.income), expenseTotal: toNumber(money.expense),
      netProfit: netSales - netCogs + toNumber(money.income) - toNumber(money.expense), receivables, payables
    },
    topProducts: topProducts.map((row) => ({ ...row, quantity: toNumber(row.quantity), totalSales: toNumber(row.totalSales),
      cogs: toNumber(row.cogs), profit: toNumber(row.totalSales) - toNumber(row.cogs) })),
    receivables: receivableRows.map((row) => ({ ...row, receivable: toNumber(row.receivable) })),
    payables: payableRows.map((row) => ({ ...row, payable: toNumber(row.payable) })),
    lowStock: lowStockRows.map((row) => ({ ...row, quantity: toNumber(row.quantity), minStock: toNumber(row.minStock) })),
    expiringLots: expiryLots.map((lot) => ({ id: lot.id, product: lot.product.name, warehouse: lot.warehouse.name,
      expiryDate: lot.expiryDate, quantity: toNumber(lot.remainingQuantity) })),
    recentSales: recentSales.map((sale) => ({ id: sale.id, invoiceNo: sale.invoiceNo, date: sale.saleDate,
      customer: sale.customer?.name || "-", cashier: sale.cashier?.displayName || sale.cashier?.username || "-",
      total: baseMoney(sale as Record<string, unknown>, "baseTotal", "total"),
      paid: baseMoney(sale as Record<string, unknown>, "basePaidAmount", "paidAmount"),
      remaining: baseMoney(sale as Record<string, unknown>, "baseRemainingAmount", "remainingAmount") })),
    recentPurchases: recentPurchases.map((purchase) => ({ id: purchase.id, invoiceNo: purchase.invoiceNo, date: purchase.purchaseDate,
      supplier: purchase.supplier?.name || "-",
      total: baseMoney(purchase as Record<string, unknown>, "baseTotal", "total"),
      paid: baseMoney(purchase as Record<string, unknown>, "basePaidAmount", "paidAmount"),
      remaining: baseMoney(purchase as Record<string, unknown>, "baseRemainingAmount", "remainingAmount") })),
    incomeExpenses: incomeExpenses.filter((item) => !cancelledIncomeExpenseIds.has(item.id)).map((item) => ({ id: item.id, date: item.createdAt, type: item.type,
      category: item.category?.name || "-", account: item.cashRegisterAccount?.cashRegister?.name || item.bankAccount?.name || "-",
      user: item.createdByUser?.displayName || item.createdByUser?.username || "-", amount: toNumber(item.baseAmount), note: item.note }))
  };
  await cacheSetJson(cacheKey, data, 30);
  return c.json({ data, cache: "miss" });
});

reportsRoute.get("/currency-usage", async (c) => {
  const { from, to, start, end } = parseReportRange(c.req.query("from"), c.req.query("to"));

  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
    WITH docs AS (
      SELECT 'SALE'::text "documentType", s."currencyId", c.code "currencyCode",
        c.symbol "currencySymbol", s."exchangeRate", COUNT(*)::int "documentCount",
        COALESCE(SUM(s.total), 0) "originalAmount",
        COALESCE(SUM(COALESCE(NULLIF(s."baseTotal", 0), s.total * COALESCE(s."exchangeRate", 1))), 0) "baseAmount",
        MIN(s."saleDate") "firstAt", MAX(s."saleDate") "lastAt"
      FROM "Sale" s JOIN "Currency" c ON c.id = s."currencyId"
      WHERE s."saleDate" >= ${start} AND s."saleDate" < ${end} AND s.status <> 'CANCELLED'
      GROUP BY s."currencyId", c.code, c.symbol, s."exchangeRate"

      UNION ALL

      SELECT 'PURCHASE'::text, p."currencyId", c.code, c.symbol, p."exchangeRate", COUNT(*)::int,
        COALESCE(SUM(p.total), 0),
        COALESCE(SUM(COALESCE(NULLIF(p."baseTotal", 0), p.total * COALESCE(p."exchangeRate", 1))), 0),
        MIN(p."purchaseDate"), MAX(p."purchaseDate")
      FROM "Purchase" p JOIN "Currency" c ON c.id = p."currencyId"
      WHERE p."purchaseDate" >= ${start} AND p."purchaseDate" < ${end} AND p.status <> 'CANCELLED'
      GROUP BY p."currencyId", c.code, c.symbol, p."exchangeRate"

      UNION ALL

      SELECT 'SALE_RETURN'::text, sr."currencyId", c.code, c.symbol, sr."exchangeRate", COUNT(*)::int,
        COALESCE(SUM(sr.subtotal), 0),
        COALESCE(SUM(COALESCE(NULLIF(sr."baseSubtotal", 0), sr.subtotal * COALESCE(sr."exchangeRate", 1))), 0),
        MIN(sr."createdAt"), MAX(sr."createdAt")
      FROM "SaleReturn" sr JOIN "Currency" c ON c.id = sr."currencyId"
      WHERE sr."createdAt" >= ${start} AND sr."createdAt" < ${end} AND sr."cancelledAt" IS NULL
      GROUP BY sr."currencyId", c.code, c.symbol, sr."exchangeRate"

      UNION ALL

      SELECT 'PURCHASE_RETURN'::text, pr."currencyId", c.code, c.symbol, pr."exchangeRate", COUNT(*)::int,
        COALESCE(SUM(pr.subtotal), 0),
        COALESCE(SUM(COALESCE(NULLIF(pr."baseSubtotal", 0), pr.subtotal * COALESCE(pr."exchangeRate", 1))), 0),
        MIN(pr."createdAt"), MAX(pr."createdAt")
      FROM "PurchaseReturn" pr JOIN "Currency" c ON c.id = pr."currencyId"
      WHERE pr."createdAt" >= ${start} AND pr."createdAt" < ${end} AND pr."cancelledAt" IS NULL
      GROUP BY pr."currencyId", c.code, c.symbol, pr."exchangeRate"

      UNION ALL

      SELECT ('MONEY_' || mt.direction::text || '_' || mt.type::text)::text, mt."currencyId", c.code, c.symbol,
        mt."exchangeRate", COUNT(*)::int,
        COALESCE(SUM(mt.amount), 0),
        COALESCE(SUM(COALESCE(NULLIF(mt."baseAmount", 0), mt.amount * COALESCE(mt."exchangeRate", 1))), 0),
        MIN(mt."createdAt"), MAX(mt."createdAt")
      FROM "MoneyTransaction" mt JOIN "Currency" c ON c.id = mt."currencyId"
      WHERE mt."createdAt" >= ${start} AND mt."createdAt" < ${end}
        AND mt.type::text <> 'ADJUSTMENT'
      GROUP BY mt."currencyId", c.code, c.symbol, mt."exchangeRate", mt.direction, mt.type
    )
    SELECT * FROM docs
    ORDER BY "currencyCode" ASC, "exchangeRate" ASC, "documentType" ASC
  `);

  const totalsByCurrency = new Map<string, {
    currencyId: string;
    currencyCode: string;
    currencySymbol: string | null;
    documentCount: number;
    originalAmount: number;
    baseAmount: number;
  }>();

  for (const row of rows) {
    const key = String(row.currencyId);
    const existing = totalsByCurrency.get(key) || {
      currencyId: key,
      currencyCode: String(row.currencyCode || "-"),
      currencySymbol: row.currencySymbol ? String(row.currencySymbol) : null,
      documentCount: 0,
      originalAmount: 0,
      baseAmount: 0
    };
    existing.documentCount += toNumber(row.documentCount);
    existing.originalAmount += toNumber(row.originalAmount);
    existing.baseAmount += toNumber(row.baseAmount);
    totalsByCurrency.set(key, existing);
  }

  return c.json({
    data: {
      range: { from, to, start, end },
      rows: rows.map((row) => ({
        documentType: row.documentType,
        currencyId: row.currencyId,
        currencyCode: row.currencyCode,
        currencySymbol: row.currencySymbol,
        exchangeRate: toNumber(row.exchangeRate),
        documentCount: toNumber(row.documentCount),
        originalAmount: toNumber(row.originalAmount),
        baseAmount: toNumber(row.baseAmount),
        firstAt: row.firstAt,
        lastAt: row.lastAt
      })),
      totalsByCurrency: Array.from(totalsByCurrency.values()).sort((a, b) =>
        a.currencyCode.localeCompare(b.currencyCode)
      )
    }
  });
});

reportsRoute.get("/management-legacy", async (c) => {
  return c.json({ message: "Legacy management report is disabled" }, 410);
  /*
  const { from, to, start, end } = parseReportRange(c.req.query("from"), c.req.query("to"));

  const [
    sales,
    saleItems,
    saleReturns,
    purchases,
    purchaseReturns,
    moneyTransactions,
    partyAccounts,
    stockRows,
    expiryLots,
    rates
  ] = await Promise.all([
    prisma.sale.findMany({
      where: { saleDate: { gte: start, lt: end }, status: { not: "CANCELLED" } },
      include: { cashier: true, customer: true, currency: true },
      orderBy: { saleDate: "desc" }
    }),
    prisma.saleItem.findMany({
      where: {
        sale: {
          saleDate: { gte: start, lt: end },
          status: { not: "CANCELLED" }
        }
      },
      include: { product: true, sale: true }
    }),
    prisma.saleReturn.findMany({
      where: { createdAt: { gte: start, lt: end } },
      include: { items: true, customer: true }
    }),
    prisma.purchase.findMany({
      where: { purchaseDate: { gte: start, lt: end }, status: { not: "CANCELLED" } },
      include: { supplier: true, currency: true },
      orderBy: { purchaseDate: "desc" }
    }),
    prisma.purchaseReturn.findMany({
      where: { createdAt: { gte: start, lt: end } },
      include: { supplier: true }
    }),
    prisma.moneyTransaction.findMany({
      where: { createdAt: { gte: start, lt: end } },
      include: {
        category: true,
        cashRegisterAccount: { include: { cashRegister: true } },
        bankAccount: true,
        createdByUser: true
      },
      orderBy: { createdAt: "desc" }
    }),
    prisma.partyAccount.findMany({
      include: {
        party: true,
        currency: true
      }
    }),
    prisma.stockBalance.findMany({
      where: { quantityBase: { gt: 0 } },
      include: { product: { include: { baseUnit: true } }, warehouse: true }
    }),
    prisma.stockLot.findMany({
      where: {
        remainingQuantity: { gt: 0 },
        expiryDate: {
          gte: new Date(),
          lte: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000)
        }
      },
      include: { product: true, warehouse: true },
      orderBy: { expiryDate: "asc" },
      take: 25
    }),
    getCurrentCurrencyRates(prisma)
  ]);

  const salesTotal = sales.reduce((sum, item) => sum + baseMoney(item as Record<string, unknown>, "baseTotal", "total"), 0);
  const salesPaid = sales.reduce((sum, item) => sum + baseMoney(item as Record<string, unknown>, "basePaidAmount", "paidAmount"), 0);
  const salesRemaining = sales.reduce((sum, item) => sum + baseMoney(item as Record<string, unknown>, "baseRemainingAmount", "remainingAmount"), 0);
  const salesReturnTotal = saleReturns.reduce((sum, item) => sum + baseMoney(item as Record<string, unknown>, "baseSubtotal", "subtotal"), 0);
  const purchasesTotal = purchases.reduce((sum, item) => sum + baseMoney(item as Record<string, unknown>, "baseTotal", "total"), 0);
  const purchasesPaid = purchases.reduce((sum, item) => sum + baseMoney(item as Record<string, unknown>, "basePaidAmount", "paidAmount"), 0);
  const purchasesRemaining = purchases.reduce((sum, item) => sum + baseMoney(item as Record<string, unknown>, "baseRemainingAmount", "remainingAmount"), 0);
  const purchaseReturnTotal = purchaseReturns.reduce((sum, item) => sum + baseMoney(item as Record<string, unknown>, "baseSubtotal", "subtotal"), 0);
  const grossCogs = saleItems.reduce(
    (sum, item) => sum + toNumber(item.baseTotalCost ?? item.totalCost),
    0
  );
  const returnedCogs = saleReturns
    .reduce(
      (sum, item) =>
        sum +
        item.items.reduce(
          (lineSum, line) => lineSum + toNumber(line.baseTotalCost ?? line.totalCost),
          0
        ),
      0
    );
  const netCogs = grossCogs - returnedCogs;
  const incomeTotal = moneyTransactions
    .filter((item) => item.type === MoneyTransactionType.INCOME)
    .reduce((sum, item) => sum + toNumber(item.baseAmount), 0);
  const expenseTotal = moneyTransactions
    .filter((item) => item.type === MoneyTransactionType.EXPENSE)
    .reduce((sum, item) => sum + toNumber(item.baseAmount), 0);
  const netSales = salesTotal - salesReturnTotal;
  const grossProfit = netSales - netCogs;
  const netProfit = grossProfit + incomeTotal - expenseTotal;

  const productMap = new Map<string, {
    id: string;
    name: string;
    quantity: number;
    totalSales: number;
    cogs: number;
    profit: number;
  }>();

  for (const item of saleItems) {
    const existing = productMap.get(item.productId) || {
      id: item.productId,
      name: item.product.name,
      quantity: 0,
      totalSales: 0,
      cogs: 0,
      profit: 0
    };
    existing.quantity += toNumber(item.quantityBase);
    existing.totalSales += toNumber(item.totalPrice) * toNumber(item.sale.exchangeRate || 1);
    existing.cogs += toNumber(item.baseTotalCost ?? item.totalCost);
    existing.profit = existing.totalSales - existing.cogs;
    productMap.set(item.productId, existing);
  }

  const partyBalanceRows = partyAccounts.map((account) => {
    const debit = toNumber(account.debitBalance);
    const credit = toNumber(account.creditBalance);
    return {
      id: account.id,
      partyId: account.partyId,
      name: account.party.name,
      type: account.party.type,
      currency: account.currency.code,
      receivable: Math.max(0, debit - credit) * (rates.get(account.currencyId) || 1),
      payable: Math.max(0, credit - debit) * (rates.get(account.currencyId) || 1)
    };
  });

  const receivables = partyBalanceRows
    .filter((item) => item.type === PartyType.CUSTOMER || item.type === PartyType.BOTH)
    .reduce((sum, item) => sum + item.receivable, 0);
  const payables = partyBalanceRows
    .filter((item) => item.type === PartyType.SUPPLIER || item.type === PartyType.BOTH)
    .reduce((sum, item) => sum + item.payable, 0);

  const stockByProduct = new Map<string, {
    id: string;
    product: string;
    warehouse: string;
    quantity: number;
    minStock: number;
    unit: string;
  }>();
  for (const balance of stockRows) {
    const key = `${balance.productId}:${balance.warehouseId}`;
    const existing = stockByProduct.get(key) || {
      id: key,
      product: balance.product.name,
      warehouse: balance.warehouse.name,
      quantity: 0,
      minStock: toNumber(balance.product.minStock),
      unit: balance.product.baseUnit.name
    };
    existing.quantity += toNumber(balance.quantityBase);
    stockByProduct.set(key, existing);
  }

  return c.json({
    data: {
      range: { from, to, start, end },
      summary: {
        salesCount: sales.length,
        salesTotal,
        salesPaid,
        salesRemaining,
        salesReturnTotal,
        netSales,
        purchasesCount: purchases.length,
        purchasesTotal,
        purchasesPaid,
        purchasesRemaining,
        purchaseReturnTotal,
        netPurchases: purchasesTotal - purchaseReturnTotal,
        cogs: netCogs,
        grossProfit,
        incomeTotal,
        expenseTotal,
        netProfit,
        receivables,
        payables
      },
      topProducts: Array.from(productMap.values()).sort((a, b) => b.totalSales - a.totalSales).slice(0, 25),
      receivables: partyBalanceRows.filter((item) => item.receivable > 0).sort((a, b) => b.receivable - a.receivable).slice(0, 25),
      payables: partyBalanceRows.filter((item) => item.payable > 0).sort((a, b) => b.payable - a.payable).slice(0, 25),
      lowStock: Array.from(stockByProduct.values()).filter((item) => item.minStock > 0 && item.quantity <= item.minStock).sort((a, b) => a.quantity - b.quantity),
      expiringLots: expiryLots.map((lot) => ({
        id: lot.id,
        product: lot.product.name,
        warehouse: lot.warehouse.name,
        expiryDate: lot.expiryDate,
        quantity: toNumber(lot.remainingQuantity)
      })),
      recentSales: sales.slice(0, 30).map((sale) => ({
        id: sale.id,
        invoiceNo: sale.invoiceNo,
        date: sale.saleDate,
        customer: sale.customer?.name || "-",
        cashier: sale.cashier?.displayName || sale.cashier?.username || "-",
        total: baseMoney(sale as Record<string, unknown>, "baseTotal", "total"),
        paid: baseMoney(sale as Record<string, unknown>, "basePaidAmount", "paidAmount"),
        remaining: baseMoney(sale as Record<string, unknown>, "baseRemainingAmount", "remainingAmount")
      })),
      recentPurchases: purchases.slice(0, 30).map((purchase) => ({
        id: purchase.id,
        invoiceNo: purchase.invoiceNo,
        date: purchase.purchaseDate,
        supplier: purchase.supplier?.name || "-",
        total: baseMoney(purchase as Record<string, unknown>, "baseTotal", "total"),
        paid: baseMoney(purchase as Record<string, unknown>, "basePaidAmount", "paidAmount"),
        remaining: baseMoney(purchase as Record<string, unknown>, "baseRemainingAmount", "remainingAmount")
      })),
      incomeExpenses: moneyTransactions
        .filter((item) => item.type === MoneyTransactionType.INCOME || item.type === MoneyTransactionType.EXPENSE)
        .slice(0, 30)
        .map((item) => ({
          id: item.id,
          date: item.createdAt,
          type: item.type,
          category: item.category?.name || "-",
          account: item.cashRegisterAccount?.cashRegister?.name || item.bankAccount?.name || "-",
          user: item.createdByUser?.displayName || item.createdByUser?.username || "-",
          amount: toNumber(item.baseAmount),
          note: item.note
        }))
    }
  });
  */
});
