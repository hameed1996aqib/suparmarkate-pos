import { performance } from "node:perf_hooks";

import { prisma } from "../../apps/api/src/lib/prisma";
import { salesRoute } from "../../apps/api/src/modules/sales/routes";

const databaseUrl = process.env.DATABASE_URL ?? "";
const workers = Number(process.env.POS_LOAD_WORKERS ?? 100);
const salesPerWorker = Number(process.env.POS_LOAD_SALES_PER_WORKER ?? 10);
const minItems = Number(process.env.POS_LOAD_MIN_ITEMS ?? 5);
const maxItems = Number(process.env.POS_LOAD_MAX_ITEMS ?? 20);
const sharedProductPercent = Number(process.env.POS_LOAD_SHARED_PRODUCT_PERCENT ?? 100);

if (process.env.ALLOW_POS_WRITE_LOAD !== "true") {
  throw new Error("Set ALLOW_POS_WRITE_LOAD=true to run this load test.");
}
if (!/[/_][^/?]*load_test(?:\?|$)/i.test(databaseUrl)) {
  throw new Error("An isolated database whose name ends with load_test is required.");
}
if (
  !Number.isFinite(sharedProductPercent) ||
  sharedProductPercent < 0 ||
  sharedProductPercent > 100
) {
  throw new Error("POS_LOAD_SHARED_PRODUCT_PERCENT must be between 0 and 100.");
}

const runId = `pos-register-load-${Date.now()}`;
const latencies: number[] = [];
const failures: Array<{ requestId: string; status: number; body: unknown }> = [];
const saleIds: string[] = [];
let expectedRevenue = 0;
let expectedItemRows = 0;
let expectedSharedItemRows = 0;

function percentile(values: number[], value: number) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((value / 100) * sorted.length) - 1);
  return Number(sorted[Math.max(0, index)]!.toFixed(2));
}

