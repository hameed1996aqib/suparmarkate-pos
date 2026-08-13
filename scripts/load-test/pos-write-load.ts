import { performance } from "node:perf_hooks";

import { prisma } from "../../apps/api/src/lib/prisma";
import { salesRoute } from "../../apps/api/src/modules/sales/routes";

const databaseUrl = process.env.DATABASE_URL ?? "";
const workers = Number(process.env.POS_LOAD_WORKERS ?? 100);
const salesPerWorker = Number(process.env.POS_LOAD_SALES_PER_WORKER ?? 10);
const minItems = Number(process.env.POS_LOAD_MIN_ITEMS ?? 5);
const maxItems = Number(process.env.POS_LOAD_MAX_ITEMS ?? 20);

if (process.env.ALLOW_POS_WRITE_LOAD !== "true") {
  throw new Error("Set ALLOW_POS_WRITE_LOAD=true to run the POS write load test.");
}

if (!/[/_][^/?]*load_test(?:\?|$)/i.test(databaseUrl)) {
  throw new Error("POS write load test requires an isolated database whose name ends with load_test.");
}

if (
  !Number.isInteger(workers) ||
  !Number.isInteger(salesPerWorker) ||
  !Number.isInteger(minItems) ||
  !Number.isInteger(maxItems) ||
  workers < 1 ||
  salesPerWorker < 1 ||
  minItems < 1 ||
  maxItems < minItems ||
  maxItems > 50
) {
  throw new Error("Invalid POS load-test dimensions.");
}

const runId = `pos-load-${Date.now()}`;
const latencies: number[] = [];
const failures: Array<{ requestId: string; status: number; body: unknown }> = [];
const saleIds: string[] = [];
let expectedRevenue = 0;
let expectedItemRows = 0;

const percentile = (values: number[], percentileValue: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1)
  );
  return Number(sorted[index]!.toFixed(2));
};

