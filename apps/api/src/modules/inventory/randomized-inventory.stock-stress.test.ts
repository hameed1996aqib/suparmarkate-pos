import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AuthUser } from "../../lib/auth";
import { idempotencyMiddleware } from "../../lib/idempotency";
import { createOperationReference } from "../../lib/operation-id";
import { prisma } from "../../lib/prisma";
import { roundStockQuantity } from "../../lib/stock-quantity";
import { StockMovementType } from "../../generated/prisma/enums";
import { productsRoute } from "../products/routes";
import { purchaseReturnsRoute } from "../purchase-returns/routes";
import { purchasesRoute } from "../purchases/routes";
import { saleReturnsRoute } from "../sale-returns/routes";
import { salesRoute } from "../sales/routes";
import { inventoryRoute } from "./routes";

const databaseUrl = process.env.DATABASE_URL || "";
if (!/[/_]supermarket_test(?:\?|$)/.test(databaseUrl)) {
  throw new Error("The randomized stock test may only run against supermarket_test.");
}

const PRODUCT_COUNT = 100;
const OPERATIONS_PER_PRODUCT = 50;
const marker = createOperationReference("STOCK-STRESS");

type TestUnit = { id: string; rate: number; name: string };
type TestProduct = { id: string; barcode: string; units: TestUnit[] };

let adminUser: AuthUser;
let baseCurrencyId = "";
let customerId = "";
let supplierId = "";
let warehouseIds: string[] = [];
let products: TestProduct[] = [];
const usedMovementTypes = new Set<StockMovementType>();
const app = new Hono<{ Variables: { authUser: AuthUser } }>();

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function enteredQuantity(unit: TestUnit, random: () => number) {
  const choices = [0.25, 0.5, 1];
  return choices[Math.floor(random() * choices.length)]!;
}

async function jsonRequest(
  path: string,
  init: RequestInit = {},
  operationId = createOperationReference("TEST-OP")
) {
  const response = await app.request(`http://localhost${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.method && init.method !== "GET"
        ? { "Idempotency-Key": operationId }
        : {}),
      ...(init.headers || {})
    }
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${init.method || "GET"} ${path} failed (${response.status}): ${text}`);
  }
  return { response, payload };
}

function post(path: string, body: unknown, operationId?: string) {
  return jsonRequest(
    path,
    { method: "POST", body: JSON.stringify(body) },
    operationId
  );
}

async function warehouseStock(productId: string, warehouseId: string) {
  const aggregate = await prisma.stockLot.aggregate({
    where: { productId, warehouseId },
    _sum: { remainingQuantity: true }
  });
  return roundStockQuantity(Number(aggregate._sum.remainingQuantity || 0));
}

async function addStock(
  product: TestProduct,
  warehouseId: string,
  unit: TestUnit,
  quantity: number,
  note: string
) {
  usedMovementTypes.add(StockMovementType.ADJUSTMENT_IN);
  return post("/api/inventory/adjustments", {
    productId: product.id,
    warehouseId,
    unitId: unit.id,
    type: "ADJUSTMENT_IN",
    quantity,
    unitCost: 10 * unit.rate,
    currencyId: baseCurrencyId,
    note
  });
}

async function ensureOutboundStock(
  product: TestProduct,
  warehouseId: string,
  unit: TestUnit,
  quantity: number
) {
  const required = roundStockQuantity(quantity * unit.rate);
  const available = await warehouseStock(product.id, warehouseId);
  // Keep one base unit of headroom because an old FIFO lot can contain dust
  // that is valid in the base unit but cannot be represented in a large unit.
  if (available < required + 1) {
    const missingBase = roundStockQuantity(Math.max(0, required - available) + 24);
    await addStock(
      product,
      warehouseId,
      unit,
      roundStockQuantity(missingBase / unit.rate),
      `${marker} automatic replenishment`
    );
  }
}

async function createPurchase(
  product: TestProduct,
  warehouseId: string,
  unit: TestUnit,
  quantity: number
) {
  usedMovementTypes.add(StockMovementType.PURCHASE);
  const result = await post("/api/purchases", {
    invoiceNo: createOperationReference("STRESS-P"),
    supplierId,
    currencyId: baseCurrencyId,
    paidAmount: 0,
    discount: 0,
    note: marker,
    items: [
      {
        productId: product.id,
        warehouseId,
        unitId: unit.id,
        quantity,
        unitCost: 10 * unit.rate,
        updateSalePrice: false
      }
    ]
  });
  return result.payload.data.purchase as { id: string; items: Array<{ id: string; quantity: unknown }> };
}

