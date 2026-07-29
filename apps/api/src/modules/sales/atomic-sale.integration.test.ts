import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "../../lib/prisma";
import { salesRoute } from "./routes";

const databaseUrl = process.env.DATABASE_URL || "";

if (!/[/_]supermarket_test(?:\?|$)/.test(databaseUrl)) {
  throw new Error("Atomic sale integration tests require the isolated supermarket_test database.");
}

type Fixture = {
  productId: string;
  cashRegisterId: string;
  cashAccountId: string;
  lotIds: string[];
  clientRequestIds: string[];
};

let baseCurrencyId = "";
let warehouseId = "";
let unitId = "";
const fixtures: Fixture[] = [];

async function createFixture(label: string): Promise<Fixture> {
  const suffix = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const product = await prisma.product.create({
    data: {
      name: `Atomic sale ${suffix}`,
      sku: `ATOMIC-${suffix}`,
      barcode: `99${Date.now()}${Math.floor(Math.random() * 10000)}`,
      baseUnitId: unitId,
      defaultWarehouseId: warehouseId
    }
  });
  const cashRegister = await prisma.cashRegister.create({
    data: {
      name: `Atomic register ${suffix}`,
      code: `AR-${suffix}`,
      accounts: {
        create: {
          currencyId: baseCurrencyId,
          balance: 0
        }
      }
    },
    include: { accounts: true }
  });
  const lots = await Promise.all([
    prisma.stockLot.create({
      data: {
        productId: product.id,
        warehouseId,
        initialQuantity: 4,
        remainingQuantity: 4,
        unitCost: 10,
        currencyId: baseCurrencyId,
        exchangeRate: 1,
        baseUnitCost: 10,
        sourceType: "ATOMIC_SALE_TEST"
      }
    }),
    prisma.stockLot.create({
      data: {
        productId: product.id,
        warehouseId,
        initialQuantity: 5,
        remainingQuantity: 5,
        unitCost: 12,
        currencyId: baseCurrencyId,
        exchangeRate: 1,
        baseUnitCost: 12,
        sourceType: "ATOMIC_SALE_TEST"
      }
    })
  ]);

  const fixture = {
    productId: product.id,
    cashRegisterId: cashRegister.id,
    cashAccountId: cashRegister.accounts[0]!.id,
    lotIds: lots.map((lot) => lot.id),
    clientRequestIds: [] as string[]
  };

  fixtures.push(fixture);
  return fixture;
}

function saleRequest(fixture: Fixture, clientRequestId: string) {
  return salesRoute.request("http://localhost/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      clientRequestId,
      invoiceNo: `POS-${clientRequestId}`,
      currencyId: baseCurrencyId,
      discount: 0,
      paidAmount: 120,
      paymentAccountType: "CASH",
      paymentAccountId: fixture.cashAccountId,
      items: [
        {
          productId: fixture.productId,
          warehouseId,
          unitId,
          quantity: 6,
          unitPrice: 20,
          discount: 0
        }
      ]
    })
  });
}

async function cleanupFixture(fixture: Fixture) {
  const sales = await prisma.sale.findMany({
    where: { clientRequestId: { in: fixture.clientRequestIds } },
    select: { id: true }
  });
  const saleIds = sales.map((sale) => sale.id);

  if (saleIds.length > 0) {
    await prisma.auditLog.deleteMany({
      where: { entityType: "Sale", entityId: { in: saleIds } }
    });
    await prisma.journalEntry.deleteMany({ where: { sourceId: { in: saleIds } } });
    await prisma.moneyTransaction.deleteMany({
      where: { referenceId: { in: saleIds } }
    });
    await prisma.partyTransaction.deleteMany({
      where: { referenceId: { in: saleIds } }
    });
    await prisma.stockMovement.deleteMany({
      where: { referenceId: { in: saleIds } }
    });
    await prisma.sale.deleteMany({ where: { id: { in: saleIds } } });
  }

  await prisma.stockLot.deleteMany({ where: { id: { in: fixture.lotIds } } });
  await prisma.product.delete({ where: { id: fixture.productId } }).catch(() => undefined);
  await prisma.cashRegister.delete({ where: { id: fixture.cashRegisterId } }).catch(() => undefined);
}

beforeAll(async () => {
  const [currency, warehouse, unit] = await Promise.all([
    prisma.currency.findFirst({ where: { isBase: true, deletedAt: null } }),
    prisma.warehouse.findFirst({ where: { deletedAt: null, isActive: true } }),
    prisma.unit.findFirst({ where: { deletedAt: null, isActive: true } })
  ]);

  if (!currency || !warehouse || !unit) {
    throw new Error("Seeded currency, warehouse and unit are required for sale integration tests.");
  }

  const requiredAccounts = await prisma.accountingAccount.count({
    where: { code: { in: ["1000", "1300", "4000", "5000"] }, isActive: true }
  });

  if (requiredAccounts !== 4) {
    throw new Error("Seeded POS accounting accounts are required for sale integration tests.");
  }

  baseCurrencyId = currency.id;
  warehouseId = warehouse.id;
  unitId = unit.id;
});

afterAll(async () => {
  for (const fixture of fixtures.reverse()) {
    await cleanupFixture(fixture);
  }

  await prisma.accountingAccount.updateMany({
    where: { code: "5000" },
    data: { isActive: true }
  });
  await prisma.$disconnect();
});