async function main() {
  const [currency, warehouse, unit] = await Promise.all([
    prisma.currency.findFirst({ where: { isBase: true, deletedAt: null } }),
    prisma.warehouse.findFirst({ where: { deletedAt: null, isActive: true } }),
    prisma.unit.findFirst({ where: { deletedAt: null, isActive: true } })
  ]);

  if (!currency || !warehouse || !unit) {
    throw new Error("Base currency, active warehouse and active unit are required.");
  }

  const requiredAccounts = await prisma.accountingAccount.count({
    where: { code: { in: ["1000", "1300", "4000", "5000"] }, isActive: true }
  });
  if (requiredAccounts !== 4) {
    throw new Error("Required POS accounting accounts are missing.");
  }

  const cashRegister = await prisma.cashRegister.create({
    data: {
      name: `POS load register ${runId}`,
      code: `LOAD-${runId}`,
      accounts: { create: { currencyId: currency.id, balance: 0 } }
    },
    include: { accounts: true }
  });
  const cashAccount = cashRegister.accounts[0]!;

  const products = [];
  for (let index = 0; index < maxItems; index += 1) {
    const product = await prisma.product.create({
      data: {
        name: `POS load product ${index + 1} ${runId}`,
        sku: `LOAD-${runId}-${index + 1}`,
        barcode: `98${Date.now()}${String(index).padStart(4, "0")}`,
        baseUnitId: unit.id,
        defaultWarehouseId: warehouse.id
      }
    });
    await prisma.stockLot.create({
      data: {
        productId: product.id,
        warehouseId: warehouse.id,
        initialQuantity: 100_000,
        remainingQuantity: 100_000,
        unitCost: 10 + index,
        currencyId: currency.id,
        exchangeRate: 1,
        baseUnitCost: 10 + index,
        sourceType: "POS_WRITE_LOAD_TEST"
      }
    });
    products.push(product);
  }

  const startedAt = performance.now();
  await Promise.all(
    Array.from({ length: workers }, async (_, workerIndex) => {
      for (let saleIndex = 0; saleIndex < salesPerWorker; saleIndex += 1) {
        const itemCount = minItems + ((workerIndex + saleIndex) % (maxItems - minItems + 1));
        const items = products.slice(0, itemCount).map((product, itemIndex) => ({
          productId: product.id,
          warehouseId: warehouse.id,
          unitId: unit.id,
          quantity: 1,
          unitPrice: 25 + itemIndex,
          discount: 0
        }));
        const paidAmount = items.reduce((sum, item) => sum + item.unitPrice, 0);
        const requestId = `${runId}-w${workerIndex}-s${saleIndex}`;
        const requestStartedAt = performance.now();
        const response = await salesRoute.request("http://localhost/", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            clientRequestId: requestId,
            invoiceNo: `LOAD-${workerIndex}-${saleIndex}-${runId}`,
            customerId: null,
            currencyId: currency.id,
            discount: 0,
            paidAmount,
            paymentAccountType: "CASH",
            paymentAccountId: cashAccount.id,
            items
          })
        });
        latencies.push(performance.now() - requestStartedAt);
        const body = (await response.json()) as any;
        if (response.status !== 201) {
          failures.push({ requestId, status: response.status, body });
          continue;
        }
        saleIds.push(body.data.sale.id);
        expectedRevenue += paidAmount;
        expectedItemRows += itemCount;
      }
    })
  );
  const durationMs = performance.now() - startedAt;

  const [sales, itemRows, movements, journals, updatedCashAccount, negativeLots] =
    await Promise.all([
      prisma.sale.count({ where: { id: { in: saleIds } } }),
      prisma.saleItem.count({ where: { saleId: { in: saleIds } } }),
      prisma.stockMovement.count({ where: { referenceType: "SALE", referenceId: { in: saleIds } } }),
      prisma.journalEntry.findMany({
        where: { sourceId: { in: saleIds } },
        include: { lines: true }
      }),
      prisma.cashRegisterAccount.findUniqueOrThrow({ where: { id: cashAccount.id } }),
      prisma.stockLot.count({
        where: { productId: { in: products.map((product) => product.id) }, remainingQuantity: { lt: 0 } }
      })
    ]);

  const unbalancedJournals = journals.filter((journal) => {
    const debit = journal.lines.reduce((sum, line) => sum + Number(line.baseDebit), 0);
    const credit = journal.lines.reduce((sum, line) => sum + Number(line.baseCredit), 0);
    return Math.abs(debit - credit) > 0.0001;
  }).length;
  const revenueJournals = journals.filter((journal) => journal.sourceType === "POS_SALE").length;
  const cogsJournals = journals.filter((journal) => journal.sourceType === "POS_SALE_COGS").length;

  const report = {
    runId,
    database: new URL(databaseUrl).pathname.slice(1),
    requestedSales: workers * salesPerWorker,
    workers,
    salesPerWorker,
    itemRange: [minItems, maxItems],
    successfulSales: saleIds.length,
    failedSales: failures.length,
    durationMs: Number(durationMs.toFixed(2)),
    throughputSalesPerSecond: Number((saleIds.length / (durationMs / 1000)).toFixed(2)),
    latencyMs: {
      min: Number(Math.min(...latencies).toFixed(2)),
      average: Number((latencies.reduce((sum, value) => sum + value, 0) / latencies.length).toFixed(2)),
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      max: Number(Math.max(...latencies).toFixed(2))
    },
    assertions: {
      persistedSales: sales,
      expectedItemRows,
      persistedItemRows: itemRows,
      stockMovements: movements,
      revenueJournals,
      cogsJournals,
      unbalancedJournals,
      negativeTestLots: negativeLots,
      expectedCashBalance: Number(expectedRevenue.toFixed(4)),
      actualCashBalance: Number(Number(updatedCashAccount.balance).toFixed(4))
    },
    firstFailures: failures.slice(0, 20)
  };

  console.log(JSON.stringify(report, null, 2));

  const valid =
    failures.length === 0 &&
    sales === workers * salesPerWorker &&
    itemRows === expectedItemRows &&
    revenueJournals === sales &&
    cogsJournals === sales &&
    unbalancedJournals === 0 &&
    negativeLots === 0 &&
    Math.abs(Number(updatedCashAccount.balance) - expectedRevenue) < 0.0001;

  if (!valid) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
