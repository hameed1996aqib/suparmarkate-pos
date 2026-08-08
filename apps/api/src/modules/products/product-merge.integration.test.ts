import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AuthUser } from "../../lib/auth";
import { prisma } from "../../lib/prisma";
import { productsRoute } from "./routes";

const databaseUrl = process.env.DATABASE_URL || "";

if (!/[/_]supermarket_test(?:\?|$)/.test(databaseUrl)) {
  throw new Error("Product merge integration tests require the isolated supermarket_test database.");
}

let adminUserId = "";
let unitId = "";
let extraUnitId = "";
let warehouseId = "";
let currencyId = "";
const productIds: string[] = [];
const purchaseIds: string[] = [];
const purchaseReturnIds: string[] = [];
const saleIds: string[] = [];
const saleReturnIds: string[] = [];

const adminApp = new Hono<{ Variables: { authUser: AuthUser } }>();
adminApp.use("*", async (c, next) => {
  c.set("authUser", {
    id: adminUserId,
    username: "admin",
    displayName: "Product merge Admin",
    role: "Admin",
    permissions: [],
    mustChangePassword: false,
    employee: null,
  });
  await next();
});
adminApp.route("/", productsRoute);

function toPersianDigits(value: string) {
  return value.replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]!);
}

async function createDuplicatePair(label: string, incompatibleUnits = false) {
  const digits = `96${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 10)}`;
  const suffix = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const target = await prisma.product.create({
    data: {
      name: `Merge target ${suffix}`,
      sku: `MERGE-TARGET-${suffix}`,
      barcode: `${digits.slice(0, 5)}-${digits.slice(5)}`,
      barcodeNormalized: null,
      baseUnitId: unitId,
      defaultWarehouseId: warehouseId,
      units: {
        create: {
          unitId,
          conversionRate: 1,
          purchasePrice: 7,
          salePrice: 12,
          isDefaultPurchase: true,
          isDefaultSale: true,
        },
      },
    },
  });
  const source = await prisma.product.create({
    data: {
      name: `Merge source ${suffix}`,
      sku: `MERGE-SOURCE-${suffix}`,
      barcode: toPersianDigits(`${digits.slice(0, 4)} ${digits.slice(4)}`),
      barcodeNormalized: null,
      baseUnitId: unitId,
      defaultWarehouseId: warehouseId,
      units: {
        create: [
          {
            unitId,
            conversionRate: 1,
            purchasePrice: 5,
            salePrice: 10,
            isDefaultPurchase: true,
            isDefaultSale: true,
          },
          ...(incompatibleUnits
            ? [
                {
                  unitId: extraUnitId,
                  conversionRate: 10,
                  purchasePrice: 50,
                  salePrice: 100,
                  isDefaultPurchase: false,
                  isDefaultSale: false,
                },
              ]
            : []),
        ],
      },
    },
  });
  productIds.push(target.id, source.id);
  return { source, target, normalizedBarcode: digits };
}

