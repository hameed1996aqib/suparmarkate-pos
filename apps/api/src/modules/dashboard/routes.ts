import { Hono } from "hono";
import { Prisma } from "../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { cacheGetJson, cacheSetJson } from "../../lib/cache";
import { getCurrentCurrencyRates } from "../../lib/currency-rates";

export const dashboardRoute = new Hono();

type DashboardPeriod = "today" | "week" | "month" | "fourMonths";

const number = (value: unknown) => Number(value ?? 0);

function startOfDay(date = new Date()) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function periodRange(period: DashboardPeriod) {
  const end = new Date();
  const start = startOfDay(end);
  if (period === "week") start.setDate(start.getDate() - 6);
  if (period === "month") start.setDate(1);
  if (period === "fourMonths") start.setMonth(start.getMonth() - 3, 1);
  return { start, end };
}

function parsePeriod(value?: string): DashboardPeriod {
  return value === "week" || value === "month" || value === "fourMonths" ? value : "today";
}

function bucketKey(date: Date, period: DashboardPeriod) {
  if (period === "fourMonths") {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }
  return date.toISOString().slice(0, 10);
}

function rangeBuckets(start: Date, end: Date, period: DashboardPeriod) {
  const cursor = new Date(start);
  const rows: Array<{ key: string; label: string; sales: number; purchases: number }> = [];
  while (cursor <= end) {
    const key = bucketKey(cursor, period);
    if (!rows.some((item) => item.key === key)) {
      rows.push({
        key,
        label: period === "fourMonths"
          ? cursor.toLocaleDateString("fa-AF", { month: "short" })
          : cursor.toLocaleDateString("fa-AF", { month: "short", day: "numeric" }),
        sales: 0,
        purchases: 0
      });
    }
    period === "fourMonths" ? cursor.setMonth(cursor.getMonth() + 1, 1) : cursor.setDate(cursor.getDate() + 1);
  }
  return rows;
}

function dateBucket(period: DashboardPeriod, column: string) {
  return Prisma.raw(
    period === "fourMonths"
      ? `TO_CHAR(${column}, 'YYYY-MM')`
      : `TO_CHAR(${column}, 'YYYY-MM-DD')`
  );
}