async function createSale(
  product: TestProduct,
  warehouseId: string,
  unit: TestUnit,
  quantity: number
) {
  await ensureOutboundStock(product, warehouseId, unit, quantity);
  usedMovementTypes.add(StockMovementType.SALE);
  const result = await post("/api/sales", {
    clientRequestId: createOperationReference("STRESS-SALE"),
    invoiceNo: createOperationReference("STRESS-S"),
    customerId,
    currencyId: baseCurrencyId,
    paidAmount: 0,
    discount: 0,
    note: marker,
    items: [
      {
        productId: product.id,
        warehouseId,
        unitId: unit.id,
        quantity,
        unitPrice: 20 * unit.rate,
        discount: 0
      }
    ]
  });
  const sale = result.payload.data.sale as {
    id: string;
    items: Array<{ id: string; quantity: unknown }>;
  };
  expect(sale.items.every((item) => Number(item.quantity) > 0)).toBe(true);
  return sale;
}

async function runProductScenario(product: TestProduct, productIndex: number) {
  const random = seededRandom(7_919 + productIndex * 97);
  const usedUnits = new Set<string>();

  await post("/api/inventory/opening-stock", {
    productId: product.id,
    warehouseId: warehouseIds[0],
    unitId: product.units[0]!.id,
    quantity: 50,
    unitCost: 10,
    currencyId: baseCurrencyId,
    note: `${marker} opening 50`
  });
  usedMovementTypes.add(StockMovementType.OPENING_STOCK);
  expect(await warehouseStock(product.id, warehouseIds[0]!)).toBe(50);

  const requiredKinds = [
    "ADJUSTMENT_IN",
    "ADJUSTMENT_OUT",
    "DAMAGE",
    "TRANSFER",
    "PURCHASE",
    "SALE",
    "SALE_RETURN",
    "PURCHASE_RETURN",
    "ADJUSTMENT_CANCEL",
    "TRANSFER_CANCEL",
    "SALE_CANCEL",
    "PURCHASE_CANCEL",
    "SALE_RETURN_CANCEL",
    "PURCHASE_RETURN_CANCEL"
  ] as const;

  for (let operationIndex = 0; operationIndex < OPERATIONS_PER_PRODUCT; operationIndex += 1) {
    const unit =
      operationIndex < product.units.length
        ? product.units[operationIndex]!
        : product.units[Math.floor(random() * product.units.length)]!;
    usedUnits.add(unit.id);
    const quantity = enteredQuantity(unit, random);
    const kind =
      operationIndex < requiredKinds.length
        ? requiredKinds[operationIndex]!
        : requiredKinds[Math.floor(random() * requiredKinds.length)]!;
    const warehouseIndex = Math.floor(random() * warehouseIds.length);
    const warehouseId = warehouseIds[warehouseIndex]!;
    const otherWarehouseId = warehouseIds[warehouseIndex === 0 ? 1 : 0]!;

    if (kind === "ADJUSTMENT_IN") {
      await addStock(product, warehouseId, unit, quantity, marker);
      continue;
    }

    if (kind === "ADJUSTMENT_OUT" || kind === "DAMAGE") {
      await ensureOutboundStock(product, warehouseId, unit, quantity);
      const type = kind === "DAMAGE" ? "DAMAGE" : "ADJUSTMENT_OUT";
      usedMovementTypes.add(
        kind === "DAMAGE" ? StockMovementType.DAMAGE : StockMovementType.ADJUSTMENT_OUT
      );
      await post("/api/inventory/adjustments", {
        productId: product.id,
        warehouseId,
        unitId: unit.id,
        type,
        quantity,
        note: marker
      });
      continue;
    }

    if (kind === "TRANSFER" || kind === "TRANSFER_CANCEL") {
      await ensureOutboundStock(product, warehouseId, unit, quantity);
      usedMovementTypes.add(StockMovementType.TRANSFER_OUT);
      usedMovementTypes.add(StockMovementType.TRANSFER_IN);
      const transfer = await post("/api/inventory/transfers", {
        productId: product.id,
        fromWarehouseId: warehouseId,
        toWarehouseId: otherWarehouseId,
        unitId: unit.id,
        quantity,
        note: marker
      });
      if (kind === "TRANSFER_CANCEL") {
        await post(
          `/api/inventory/transfers/${transfer.payload.data.referenceId}/cancel`,
          { reason: `${marker} transfer cancellation` }
        );
      }
      continue;
    }

    if (kind === "PURCHASE") {
      await createPurchase(product, warehouseId, unit, quantity);
      continue;
    }

    if (kind === "SALE") {
      await createSale(product, warehouseId, unit, quantity);
      continue;
    }

    if (kind === "PURCHASE_RETURN" || kind === "PURCHASE_RETURN_CANCEL") {
      const purchase = await createPurchase(product, warehouseId, unit, quantity);
      usedMovementTypes.add(StockMovementType.PURCHASE_RETURN);
      const returned = await post("/api/purchase-returns", {
        purchaseId: purchase.id,
        supplierId,
        receivedAmount: 0,
        note: marker,
        items: [{ purchaseItemId: purchase.items[0]!.id, quantity }]
      });
      if (kind === "PURCHASE_RETURN_CANCEL") {
        await post(`/api/purchase-returns/${returned.payload.data.purchaseReturn.id}/cancel`, {
          reason: `${marker} purchase return cancellation`
        });
      }
      continue;
    }

    if (kind === "SALE_RETURN" || kind === "SALE_RETURN_CANCEL") {
      const sale = await createSale(product, warehouseId, unit, quantity);
      usedMovementTypes.add(StockMovementType.SALE_RETURN);
      const returned = await post("/api/sale-returns", {
        saleId: sale.id,
        customerId,
        refundAmount: 0,
        note: marker,
        items: sale.items.map((item) => ({
          saleItemId: item.id,
          quantity: Number(item.quantity)
        }))
      });
      if (kind === "SALE_RETURN_CANCEL") {
        await post(`/api/sale-returns/${returned.payload.data.saleReturn.id}/cancel`, {
          reason: `${marker} sale return cancellation`
        });
      }
      continue;
    }

    if (kind === "SALE_CANCEL") {
      const sale = await createSale(product, warehouseId, unit, quantity);
      usedMovementTypes.add(StockMovementType.SALE_RETURN);
      await post(`/api/sales/${sale.id}/cancel`, { reason: `${marker} sale cancellation` });
      continue;
    }

    if (kind === "PURCHASE_CANCEL") {
      const purchase = await createPurchase(product, warehouseId, unit, quantity);
      usedMovementTypes.add(StockMovementType.PURCHASE_RETURN);
      await post(`/api/purchases/${purchase.id}/cancel`, {
        reason: `${marker} purchase cancellation`
      });
      continue;
    }

    const adjustment = await addStock(product, warehouseId, unit, quantity, marker);
    usedMovementTypes.add(StockMovementType.ADJUSTMENT_OUT);
    await post(`/api/inventory/movements/${adjustment.payload.data.movement.id}/cancel`, {
      reason: `${marker} adjustment cancellation`
    });
  }

  expect(usedUnits.size).toBe(product.units.length);
  const movementCount = await prisma.stockMovement.count({
    where: { productId: product.id }
  });
  expect(movementCount).toBeGreaterThanOrEqual(OPERATIONS_PER_PRODUCT + 1);
}