beforeAll(async () => {
  const [admin, unit, warehouse, currency] = await Promise.all([
    prisma.user.findFirst({ where: { role: { name: "Admin" } } }),
    prisma.unit.findFirst({ where: { deletedAt: null, isActive: true } }),
    prisma.warehouse.findFirst({ where: { deletedAt: null, isActive: true } }),
    prisma.currency.findFirst({ where: { deletedAt: null, isBase: true } }),
  ]);
  if (!admin || !unit || !warehouse || !currency) {
    throw new Error("Seeded Admin, unit, warehouse and base currency are required.");
  }

  adminUserId = admin.id;
  unitId = unit.id;
  warehouseId = warehouse.id;
  currencyId = currency.id;
  const extraUnit = await prisma.unit.create({
    data: { name: `Merge test unit ${Date.now()}`, shortName: "MTU" },
  });
  extraUnitId = extraUnit.id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({
    where: { action: "PRODUCT_MERGED", entityId: { in: productIds } },
  });
  await prisma.saleReturn.deleteMany({ where: { id: { in: saleReturnIds } } });
  await prisma.sale.deleteMany({ where: { id: { in: saleIds } } });
  await prisma.purchaseReturn.deleteMany({
    where: { id: { in: purchaseReturnIds } },
  });
  await prisma.purchase.deleteMany({ where: { id: { in: purchaseIds } } });
  await prisma.stockMovement.deleteMany({ where: { productId: { in: productIds } } });
  await prisma.stockLot.deleteMany({ where: { productId: { in: productIds } } });
  await prisma.stockBalance.deleteMany({ where: { productId: { in: productIds } } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.unit.delete({ where: { id: extraUnitId } }).catch(() => undefined);
  await prisma.$disconnect();
});

describe("Admin duplicate product merge", () => {
  it("moves every historical relation and combines stock atomically", async () => {
    const { source, target, normalizedBarcode } = await createDuplicatePair("complete");
    const sourceLot = await prisma.stockLot.create({
      data: {
        productId: source.id,
        warehouseId,
        initialQuantity: 3,
        remainingQuantity: 3,
        unitCost: 5,
        currencyId,
        exchangeRate: 1,
        baseUnitCost: 5,
        sourceType: "PRODUCT_MERGE_TEST",
      },
    });
    await prisma.stockLot.create({
      data: {
        productId: target.id,
        warehouseId,
        initialQuantity: 2,
        remainingQuantity: 2,
        unitCost: 6,
        currencyId,
        exchangeRate: 1,
        baseUnitCost: 6,
        sourceType: "PRODUCT_MERGE_TEST",
      },
    });
    await Promise.all([
      prisma.stockMovement.create({
        data: {
          productId: source.id,
          warehouseId,
          lotId: sourceLot.id,
          type: "ADJUSTMENT_IN",
          quantity: 3,
          unitCost: 5,
          currencyId,
          exchangeRate: 1,
          baseUnitCost: 5,
          referenceType: "PRODUCT_MERGE_TEST",
        },
      }),
    ]);

    const purchase = await prisma.purchase.create({
      data: {
        invoiceNo: `MERGE-P-${Date.now()}`,
        currencyId,
        subtotal: 5,
        total: 5,
        baseCurrencyId: currencyId,
        baseSubtotal: 5,
        baseTotal: 5,
        items: {
          create: {
            productId: source.id,
            warehouseId,
            unitId,
            quantity: 1,
            conversionRate: 1,
            quantityBase: 1,
            unitCost: 5,
            unitCostBase: 5,
            totalCost: 5,
          },
        },
      },
      include: { items: true },
    });
    purchaseIds.push(purchase.id);
    const purchaseReturn = await prisma.purchaseReturn.create({
      data: {
        purchaseId: purchase.id,
        currencyId,
        subtotal: 5,
        baseCurrencyId: currencyId,
        baseSubtotal: 5,
        items: {
          create: {
            purchaseItemId: purchase.items[0]!.id,
            productId: source.id,
            warehouseId,
            quantity: 1,
            quantityBase: 1,
            unitCost: 5,
            unitCostBase: 5,
            totalCost: 5,
          },
        },
      },
    });
    purchaseReturnIds.push(purchaseReturn.id);

    const sale = await prisma.sale.create({
      data: {
        invoiceNo: `MERGE-S-${Date.now()}`,
        currencyId,
        subtotal: 10,
        total: 10,
        baseCurrencyId: currencyId,
        baseSubtotal: 10,
        baseTotal: 10,
        items: {
          create: {
            productId: source.id,
            warehouseId,
            unitId,
            quantity: 1,
            conversionRate: 1,
            quantityBase: 1,
            unitPrice: 10,
            totalPrice: 10,
            netTotalPrice: 10,
            unitCostBase: 5,
            totalCost: 5,
            baseTotalCost: 5,
          },
        },
      },
      include: { items: true },
    });
    saleIds.push(sale.id);
    const saleReturn = await prisma.saleReturn.create({
      data: {
        saleId: sale.id,
        currencyId,
        subtotal: 10,
        baseCurrencyId: currencyId,
        baseSubtotal: 10,
        items: {
          create: {
            saleItemId: sale.items[0]!.id,
            productId: source.id,
            warehouseId,
            quantity: 1,
            quantityBase: 1,
            unitPrice: 10,
            totalPrice: 10,
            unitCostBase: 5,
            totalCost: 5,
            baseTotalCost: 5,
          },
        },
      },
    });
    saleReturnIds.push(saleReturn.id);

    const previewResponse = await adminApp.request(
      `http://localhost/merge-preview?sourceId=${source.id}&targetId=${target.id}`,
    );
    expect(previewResponse.status).toBe(200);
    const preview = (await previewResponse.json() as any).data;
    expect(preview.canMerge).toBe(true);
    expect(preview.normalizedBarcode).toBe(normalizedBarcode);
    expect(preview.combined).toMatchObject({ quantityBase: 5, valueBase: 27 });
    expect(preview.source.counts).toMatchObject({
      stockLots: 1,
      stockMovements: 1,
      purchaseItems: 1,
      purchaseReturnItems: 1,
      saleItems: 1,
      saleReturnItems: 1,
    });

    const denied = await productsRoute.request(
      `http://localhost/merge-preview?sourceId=${source.id}&targetId=${target.id}`,
    );
    expect(denied.status).toBe(403);

    const merged = await adminApp.request("http://localhost/merge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceId: source.id, targetId: target.id, confirm: true }),
    });
    expect(merged.status).toBe(200);

    const [sourceAfter, targetAfter, targetBalance, relationCounts, auditCount] =
      await Promise.all([
        prisma.product.findUniqueOrThrow({ where: { id: source.id } }),
        prisma.product.findUniqueOrThrow({ where: { id: target.id } }),
        prisma.stockBalance.findUniqueOrThrow({
          where: {
            productId_warehouseId: { productId: target.id, warehouseId },
          },
        }),
        Promise.all([
          prisma.stockLot.count({ where: { productId: target.id } }),
          prisma.stockMovement.count({ where: { productId: target.id } }),
          prisma.purchaseItem.count({ where: { productId: target.id } }),
          prisma.purchaseReturnItem.count({ where: { productId: target.id } }),
          prisma.saleItem.count({ where: { productId: target.id } }),
          prisma.saleReturnItem.count({ where: { productId: target.id } }),
        ]),
        prisma.auditLog.count({
          where: { action: "PRODUCT_MERGED", entityId: target.id },
        }),
      ]);

    expect(sourceAfter).toMatchObject({
      isActive: false,
      barcode: null,
      barcodeNormalized: null,
      sku: null,
    });
    expect(sourceAfter.deletedAt).not.toBeNull();
    expect(targetAfter.barcodeNormalized).toBe(normalizedBarcode);
    expect(Number(targetBalance.quantityBase)).toBe(5);
    expect(Number(targetBalance.valueBase)).toBe(27);
    expect(relationCounts).toEqual([2, 1, 1, 1, 1, 1]);
    expect(await prisma.productUnit.count({ where: { productId: source.id } })).toBe(0);
    expect(auditCount).toBe(1);
  });

  it("blocks merge when product units or conversion rates differ", async () => {
    const { source, target } = await createDuplicatePair("blocked", true);
    const previewResponse = await adminApp.request(
      `http://localhost/merge-preview?sourceId=${source.id}&targetId=${target.id}`,
    );
    expect(previewResponse.status).toBe(200);
    const preview = (await previewResponse.json() as any).data;
    expect(preview.canMerge).toBe(false);
    expect(preview.blockers).toContain("واحدها یا نسبت تبدیل دو محصول یکسان نیست");

    const mergeResponse = await adminApp.request("http://localhost/merge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceId: source.id, targetId: target.id, confirm: true }),
    });
    expect(mergeResponse.status).toBe(409);
    expect(await prisma.product.findUniqueOrThrow({ where: { id: source.id } })).toMatchObject({
      deletedAt: null,
      isActive: true,
    });
  });
});