async function main() {
  const [currency, warehouse, unit] = await Promise.all([
    prisma.currency.findFirst({ where: { isBase: true, deletedAt: null } }),
    prisma.warehouse.findFirst({ where: { deletedAt: null, isActive: true } }),
    prisma.unit.findFirst({ where: { deletedAt: null, isActive: true } })
  ]);
  if (!currency || !warehouse || !unit) throw new Error("Required baseline data is missing.");

  async function createTestProduct(label: string, index: number) {
    const product = await prisma.product.create({
      data: {
        name: `Register load product ${label} ${index + 1} ${runId}`,
        sku: `RLOAD-${runId}-${label}-${index + 1}`,
        barcode: `97${Date.now()}${Math.floor(Math.random() * 10_000_000)}`,
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
        sourceType: "POS_REGISTER_LOAD_TEST"
      }
    });
    return product;
  }

  const sharedCatalogSize =
    sharedProductPercent === 0
      ? 0
      : Math.max(1, Math.ceil((maxItems * sharedProductPercent) / 100));
  const uniqueCatalogSize = Math.max(0, maxItems - sharedCatalogSize);
  const sharedProducts = [];
  for (let index = 0; index < sharedCatalogSize; index += 1) {
    sharedProducts.push(await createTestProduct("shared", index));
  }

  const productsByWorker = [];
  for (let worker = 0; worker < workers; worker += 1) {
    const workerProducts = [];
    for (let index = 0; index < uniqueCatalogSize; index += 1) {
      workerProducts.push(await createTestProduct(`worker-${worker + 1}`, index));
    }
    productsByWorker.push(workerProducts);
  }
  const allProducts = [...sharedProducts, ...productsByWorker.flat()];

  const registers = [];
  for (let worker = 0; worker < workers; worker += 1) {
    registers.push(
      await prisma.cashRegister.create({
        data: {
          name: `Register load ${worker + 1} ${runId}`,
          code: `RLOAD-${worker + 1}-${runId}`,
          accounts: { create: { currencyId: currency.id, balance: 0 } }
        },
        include: { accounts: true }
      })
    );
  }

  const startedAt = performance.now();
  await Promise.all(
    Array.from({ length: workers }, async (_, worker) => {
      const cashAccount = registers[worker]!.accounts[0]!;
      let cumulativeSharedTarget = 0;
      let allocatedSharedItems = 0;
      for (let sale = 0; sale < salesPerWorker; sale += 1) {
        const itemCount = minItems + ((worker + sale) % (maxItems - minItems + 1));
        cumulativeSharedTarget += (itemCount * sharedProductPercent) / 100;
        const sharedItemCount = Math.min(
          itemCount,
          sharedProducts.length,
          Math.max(0, Math.floor(cumulativeSharedTarget + 1e-9) - allocatedSharedItems)
        );
        allocatedSharedItems += sharedItemCount;
        const selectedProducts = [
          ...sharedProducts.slice(0, sharedItemCount),
          ...productsByWorker[worker]!.slice(0, itemCount - sharedItemCount)
        ];
        const items = selectedProducts.map((product, index) => ({
          productId: product.id,
          warehouseId: warehouse.id,
          unitId: unit.id,
          quantity: 1,
          unitPrice: 25 + index,
          discount: 0
        }));
        const paidAmount = items.reduce((sum, item) => sum + item.unitPrice, 0);
        const requestId = `${runId}-w${worker}-s${sale}`;
        const requestStartedAt = performance.now();
        try {
          const response = await salesRoute.request("http://localhost/", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              clientRequestId: requestId,
              invoiceNo: `RLOAD-${worker}-${sale}-${runId}`,
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
          const responseText = await response.text();
          let body: unknown = responseText;
          try {
            body = responseText ? JSON.parse(responseText) : null;
          } catch {
            // Keep non-JSON server errors visible in the load-test report.
          }
          if (response.status !== 201) {
            failures.push({ requestId, status: response.status, body });
          } else {
            const successfulBody = body as any;
            saleIds.push(successfulBody.data.sale.id);
            expectedRevenue += paidAmount;
            expectedItemRows += itemCount;
            expectedSharedItemRows += sharedItemCount;
          }
        } catch (error) {
          latencies.push(performance.now() - requestStartedAt);
          failures.push({
            requestId,
            status: 0,
            body: error instanceof Error ? error.message : String(error)
          });
        }
      }
    })
  );
  const durationMs = performance.now() - startedAt;

  const accountIds = registers.map((register) => register.accounts[0]!.id);
  const [sales, itemRows, movements, journals, accounts, negativeLots] = await Promise.all([
    prisma.sale.count({ where: { id: { in: saleIds } } }),
    prisma.saleItem.count({ where: { saleId: { in: saleIds } } }),
    prisma.stockMovement.count({ where: { referenceType: "SALE", referenceId: { in: saleIds } } }),
    prisma.journalEntry.findMany({ where: { sourceId: { in: saleIds } }, include: { lines: true } }),
    prisma.cashRegisterAccount.findMany({ where: { id: { in: accountIds } } }),
    prisma.stockLot.count({
      where: {
        productId: { in: allProducts.map((product) => product.id) },
        remainingQuantity: { lt: 0 }
      }
    })
  ]);
  const unbalancedJournals = journals.filter((journal) => {
    const debit = journal.lines.reduce((sum, line) => sum + Number(line.baseDebit), 0);
    const credit = journal.lines.reduce((sum, line) => sum + Number(line.baseCredit), 0);
    return Math.abs(debit - credit) > 0.0001;
  }).length;
  const actualCashBalance = accounts.reduce((sum, account) => sum + Number(account.balance), 0);
  const revenueJournals = journals.filter((journal) => journal.sourceType === "POS_SALE").length;
  const cogsJournals = journals.filter((journal) => journal.sourceType === "POS_SALE_COGS").length;

  const report = {
    runId,
    registerMode: "per-worker",
    cashRegisters: registers.length,
    configuredSharedProductPercent: sharedProductPercent,
    actualSharedItemPercent: Number(
      ((expectedSharedItemRows / Math.max(1, expectedItemRows)) * 100).toFixed(2)
    ),
    sharedProducts: sharedProducts.length,
    uniqueProducts: allProducts.length - sharedProducts.length,
    requestedSales: workers * salesPerWorker,
    successfulSales: saleIds.length,
    failedSales: failures.length,
    itemRange: [minItems, maxItems],
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
      actualCashBalance: Number(actualCashBalance.toFixed(4))
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
    Math.abs(actualCashBalance - expectedRevenue) < 0.0001;
  if (!valid) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