dashboardRoute.get("/summary", async (c) => {
  const period = parsePeriod(c.req.query("period"));
  const currencyId = c.req.query("currencyId")?.trim() || undefined;
  const cacheKey = `dashboard:summary:v2:${period}:${currencyId || "base"}`;
  const cached = await cacheGetJson<Record<string, unknown>>(cacheKey);
  if (cached) return c.json({ data: cached, cache: "hit" });

  const { start, end } = periodRange(period);
  const now = new Date();
  const expiryTarget = new Date(now);
  expiryTarget.setDate(expiryTarget.getDate() + 30);

  const [selectedCurrency, baseCurrency, rates] = await Promise.all([
    currencyId ? prisma.currency.findFirst({ where: { id: currencyId, deletedAt: null } }) : Promise.resolve(null),
    prisma.currency.findFirst({ where: { isBase: true, deletedAt: null }, orderBy: { createdAt: "asc" } }),
    getCurrentCurrencyRates(prisma)
  ]);
  if (currencyId && !selectedCurrency) return c.json({ message: "Currency not found" }, 404);

  const currencyFilter = currencyId ? Prisma.sql`AND "currencyId" = ${currencyId}` : Prisma.empty;
  const saleCurrencyFilter = currencyId ? Prisma.sql`AND s."currencyId" = ${currencyId}` : Prisma.empty;
  const purchaseCurrencyFilter = currencyId ? Prisma.sql`AND p."currencyId" = ${currencyId}` : Prisma.empty;
  const saleReturnCurrencyFilter = currencyId ? Prisma.sql`AND sr."currencyId" = ${currencyId}` : Prisma.empty;
  const purchaseReturnCurrencyFilter = currencyId ? Prisma.sql`AND pr."currencyId" = ${currencyId}` : Prisma.empty;
  const totalColumn = Prisma.raw(currencyId ? `"total"` : `"baseTotal"`);
  const paidColumn = Prisma.raw(currencyId ? `"paidAmount"` : `"basePaidAmount"`);
  const remainingColumn = Prisma.raw(currencyId ? `"remainingAmount"` : `"baseRemainingAmount"`);
  const subtotalColumn = Prisma.raw(currencyId ? `"subtotal"` : `"baseSubtotal"`);
  const moneyColumn = Prisma.raw(currencyId ? `"amount"` : `"baseAmount"`);
  const saleTotal = Prisma.raw(currencyId ? `s."total"` : `s."baseTotal"`);
  const purchaseTotal = Prisma.raw(currencyId ? `p."total"` : `p."baseTotal"`);
  const saleReturnTotal = Prisma.raw(currencyId ? `sr."subtotal"` : `sr."baseSubtotal"`);
  const purchaseReturnTotal = Prisma.raw(currencyId ? `pr."subtotal"` : `pr."baseSubtotal"`);
  const saleItemValue = Prisma.raw(currencyId ? `si."totalPrice"` : `si."totalPrice" * s."exchangeRate"`);
  const saleReturnItemValue = Prisma.raw(currencyId ? `sri."totalPrice"` : `sri."totalPrice" * sr."exchangeRate"`);
  const bucketSale = dateBucket(period, `s."saleDate"`);
  const bucketPurchase = dateBucket(period, `p."purchaseDate"`);
  const bucketSaleReturn = dateBucket(period, `sr."createdAt"`);
  const bucketPurchaseReturn = dateBucket(period, `pr."createdAt"`);
  const inventoryRate = currencyId ? rates.get(currencyId) || 1 : 1;

  const [
    salesRows, purchaseRows, saleReturnRows, purchaseReturnRows, cogsRows,
    moneyRows, damageRows, stockRows, trendRows, cashierRows, categoryRows,
    productRows, expired, expiringSoon, auditLogs, cashAccounts, bankAccounts,
    customerAccounts, supplierAccounts, customers, suppliers, outstandingSalesRows, outstandingPurchaseRows
  ] = await Promise.all([
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT COUNT(*)::int count, COALESCE(SUM(${totalColumn}), 0) total,
        COALESCE(SUM(${paidColumn}), 0) paid, COALESCE(SUM(${remainingColumn}), 0) remaining,
        COUNT(*) FILTER (WHERE ${remainingColumn} > 0)::int pending
      FROM "Sale" WHERE "saleDate" BETWEEN ${start} AND ${end} AND "status" <> 'CANCELLED' ${currencyFilter}
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT COUNT(*)::int count, COALESCE(SUM(${totalColumn}), 0) total,
        COALESCE(SUM(${paidColumn}), 0) paid, COALESCE(SUM(${remainingColumn}), 0) remaining,
        COUNT(*) FILTER (WHERE ${remainingColumn} > 0)::int pending
      FROM "Purchase" WHERE "purchaseDate" BETWEEN ${start} AND ${end} AND "status" <> 'CANCELLED' ${currencyFilter}
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT COALESCE(SUM(${subtotalColumn}), 0) total,
        COALESCE(SUM((SELECT COALESCE(SUM(COALESCE(i."baseTotalCost", i."totalCost")), 0)
          FROM "SaleReturnItem" i WHERE i."saleReturnId" = "SaleReturn".id)), 0) cogs
      FROM "SaleReturn" WHERE "createdAt" BETWEEN ${start} AND ${end} AND "cancelledAt" IS NULL ${currencyFilter}
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT COALESCE(SUM(${subtotalColumn}), 0) total FROM "PurchaseReturn"
      WHERE "createdAt" BETWEEN ${start} AND ${end} AND "cancelledAt" IS NULL ${currencyFilter}
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT COALESCE(SUM(COALESCE(si."baseTotalCost", si."totalCost")), 0) total
      FROM "SaleItem" si JOIN "Sale" s ON s.id = si."saleId"
      WHERE s."saleDate" BETWEEN ${start} AND ${end} AND s."status" <> 'CANCELLED' ${saleCurrencyFilter}
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        COALESCE(SUM(${moneyColumn}) FILTER (
          WHERE mt."type" = 'INCOME' AND NOT EXISTS (
            SELECT 1 FROM "MoneyTransaction" cancel
            WHERE cancel."type" = 'ADJUSTMENT' AND cancel."referenceId" = mt.id
              AND cancel."referenceType" = 'INCOME_CANCEL'
          )
        ), 0) income,
        COALESCE(SUM(${moneyColumn}) FILTER (
          WHERE mt."type" = 'EXPENSE' AND NOT EXISTS (
            SELECT 1 FROM "MoneyTransaction" cancel
            WHERE cancel."type" = 'ADJUSTMENT' AND cancel."referenceId" = mt.id
              AND cancel."referenceType" = 'EXPENSE_CANCEL'
          )
        ), 0) expenses,
        COALESCE(SUM(${moneyColumn}) FILTER (WHERE mt."direction" = 'IN'), 0) "moneyIn",
        COALESCE(SUM(${moneyColumn}) FILTER (WHERE mt."direction" = 'OUT'), 0) "moneyOut"
      FROM "MoneyTransaction" mt WHERE mt."createdAt" BETWEEN ${start} AND ${end} ${currencyFilter}
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT COALESCE(SUM("quantity" * COALESCE(${Prisma.raw(currencyId ? `"unitCost"` : `"baseUnitCost"`)}, 0)), 0) total
      FROM "StockMovement" WHERE "type" = 'DAMAGE' AND "createdAt" BETWEEN ${start} AND ${end} ${currencyFilter}
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT COUNT(*)::int products, COALESCE(SUM(value), 0) / ${inventoryRate} value,
        COUNT(*) FILTER (WHERE quantity <= 0)::int "outOfStock",
        COUNT(*) FILTER (WHERE "minStock" > 0 AND quantity > 0 AND quantity <= "minStock")::int "lowStock",
        COUNT(*) FILTER (WHERE "minStock" > 0 AND quantity >= "minStock" * 5)::int "highStock"
      FROM (
        SELECT p.id, p."minStock", COALESCE(SUM(sb."quantityBase"), 0) quantity,
          COALESCE(SUM(sb."valueBase"), 0) value
        FROM "Product" p LEFT JOIN "StockBalance" sb ON sb."productId" = p.id
        WHERE p."isActive" = true AND p."deletedAt" IS NULL GROUP BY p.id
      ) stock
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT bucket, SUM(sales) sales, SUM(purchases) purchases FROM (
        SELECT ${bucketSale} bucket, SUM(${saleTotal}) sales, 0::numeric purchases FROM "Sale" s
          WHERE s."saleDate" BETWEEN ${start} AND ${end} AND s."status" <> 'CANCELLED' ${saleCurrencyFilter} GROUP BY bucket
        UNION ALL SELECT ${bucketPurchase}, 0::numeric, SUM(${purchaseTotal}) FROM "Purchase" p
          WHERE p."purchaseDate" BETWEEN ${start} AND ${end} AND p."status" <> 'CANCELLED' ${purchaseCurrencyFilter} GROUP BY 1
        UNION ALL SELECT ${bucketSaleReturn}, -SUM(${saleReturnTotal}), 0::numeric FROM "SaleReturn" sr
          WHERE sr."createdAt" BETWEEN ${start} AND ${end} AND sr."cancelledAt" IS NULL ${saleReturnCurrencyFilter} GROUP BY 1
        UNION ALL SELECT ${bucketPurchaseReturn}, 0::numeric, -SUM(${purchaseReturnTotal}) FROM "PurchaseReturn" pr
          WHERE pr."createdAt" BETWEEN ${start} AND ${end} AND pr."cancelledAt" IS NULL ${purchaseReturnCurrencyFilter} GROUP BY 1
      ) trend GROUP BY bucket ORDER BY bucket
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT id, name, SUM(invoices)::int invoices, SUM(sales) sales FROM (
        SELECT COALESCE(u.id, 'unknown') id, COALESCE(u."displayName", u.username, 'بدون کاربر') name,
          COUNT(s.id)::int invoices, COALESCE(SUM(${saleTotal}), 0) sales
        FROM "Sale" s LEFT JOIN "User" u ON u.id = s."cashierId"
        WHERE s."saleDate" BETWEEN ${start} AND ${end} AND s."status" <> 'CANCELLED' ${saleCurrencyFilter}
        GROUP BY u.id, u."displayName", u.username
        UNION ALL
        SELECT COALESCE(u.id, 'unknown'), COALESCE(u."displayName", u.username, 'بدون کاربر'), 0::int,
          -COALESCE(SUM(${saleReturnTotal}), 0)
        FROM "SaleReturn" sr JOIN "Sale" s ON s.id = sr."saleId" LEFT JOIN "User" u ON u.id = s."cashierId"
        WHERE sr."createdAt" BETWEEN ${start} AND ${end} AND sr."cancelledAt" IS NULL ${saleReturnCurrencyFilter}
        GROUP BY u.id, u."displayName", u.username
      ) cashier GROUP BY id, name ORDER BY sales DESC
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT name, SUM(quantity) quantity, SUM(sales) sales FROM (
        SELECT COALESCE(pc.name, 'بدون کتگوری') name, SUM(si."quantityBase") quantity, SUM(${saleItemValue}) sales
        FROM "SaleItem" si JOIN "Sale" s ON s.id = si."saleId" JOIN "Product" p ON p.id = si."productId"
        LEFT JOIN "ProductCategory" pc ON pc.id = p."categoryId"
        WHERE s."saleDate" BETWEEN ${start} AND ${end} AND s."status" <> 'CANCELLED' ${saleCurrencyFilter} GROUP BY pc.name
        UNION ALL
        SELECT COALESCE(pc.name, 'بدون کتگوری'), -SUM(sri."quantityBase"), -SUM(${saleReturnItemValue})
        FROM "SaleReturnItem" sri JOIN "SaleReturn" sr ON sr.id = sri."saleReturnId"
        JOIN "Product" p ON p.id = sri."productId" LEFT JOIN "ProductCategory" pc ON pc.id = p."categoryId"
        WHERE sr."createdAt" BETWEEN ${start} AND ${end} AND sr."cancelledAt" IS NULL ${saleReturnCurrencyFilter} GROUP BY pc.name
      ) category GROUP BY name HAVING SUM(sales) > 0 ORDER BY sales DESC LIMIT 8
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT id, name, SUM(quantity) quantity, SUM(sales) sales FROM (
        SELECT p.id, p.name, SUM(si."quantityBase") quantity, SUM(${saleItemValue}) sales
        FROM "SaleItem" si JOIN "Sale" s ON s.id = si."saleId" JOIN "Product" p ON p.id = si."productId"
        WHERE s."saleDate" BETWEEN ${start} AND ${end} AND s."status" <> 'CANCELLED' ${saleCurrencyFilter} GROUP BY p.id, p.name
        UNION ALL
        SELECT p.id, p.name, -SUM(sri."quantityBase"), -SUM(${saleReturnItemValue})
        FROM "SaleReturnItem" sri JOIN "SaleReturn" sr ON sr.id = sri."saleReturnId" JOIN "Product" p ON p.id = sri."productId"
        WHERE sr."createdAt" BETWEEN ${start} AND ${end} AND sr."cancelledAt" IS NULL ${saleReturnCurrencyFilter} GROUP BY p.id, p.name
      ) product GROUP BY id, name HAVING SUM(sales) > 0 ORDER BY sales DESC LIMIT 8
    `),
    prisma.stockLot.count({ where: { remainingQuantity: { gt: 0 }, expiryDate: { not: null, lt: now } } }),
    prisma.stockLot.count({ where: { remainingQuantity: { gt: 0 }, expiryDate: { not: null, gte: now, lte: expiryTarget } } }),
    prisma.auditLog.findMany({ include: { user: true }, orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.cashRegisterAccount.findMany({ where: currencyId ? { currencyId } : {}, include: { currency: true } }),
    prisma.bankAccount.findMany({ where: { isActive: true, deletedAt: null, ...(currencyId ? { currencyId } : {}) }, include: { currency: true } }),
    prisma.partyAccount.findMany({ where: { party: { type: { in: ["CUSTOMER", "BOTH"] } }, ...(currencyId ? { currencyId } : {}) } }),
    prisma.partyAccount.findMany({ where: { party: { type: { in: ["SUPPLIER", "BOTH"] } }, ...(currencyId ? { currencyId } : {}) } }),
    prisma.party.count({ where: { type: { in: ["CUSTOMER", "BOTH"] }, isActive: true, deletedAt: null } }),
    prisma.party.count({ where: { type: { in: ["SUPPLIER", "BOTH"] }, isActive: true, deletedAt: null } }),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT COUNT(*)::int count FROM "Sale"
      WHERE "status" <> 'CANCELLED' AND "baseRemainingAmount" > 0
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT COUNT(*)::int count FROM "Purchase"
      WHERE "status" <> 'CANCELLED' AND "baseRemainingAmount" > 0
    `)
  ]);

  const sales = salesRows[0], purchases = purchaseRows[0], saleReturns = saleReturnRows[0];
  const purchaseReturns = purchaseReturnRows[0], money = moneyRows[0], stock = stockRows[0];
  const netSales = number(sales.total) - number(saleReturns.total);
  const cogs = number(cogsRows[0].total) - number(saleReturns.cogs);
  const accountBalance = (amount: number, row: { currencyId: string }) =>
    currencyId ? amount : amount * (rates.get(row.currencyId) || 1);
  const receivables = customerAccounts.reduce((sum, row) => sum + accountBalance(Math.max(0, number(row.debitBalance) - number(row.creditBalance)), row), 0);
  const payables = supplierAccounts.reduce((sum, row) => sum + accountBalance(Math.max(0, number(row.creditBalance) - number(row.debitBalance)), row), 0);
  const treasury = [...cashAccounts, ...bankAccounts].reduce((sum, row) => sum + accountBalance(number(row.balance), row), 0);
  const trend = rangeBuckets(start, end, period);
  for (const row of trendRows) {
    const item = trend.find((candidate) => candidate.key === row.bucket);
    if (item) Object.assign(item, { sales: number(row.sales), purchases: number(row.purchases) });
  }

  const data = {
    period: { key: period, start, end },
    currency: {
      filterCurrencyId: selectedCurrency?.id ?? null, filterCode: selectedCurrency?.code ?? null,
      filterName: selectedCurrency?.name ?? null, baseCurrencyId: baseCurrency?.id ?? null,
      baseCode: baseCurrency?.code ?? "AFN", displayCode: selectedCurrency?.code ?? baseCurrency?.code ?? "AFN"
    },
    overview: {
      sales: netSales, purchases: number(purchases.total) - number(purchaseReturns.total),
      grossProfit: netSales - cogs, netProfit: netSales - cogs + number(money.income) - number(money.expenses),
      income: number(money.income), expenses: number(money.expenses), treasury, receivables, payables,
      inventoryValue: number(stock.value), wasteValue: number(damageRows[0].total)
    },
    documents: {
      sales: number(sales.count), purchases: number(purchases.count), pendingSales: number(outstandingSalesRows[0]?.count),
      pendingPurchases: number(outstandingPurchaseRows[0]?.count), paidSales: number(sales.paid), paidPurchases: number(purchases.paid),
      remainingSales: number(sales.remaining), remainingPurchases: number(purchases.remaining)
    },
    parties: { customers, suppliers, receivables, payables },
    inventory: { products: number(stock.products), inventoryValue: number(stock.value), value: number(stock.value),
      outOfStock: number(stock.outOfStock), lowStock: number(stock.lowStock), highStock: number(stock.highStock), expired, expiringSoon },
    cashFlow: { moneyIn: number(money.moneyIn), moneyOut: number(money.moneyOut), net: number(money.moneyIn) - number(money.moneyOut) },
    salesByCashier: cashierRows.map((row) => ({ ...row, invoices: number(row.invoices), sales: number(row.sales) })),
    salesPurchasesTrend: trend,
    salesByCategory: categoryRows.map((row) => ({ ...row, quantity: number(row.quantity), sales: number(row.sales) })),
    topProducts: productRows.map((row) => ({ ...row, quantity: number(row.quantity), sales: number(row.sales) })),
    recentActivities: auditLogs.map((row) => ({
      id: row.id, action: row.action, entityType: row.entityType,
      user: row.user?.displayName || row.user?.username || "سیستم", createdAt: row.createdAt
    }))
  };

  await cacheSetJson(cacheKey, data, 30);
  return c.json({ data, cache: "miss" });
});
