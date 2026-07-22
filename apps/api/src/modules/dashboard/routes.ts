import { Hono } from "hono";
import { Prisma } from "../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { cacheGetJson, cacheSetJson } from "../../lib/cache";
import { getCurrentCurrencyRates } from "../../lib/currency-rates";
import { kabulDateString, parseKabulDateInput } from "../../lib/kabul-date";

export const dashboardRoute = new Hono();

type DashboardPeriod = "today" | "week" | "month" | "fourMonths";

const number = (value: unknown) => Number(value ?? 0);

function startOfDay(date = new Date()) {
  const parsed = parseKabulDateInput(kabulDateString(date));
  return parsed && parsed !== "INVALID_DATE" ? parsed : new Date(date);
}

function periodRange(period: DashboardPeriod) {
  const end = new Date();
  const today = kabulDateString(end);
  const [year, month] = today.split("-").map(Number);
  const start =
    period === "month"
      ? parseKabulDateInput(`${year}-${String(month).padStart(2, "0")}-01`)
      : period === "fourMonths"
        ? parseKabulDateInput(
            (() => {
              const date = new Date(Date.UTC(year, month - 1, 1, -4, -30, 0, 0));
              date.setUTCMonth(date.getUTCMonth() - 3);
              return kabulDateString(date);
            })()
          )
        : startOfDay(end);

  if (period === "week" && start instanceof Date) {
    start.setUTCDate(start.getUTCDate() - 6);
  }

  if (!start || start === "INVALID_DATE") {
    return { start: startOfDay(end), end };
  }

  return { start, end };
}

function parsePeriod(value?: string): DashboardPeriod {
  return value === "week" || value === "month" || value === "fourMonths" ? value : "today";
}

function bucketKey(date: Date, period: DashboardPeriod) {
  if (period === "fourMonths") {
    return kabulDateString(date).slice(0, 7);
  }
  return kabulDateString(date);
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
          ? cursor.toLocaleDateString("fa-AF", { timeZone: "Asia/Kabul", month: "short" })
          : cursor.toLocaleDateString("fa-AF", { timeZone: "Asia/Kabul", month: "short", day: "numeric" }),
        sales: 0,
        purchases: 0
      });
    }
    period === "fourMonths" ? cursor.setUTCMonth(cursor.getUTCMonth() + 1, 1) : cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return rows;
}

function dateBucket(period: DashboardPeriod, column: string) {
  return Prisma.raw(
    period === "fourMonths"
      ? `TO_CHAR(${column} AT TIME ZONE 'Asia/Kabul', 'YYYY-MM')`
      : `TO_CHAR(${column} AT TIME ZONE 'Asia/Kabul', 'YYYY-MM-DD')`
  );
}