beforeAll(async () => {
  const [user, currency] = await Promise.all([
    prisma.user.findFirst({ where: { isActive: true } }),
    prisma.currency.findFirst({ where: { isBase: true, deletedAt: null } })
  ]);
  if (!user || !currency) {
    throw new Error("Seeded admin and base currency are required for the stock stress test.");
  }
  adminUser = {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: "Admin",
    permissions: [],
    mustChangePassword: false,
    employee: null
  };
  baseCurrencyId = currency.id;

  app.use("/api/*", async (c, next) => {
    c.set("authUser", adminUser);
    await next();
  });
  app.use("/api/*", idempotencyMiddleware);
  app.route("/api/inventory", inventoryRoute);
  app.route("/api/products", productsRoute);
  app.route("/api/purchases", purchasesRoute);
  app.route("/api/sales", salesRoute);
  app.route("/api/purchase-returns", purchaseReturnsRoute);
  app.route("/api/sale-returns", saleReturnsRoute);

  const [baseUnit, packUnit, cartonUnit] = await Promise.all([
    prisma.unit.create({ data: { name: `${marker} piece`, shortName: "pc" } }),
    prisma.unit.create({ data: { name: `${marker} pack`, shortName: "pk" } }),
    prisma.unit.create({ data: { name: `${marker} carton`, shortName: "ct" } })
  ]);
  const warehouses = await Promise.all([
    prisma.warehouse.create({ data: { name: `${marker} main` } }),
    prisma.warehouse.create({ data: { name: `${marker} secondary` } })
  ]);
  warehouseIds = warehouses.map((warehouse) => warehouse.id);
  const [customer, supplier] = await Promise.all([
    prisma.party.create({
      data: { type: "CUSTOMER", name: `${marker} customer`, code: `${marker}-C` }
    }),
    prisma.party.create({
      data: { type: "SUPPLIER", name: `${marker} supplier`, code: `${marker}-S` }
    })
  ]);
  customerId = customer.id;
  supplierId = supplier.id;

  const unitDefinitions = [
    { id: baseUnit.id, rate: 1, name: baseUnit.name },
    { id: packUnit.id, rate: 6, name: packUnit.name },
    { id: cartonUnit.id, rate: 12, name: cartonUnit.name }
  ];
  products = [];
  for (let index = 0; index < PRODUCT_COUNT; index += 1) {
    const barcode = `98${String(Date.now()).slice(-7)}${String(index).padStart(3, "0")}${String(index % 10)}`;
    const product = await prisma.product.create({
      data: {
        name: `${marker} product ${index + 1}`,
        sku: `${marker}-SKU-${index + 1}`,
        barcode,
        barcodeNormalized: barcode,
        baseUnitId: baseUnit.id,
        defaultWarehouseId: warehouses[0]!.id,
        units: {
          create: unitDefinitions.map((unit, unitIndex) => ({
            unitId: unit.id,
            conversionRate: unit.rate,
            purchasePrice: 10 * unit.rate,
            salePrice: 20 * unit.rate,
            isDefaultPurchase: unitIndex === 1,
            isDefaultSale: unitIndex === 0
          }))
        }
      }
    });
    products.push({ id: product.id, barcode, units: unitDefinitions });
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("randomized inventory movement release gate", () => {
  it("keeps 100 products consistent through 50 realistic randomized operations each", async () => {
    const startedAt = new Date();
    for (let offset = 0; offset < products.length; offset += 5) {
      await Promise.all(
        products
          .slice(offset, offset + 5)
          .map((product, index) => runProductScenario(product, offset + index))
      );
    }

    const productIds = products.map((product) => product.id);
    const [lots, balances, movements, operationCount] = await Promise.all([
      prisma.stockLot.findMany({
        where: { productId: { in: productIds } },
        select: { productId: true, warehouseId: true, remainingQuantity: true }
      }),
      prisma.stockBalance.findMany({
        where: { productId: { in: productIds } },
        select: { productId: true, warehouseId: true, quantityBase: true }
      }),
      prisma.stockMovement.findMany({
        where: { productId: { in: productIds } },
        select: { productId: true, warehouseId: true, type: true, quantity: true }
      }),
      prisma.idempotencyRecord.count({
        where: { userId: adminUser.id, createdAt: { gte: startedAt } }
      })
    ]);

    const keyOf = (productId: string, warehouseId: string) => `${productId}:${warehouseId}`;
    const lotTotals = new Map<string, number>();
    for (const lot of lots) {
      expect(Number(lot.remainingQuantity)).toBeGreaterThanOrEqual(0);
      const key = keyOf(lot.productId, lot.warehouseId);
      lotTotals.set(
        key,
        roundStockQuantity((lotTotals.get(key) || 0) + Number(lot.remainingQuantity))
      );
    }
    const balanceTotals = new Map(
      balances.map((balance) => [
        keyOf(balance.productId, balance.warehouseId),
        roundStockQuantity(Number(balance.quantityBase))
      ])
    );
    const ledgerTotals = new Map<string, number>();
    const inbound = new Set<StockMovementType>([
      StockMovementType.OPENING_STOCK,
      StockMovementType.PURCHASE,
      StockMovementType.SALE_RETURN,
      StockMovementType.ADJUSTMENT_IN,
      StockMovementType.TRANSFER_IN
    ]);
    for (const movement of movements) {
      const key = keyOf(movement.productId, movement.warehouseId);
      const signed = Number(movement.quantity) * (inbound.has(movement.type) ? 1 : -1);
      ledgerTotals.set(
        key,
        roundStockQuantity((ledgerTotals.get(key) || 0) + signed)
      );
    }

    const allKeys = new Set([...lotTotals.keys(), ...balanceTotals.keys(), ...ledgerTotals.keys()]);
    for (const key of allKeys) {
      expect(balanceTotals.get(key) || 0).toBeCloseTo(lotTotals.get(key) || 0, 4);
      expect(ledgerTotals.get(key) || 0).toBeCloseTo(lotTotals.get(key) || 0, 4);
    }
    expect(new Set(movements.map((movement) => movement.type)).size).toBe(
      Object.values(StockMovementType).length
    );
    expect(operationCount).toBeGreaterThanOrEqual(PRODUCT_COUNT * OPERATIONS_PER_PRODUCT);

    const sample = products[0]!;
    const pageChecks = await Promise.all([
      jsonRequest(`/api/products?search=${sample.barcode}&page=1&limit=20`),
      jsonRequest(`/api/products/lookup?search=${sample.barcode}&limit=20`),
      jsonRequest(`/api/products/pos-search?search=${sample.barcode}&limit=20&offset=0`),
      jsonRequest(`/api/products/barcode-lookup?barcode=${sample.barcode}`),
      jsonRequest(`/api/inventory/stock?productId=${sample.id}&sortBy=quantity&sortOrder=desc&page=1&limit=20`),
      jsonRequest(`/api/inventory/lots?productId=${sample.id}&page=1&limit=20`),
      jsonRequest(`/api/inventory/movements?productId=${sample.id}&page=1&limit=20`),
      jsonRequest(`/api/inventory/transfer-reports?search=${sample.barcode}&page=1&limit=20`),
      jsonRequest(`/api/inventory/damage-reports?page=1&limit=20`),
      jsonRequest(`/api/inventory/product-history/${sample.id}?page=1&limit=20`)
    ]);
    expect(pageChecks.every((check) => check.response.status === 200)).toBe(true);

    const duplicateKey = createOperationReference("DUPLICATE-CHECK");
    const duplicateBody = {
      productId: sample.id,
      warehouseId: warehouseIds[0],
      unitId: sample.units[1]!.id,
      type: "ADJUSTMENT_IN",
      quantity: 1,
      unitCost: 60,
      currencyId: baseCurrencyId,
      note: `${marker} concurrent duplicate check ${randomUUID()}`
    };
    const before = await warehouseStock(sample.id, warehouseIds[0]!);
    const [first, second] = await Promise.all([
      post("/api/inventory/adjustments", duplicateBody, duplicateKey),
      post("/api/inventory/adjustments", duplicateBody, duplicateKey)
    ]);
    const after = await warehouseStock(sample.id, warehouseIds[0]!);
    expect(after - before).toBeCloseTo(6, 4);
    expect(
      [first, second].filter(
        (result) => result.response.headers.get("Idempotency-Replayed") === "true"
      )
    ).toHaveLength(1);

    const cancellable = await addStock(
      sample,
      warehouseIds[0]!,
      sample.units[1]!,
      1,
      `${marker} concurrent cancellation check`
    );
    const cancellableMovementId = cancellable.payload.data.movement.id as string;
    const beforeCancellation = await warehouseStock(sample.id, warehouseIds[0]!);
    const cancellationResults = await Promise.allSettled([
      post(
        `/api/inventory/movements/${cancellableMovementId}/cancel`,
        { reason: `${marker} first concurrent cancellation` },
        createOperationReference("CANCEL-A")
      ),
      post(
        `/api/inventory/movements/${cancellableMovementId}/cancel`,
        { reason: `${marker} second concurrent cancellation` },
        createOperationReference("CANCEL-B")
      )
    ]);
    const afterCancellation = await warehouseStock(sample.id, warehouseIds[0]!);
    const cancellationRows = await prisma.stockMovement.count({
      where: {
        referenceType: "ADJUSTMENT_IN_CANCEL",
        referenceId: cancellableMovementId
      }
    });
    expect(cancellationResults.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(cancellationResults.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(cancellationRows).toBe(1);
    expect(afterCancellation).toBeCloseTo(beforeCancellation - 6, 4);
  });
});
