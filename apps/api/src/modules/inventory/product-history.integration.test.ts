import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "../../lib/prisma";
import { inventoryRoute } from "./routes";

const databaseUrl = process.env.DATABASE_URL || "";

if (!/[/_]supermarket_test(?:\?|$)/.test(databaseUrl)) {
  throw new Error("Product history integration tests require supermarket_test.");
}

let productId = "";
let warehouseId = "";
let baseUnitId = "";
const movementIds: string[] = [];

beforeAll(async () => {
  const [warehouse, unit] = await Promise.all([
    prisma.warehouse.findFirst({ where: { deletedAt: null, isActive: true } }),
    prisma.unit.findFirst({ where: { deletedAt: null, isActive: true } }),
  ]);

  if (!warehouse || !unit) {
    throw new Error("Seeded warehouse and unit are required.");
  }

  warehouseId = warehouse.id;
  baseUnitId = unit.id;
  const product = await prisma.product.create({
    data: {
      name: `History integration ${Date.now()}`,
      barcode: `88${Date.now()}`,
      baseUnitId,
      defaultWarehouseId: warehouseId,
    },
  });
  productId = product.id;

  const movements = await Promise.all([
    prisma.stockMovement.create({
      data: {
        productId,
        warehouseId,
        type: "OPENING_STOCK",
        quantity: 10,
        createdAt: new Date("2026-06-30T08:00:00.000Z"),
      },
    }),
    prisma.stockMovement.create({
      data: {
        productId,
        warehouseId,
        type: "PURCHASE",
        quantity: 5,
        createdAt: new Date("2026-07-05T08:00:00.000Z"),
      },
    }),
    prisma.stockMovement.create({
      data: {
        productId,
        warehouseId,
        type: "SALE",
        quantity: 3,
        createdAt: new Date("2026-07-06T08:00:00.000Z"),
      },
    }),
    prisma.stockMovement.create({
      data: {
        productId,
        warehouseId,
        type: "TRANSFER_OUT",
        quantity: 2,
        createdAt: new Date("2026-07-07T08:00:00.000Z"),
      },
    }),
    prisma.stockMovement.create({
      data: {
        productId,
        warehouseId,
        type: "TRANSFER_IN",
        quantity: 2,
        createdAt: new Date("2026-07-07T08:01:00.000Z"),
      },
    }),
  ]);
  movementIds.push(...movements.map((movement) => movement.id));
});

afterAll(async () => {
  if (movementIds.length) {
    await prisma.stockMovement.deleteMany({ where: { id: { in: movementIds } } });
  }
  if (productId) {
    await prisma.product.delete({ where: { id: productId } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

describe("product stock history", () => {
  it("returns period summaries and server pagination in base units", async () => {
    const response = await inventoryRoute.request(
      `http://localhost/product-history/${productId}?from=2026-07-01&to=2026-07-31&page=1&limit=2`,
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as any;

    expect(payload.data.product.id).toBe(productId);
    expect(payload.data.summary).toEqual({
      opening: 10,
      totalIn: 7,
      totalOut: 5,
      closing: 12,
    });
    expect(payload.data.movements).toHaveLength(2);
    expect(payload.pagination).toMatchObject({
      page: 1,
      limit: 2,
      total: 4,
      totalPages: 2,
    });
    expect(payload.data.movements[0]).toMatchObject({
      type: "TRANSFER_IN",
      direction: "IN",
      signedQuantity: 2,
    });
    const expandedResponse = await inventoryRoute.request(
      `http://localhost/product-history/${productId}?from=2026-07-01&to=2026-07-31&page=1&limit=1000`,
    );
    expect(expandedResponse.status).toBe(200);
    const expandedPayload = (await expandedResponse.json()) as any;

    expect(expandedPayload.data.movements).toHaveLength(4);
    expect(expandedPayload.pagination).toMatchObject({
      page: 1,
      limit: 1000,
      total: 4,
      totalPages: 1,
    });
  });
});