dashboardRoute.get("/summary", async (c) => {
  const period = parsePeriod(c.req.query("period"));
  const currencyId = c.req.query("currencyId")?.trim() || undefined;
  const cacheKey = `dashboard:summary:v4:${kabulDateString()}:${period}:${currencyId || "base"}`;
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
  const totalColumn = Prisma.raw(currencyId ? `"total"` : `COALESCE(NULLIF("baseTotal", 0), "total" * COALESCE("exchangeRate", 1))`);
  const paidColumn = Prisma.raw(currencyId ? `"paidAmount"` : `COALESCE(NULLIF("basePaidAmount", 0), "paidAmount" * COALESCE("exchangeRate", 1))`);
  const remainingColumn = Prisma.raw(currencyId ? `"remainingAmount"` : `COALESCE(NULLIF("baseRemainingAmount", 0), "remainingAmount" * COALESCE("exchangeRate", 1))`);
  const subtotalColumn = Prisma.raw(currencyId ? `"subtotal"` : `COALESCE(NULLIF("baseSubtotal", 0), "subtotal" * COALESCE("exchangeRate", 1))`);
  const moneyColumn = Prisma.raw(currencyId ? `"amount"` : `"baseAmount"`);
  const saleTotal = Prisma.raw(currencyId ? `s."total"` : `COALESCE(NULLIF(s."baseTotal", 0), s."total" * COALESCE(s."exchangeRate", 1))`);
  const purchaseTotal = Prisma.raw(currencyId ? `p."total"` : `COALESCE(NULLIF(p."baseTotal", 0), p."total" * COALESCE(p."exchangeRate", 1))`);
  const saleReturnTotal = Prisma.raw(currencyId ? `sr."subtotal"` : `COALESCE(NULLIF(sr."baseSubtotal", 0), sr."subtotal" * COALESCE(sr."exchangeRate", 1))`);
  const purchaseReturnTotal = Prisma.raw(currencyId ? `pr."subtotal"` : `COALESCE(NULLIF(pr."baseSubtotal", 0), pr."subtotal" * COALESCE(pr."exchangeRate", 1))`);
  const saleItemValue = Prisma.raw(currencyId ? `si."totalPrice"` : `si."totalPrice" * s."exchangeRate"`);
  const saleReturnItemValue = Prisma.raw(currencyId ? `sri."totalPrice"` : `sri."totalPrice" * sr."exchangeRate"`);
  const saleCogsValue = Prisma.raw(
    currencyId
      ? `COALESCE(si."baseTotalCost", si."totalCost") / COALESCE(NULLIF(s."exchangeRate", 0), 1)`
      : `COALESCE(si."baseTotalCost", si."totalCost")`
  );
  const saleReturnCogsValue = Prisma.raw(
    currencyId
      ? `COALESCE(i."baseTotalCost", i."totalCost") / COALESCE(NULLIF(sr."exchangeRate", 0), 1)`
      : `COALESCE(i."baseTotalCost", i."totalCost")`
  );
  const saleReturnCategoryCogsValue = Prisma.raw(
    currencyId
      ? `COALESCE(sri."baseTotalCost", sri."totalCost") / COALESCE(NULLIF(sr."exchangeRate", 0), 1)`
      : `COALESCE(sri."baseTotalCost", sri."totalCost")`
  );
  const saleReturnSubtotal = Prisma.raw(
    currencyId
      ? `sr."subtotal"`
      : `COALESCE(NULLIF(sr."baseSubtotal", 0), sr."subtotal" * COALESCE(sr."exchangeRate", 1))`
  );
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
      FROM "Sale" WHERE "saleDate" >= ${start} AND "saleDate" < ${end} AND "status" <> 'CANCELLED' ${currencyFilter}
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT COUNT(*)::int count, COALESCE(SUM(${totalColumn}), 0) total,
        COALESCE(SUM(${paidColumn}), 0) paid, COALESCE(SUM(${remainingColumn}), 0) remaining,
        COUNT(*) FILTER (WHERE ${remainingColumn} > 0)::int pending
      FROM "Purchase" WHERE "purchaseDate" >= ${start} AND "purchaseDate" < ${end} AND "status" <> 'CANCELLED' ${currencyFilter}
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT COALESCE(SUM(${saleReturnSubtotal}), 0) total,
        COALESCE(SUM((SELECT COALESCE(SUM(${saleReturnCogsValue}), 0)
          FROM "SaleReturnItem" i WHERE i."saleReturnId" = sr.id)), 0) cogs
      FROM "SaleReturn" sr WHERE sr."createdAt" >= ${start} AND sr."createdAt" < ${end} AND sr."cancelledAt" IS NULL ${saleReturnCurrencyFilter}
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT COALESCE(SUM(${subtotalColumn}), 0) total FROM "PurchaseReturn"
      WHERE "createdAt" >= ${start} AND "createdAt" < ${end} AND "cancelledAt" IS NULL ${currencyFilter}
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT COALESCE(SUM(${saleCogsValue}), 0) total
      FROM "SaleItem" si JOIN "Sale" s ON s.id = si."saleId"
      WHERE s."saleDate" >= ${start} AND s."saleDate" < ${end} AND s."status" <> 'CANCELLED' ${saleCurrencyFilter}
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
      FROM "MoneyTransaction" mt WHERE mt."createdAt" >= ${start} AND mt."createdAt" < ${end} ${currencyFilter}
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT COALESCE(SUM("quantity" * COALESCE(${Prisma.raw(currencyId ? `"unitCost"` : `"baseUnitCost"`)}, 0)), 0) total
      FROM "StockMovement" WHERE "type" = 'DAMAGE' AND "createdAt" >= ${start} AND "createdAt" < ${end} ${currencyFilter}
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
          WHERE s."saleDate" >= ${start} AND s."saleDate" < ${end} AND s."status" <> 'CANCELLED' ${saleCurrencyFilter} GROUP BY bucket
        UNION ALL SELECT ${bucketPurchase}, 0::numeric, SUM(${purchaseTotal}) FROM "Purchase" p
          WHERE p."purchaseDate" >= ${start} AND p."purchaseDate" < ${end} AND p."status" <> 'CANCELLED' ${purchaseCurrencyFilter} GROUP BY 1
        UNION ALL SELECT ${bucketSaleReturn}, -SUM(${saleReturnTotal}), 0::numeric FROM "SaleReturn" sr
          WHERE sr."createdAt" >= ${start} AND sr."createdAt" < ${end} AND sr."cancelledAt" IS NULL ${saleReturnCurrencyFilter} GROUP BY 1
        UNION ALL SELECT ${bucketPurchaseReturn}, 0::numeric, -SUM(${purchaseReturnTotal}) FROM "PurchaseReturn" pr
          WHERE pr."createdAt" >= ${start} AND pr."createdAt" < ${end} AND pr."cancelledAt" IS NULL ${purchaseReturnCurrencyFilter} GROUP BY 1
      ) trend GROUP BY bucket ORDER BY bucket
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT id, name, SUM(invoices)::int invoices, SUM(sales) sales FROM (
        SELECT COALESCE(u.id, 'unknown') id, COALESCE(u."displayName", u.username, 'بدون کاربر') name,
          COUNT(s.id)::int invoices, COALESCE(SUM(${saleTotal}), 0) sales
        FROM "Sale" s LEFT JOIN "User" u ON u.id = s."cashierId"
        WHERE s."saleDate" >= ${start} AND s."saleDate" < ${end} AND s."status" <> 'CANCELLED' ${saleCurrencyFilter}
        GROUP BY u.id, u."displayName", u.username
        UNION ALL
        SELECT COALESCE(u.id, 'unknown'), COALESCE(u."displayName", u.username, 'بدون کاربر'), 0::int,
          -COALESCE(SUM(${saleReturnTotal}), 0)
        FROM "SaleReturn" sr JOIN "Sale" s ON s.id = sr."saleId" LEFT JOIN "User" u ON u.id = s."cashierId"
        WHERE sr."createdAt" >= ${start} AND sr."createdAt" < ${end} AND sr."cancelledAt" IS NULL ${saleReturnCurrencyFilter}
        GROUP BY u.id, u."displayName", u.username
      ) cashier GROUP BY id, name ORDER BY sales DESC
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT name, SUM(quantity) quantity, SUM(sales) sales, SUM(cogs) cogs, SUM(sales) - SUM(cogs) profit FROM (
        SELECT COALESCE(pc.name, 'بدون کتگوری') name, SUM(si."quantityBase") quantity, SUM(${saleItemValue}) sales,
          SUM(${saleCogsValue}) cogs
        FROM "SaleItem" si JOIN "Sale" s ON s.id = si."saleId" JOIN "Product" p ON p.id = si."productId"
        LEFT JOIN "ProductCategory" pc ON pc.id = p."categoryId"
        WHERE s."saleDate" >= ${start} AND s."saleDate" < ${end} AND s."status" <> 'CANCELLED' ${saleCurrencyFilter} GROUP BY pc.name
        UNION ALL
        SELECT COALESCE(pc.name, 'بدون کتگوری'), -SUM(sri."quantityBase"), -SUM(${saleReturnItemValue}),
          -SUM(${saleReturnCategoryCogsValue})
        FROM "SaleReturnItem" sri JOIN "SaleReturn" sr ON sr.id = sri."saleReturnId"
        JOIN "Product" p ON p.id = sri."productId" LEFT JOIN "ProductCategory" pc ON pc.id = p."categoryId"
        WHERE sr."createdAt" >= ${start} AND sr."createdAt" < ${end} AND sr."cancelledAt" IS NULL ${saleReturnCurrencyFilter} GROUP BY pc.name
      ) category GROUP BY name HAVING SUM(sales) > 0 ORDER BY sales DESC
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT id, name, SUM(quantity) quantity, SUM(sales) sales FROM (
        SELECT p.id, p.name, SUM(si."quantityBase") quantity, SUM(${saleItemValue}) sales
        FROM "SaleItem" si JOIN "Sale" s ON s.id = si."saleId" JOIN "Product" p ON p.id = si."productId"
        WHERE s."saleDate" >= ${start} AND s."saleDate" < ${end} AND s."status" <> 'CANCELLED' ${saleCurrencyFilter} GROUP BY p.id, p.name
        UNION ALL
        SELECT p.id, p.name, -SUM(sri."quantityBase"), -SUM(${saleReturnItemValue})
        FROM "SaleReturnItem" sri JOIN "SaleReturn" sr ON sr.id = sri."saleReturnId" JOIN "Product" p ON p.id = sri."productId"
        WHERE sr."createdAt" >= ${start} AND sr."createdAt" < ${end} AND sr."cancelledAt" IS NULL ${saleReturnCurrencyFilter} GROUP BY p.id, p.name
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
    salesByCategory: categoryRows.map((row) => ({
      ...row,
      quantity: number(row.quantity),
      sales: number(row.sales),
      cogs: number(row.cogs),
      profit: number(row.profit)
    })),
    topProducts: productRows.map((row) => ({ ...row, quantity: number(row.quantity), sales: number(row.sales) })),
    recentActivities: auditLogs.map((row) => ({
      id: row.id, action: row.action, entityType: row.entityType,
      user: row.user?.displayName || row.user?.username || "سیستم", createdAt: row.createdAt
    }))
  };

  await cacheSetJson(cacheKey, data, 30);
  return c.json({ data, cache: "miss" });
});