describe("atomic POS sale", () => {
  it("creates stock, money, revenue and COGS exactly once for concurrent retries", async () => {
    const fixture = await createFixture("idempotent");
    const clientRequestId = `atomic-${Date.now()}-same-request`;
    fixture.clientRequestIds.push(clientRequestId);

    const responses = await Promise.all([
      saleRequest(fixture, clientRequestId),
      saleRequest(fixture, clientRequestId)
    ]);
    const payloads = await Promise.all(responses.map((response) => response.json() as Promise<any>));

    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    expect(new Set(payloads.map((payload) => payload.data.sale.id)).size).toBe(1);

    const sale = await prisma.sale.findUniqueOrThrow({
      where: { clientRequestId },
      include: { items: true }
    });
    const [lots, movements, transactions, journals, cashAccount] = await Promise.all([
      prisma.stockLot.findMany({
        where: { id: { in: fixture.lotIds } },
        orderBy: { unitCost: "asc" }
      }),
      prisma.stockMovement.findMany({
        where: { referenceType: "SALE", referenceId: sale.id }
      }),
      prisma.moneyTransaction.findMany({
        where: { referenceType: "SALE", referenceId: sale.id }
      }),
      prisma.journalEntry.findMany({
        where: { sourceId: sale.id },
        include: { lines: true }
      }),
      prisma.cashRegisterAccount.findUniqueOrThrow({ where: { id: fixture.cashAccountId } })
    ]);

    expect(sale.items).toHaveLength(2);
    expect(lots.map((lot) => Number(lot.remainingQuantity))).toEqual([0, 3]);
    expect(movements).toHaveLength(2);
    expect(transactions).toHaveLength(1);
    expect(Number(cashAccount.balance)).toBe(120);
    expect(journals.map((journal) => journal.sourceType).sort()).toEqual([
      "POS_SALE",
      "POS_SALE_COGS"
    ]);

    const cogsJournal = journals.find((journal) => journal.sourceType === "POS_SALE_COGS");
    expect(cogsJournal?.lines.reduce((sum, line) => sum + Number(line.baseDebit), 0)).toBe(64);
    expect(cogsJournal?.lines.reduce((sum, line) => sum + Number(line.baseCredit), 0)).toBe(64);

    const replay = await saleRequest(fixture, clientRequestId);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({
      idempotentReplay: true,
      data: { sale: { id: sale.id } }
    });
    expect(await prisma.sale.count({ where: { clientRequestId } })).toBe(1);

    const cancellation = await salesRoute.request(
      `http://localhost/${sale.id}/cancel`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "Atomic integration cancellation" })
      }
    );
    expect(cancellation.status).toBe(200);

    const [cancelledSale, restoredLots, restoredCash, cancellationJournals] =
      await Promise.all([
        prisma.sale.findUniqueOrThrow({ where: { id: sale.id } }),
        prisma.stockLot.findMany({
          where: { id: { in: fixture.lotIds } },
          orderBy: { unitCost: "asc" }
        }),
        prisma.cashRegisterAccount.findUniqueOrThrow({
          where: { id: fixture.cashAccountId }
        }),
        prisma.journalEntry.findMany({
          where: {
            sourceId: sale.id,
            sourceType: { in: ["SALE_CANCEL", "POS_SALE_COGS_CANCEL"] }
          },
          include: { lines: true }
        })
      ]);

    expect(cancelledSale.status).toBe("CANCELLED");
    expect(restoredLots.map((lot) => Number(lot.remainingQuantity))).toEqual([4, 5]);
    expect(Number(restoredCash.balance)).toBe(0);
    expect(cancellationJournals.map((journal) => journal.sourceType).sort()).toEqual([
      "POS_SALE_COGS_CANCEL",
      "SALE_CANCEL"
    ]);

    const cogsReversal = cancellationJournals.find(
      (journal) => journal.sourceType === "POS_SALE_COGS_CANCEL"
    );
    expect(cogsReversal?.lines.reduce((sum, line) => sum + Number(line.baseDebit), 0)).toBe(64);
    expect(cogsReversal?.lines.reduce((sum, line) => sum + Number(line.baseCredit), 0)).toBe(64);
  });

  it("rolls back stock and cash if COGS posting fails inside the transaction", async () => {
    const fixture = await createFixture("rollback");
    const clientRequestId = `atomic-${Date.now()}-rollback`;
    fixture.clientRequestIds.push(clientRequestId);

    await prisma.accountingAccount.update({
      where: { code: "5000" },
      data: { isActive: false }
    });

    try {
      const response = await saleRequest(fixture, clientRequestId);
      expect(response.status).toBeGreaterThanOrEqual(400);
    } finally {
      await prisma.accountingAccount.update({
        where: { code: "5000" },
        data: { isActive: true }
      });
    }

    const [saleCount, lots, movementCount, cashAccount] = await Promise.all([
      prisma.sale.count({ where: { clientRequestId } }),
      prisma.stockLot.findMany({
        where: { id: { in: fixture.lotIds } },
        orderBy: { unitCost: "asc" }
      }),
      prisma.stockMovement.count({
        where: { productId: fixture.productId, referenceType: "SALE" }
      }),
      prisma.cashRegisterAccount.findUniqueOrThrow({ where: { id: fixture.cashAccountId } })
    ]);

    expect(saleCount).toBe(0);
    expect(lots.map((lot) => Number(lot.remainingQuantity))).toEqual([4, 5]);
    expect(movementCount).toBe(0);
    expect(Number(cashAccount.balance)).toBe(0);
  });
});
