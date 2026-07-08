import { Hono } from "hono";
import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { zodError } from "../../lib/api";
import { getAuthUser, writeAudit } from "../../lib/auth";
import { resolveCurrencySnapshot } from "../../lib/currency-rates";
import { StockMovementType } from "../../generated/prisma/enums";
import { createPaginationMeta, getPagePagination } from "../../lib/pagination";
import { getRecentDateRange } from "../../lib/recent-date-range";
import { normalizeBarcodeText } from "../../lib/barcode";

export const inventoryRoute = new Hono();

const openingStockSchema = z.object({
  productId: z.string().min(1),
  warehouseId: z.string().min(1),
  quantity: z.coerce.number().positive(),
  unitCost: z.coerce.number().nonnegative(),
  currencyId: z.string().optional().nullable(),
  expiryDate: z.string().trim().optional().nullable(),
  note: z.string().trim().max(500).optional().nullable()
});

const adjustmentSchema = z.object({
  productId: z.string().min(1),
  warehouseId: z.string().min(1),
  lotId: z.string().trim().optional().nullable(),
  unitId: z.string().trim().optional().nullable(),
  type: z.enum(["ADJUSTMENT_IN", "ADJUSTMENT_OUT", "DAMAGE"]),
  quantity: z.coerce.number().positive(),
  unitCost: z.coerce.number().nonnegative().optional().nullable(),
  currencyId: z.string().optional().nullable(),
  expiryDate: z.string().trim().optional().nullable(),
  note: z.string().trim().max(500).optional().nullable()
});

const transferSchema = z.object({
  productId: z.string().min(1),
  fromWarehouseId: z.string().min(1),
  toWarehouseId: z.string().min(1),
  lotId: z.string().trim().optional().nullable(),
  quantity: z.coerce.number().positive(),
  note: z.string().trim().max(500).optional().nullable()
});

const cancelMovementSchema = z.object({
  reason: z.string().trim().max(500).optional().nullable()
});

const updateOpeningStockSchema = z.object({
  quantity: z.coerce.number().positive(),
  unitCost: z.coerce.number().nonnegative(),
  currencyId: z.string().optional().nullable(),
  expiryDate: z.string().trim().optional().nullable(),
  note: z.string().trim().max(500).optional().nullable()
});

function parseExpiryDate(value: string | null | undefined) {
  if (!value) return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "INVALID_DATE";
  }

  return date;
}

async function ensureProductAndWarehouse(productId: string, warehouseId: string) {
  const [product, warehouse] = await Promise.all([
    prisma.product.findUnique({
      where: { id: productId },
      include: { units: true, baseUnit: true }
    }),
    prisma.warehouse.findUnique({ where: { id: warehouseId } })
  ]);

  return {
    product,
    warehouse
  };
}

function resolveProductUnitConversion(
  product: NonNullable<Awaited<ReturnType<typeof ensureProductAndWarehouse>>["product"]>,
  unitId: string | null | undefined
) {
  const selectedUnitId = unitId || product.baseUnitId;
  const productUnit = product.units.find((item) => item.unitId === selectedUnitId);

  if (selectedUnitId === product.baseUnitId) {
    return {
      unitId: selectedUnitId,
      conversionRate: 1,
      unitName: product.baseUnit?.shortName || product.baseUnit?.name || "base"
    };
  }

  if (!productUnit) {
    throw new Error("Selected unit is not configured for this product");
  }

  return {
    unitId: selectedUnitId,
    conversionRate: Number(productUnit.conversionRate || 1),
    unitName: product.baseUnit?.shortName || product.baseUnit?.name || "base"
  };
}

function buildStockMovementSearchWhere(search: string | null | undefined) {
  const rawSearch = (search || "").trim();
  const barcodeSearch = normalizeBarcodeText(rawSearch);

  if (!rawSearch) return {};

  return {
    OR: [
      { referenceId: { contains: rawSearch, mode: "insensitive" as const } },
      { referenceType: { contains: rawSearch, mode: "insensitive" as const } },
      { note: { contains: rawSearch, mode: "insensitive" as const } },
      { product: { name: { contains: rawSearch, mode: "insensitive" as const } } },
      { product: { sku: { contains: rawSearch, mode: "insensitive" as const } } },
      { product: { barcode: rawSearch } },
      { product: { barcode: { contains: rawSearch, mode: "insensitive" as const } } },
      { warehouse: { name: { contains: rawSearch, mode: "insensitive" as const } } },
      { lot: { id: { contains: rawSearch, mode: "insensitive" as const } } },
      ...(barcodeSearch
        ? [
            { product: { barcode: barcodeSearch } },
            { product: { barcodeNormalized: barcodeSearch } },
            { product: { barcode: { contains: barcodeSearch, mode: "insensitive" as const } } },
            { product: { barcodeNormalized: { contains: barcodeSearch, mode: "insensitive" as const } } },
            { product: { sku: { contains: barcodeSearch, mode: "insensitive" as const } } }
          ]
        : [])
    ]
  };
}

function buildStockBalanceSearchWhere(search: string | null | undefined) {
  const rawSearch = (search || "").trim();
  const barcodeSearch = normalizeBarcodeText(rawSearch);

  if (!rawSearch) return {};

  return {
    OR: [
      { product: { name: { contains: rawSearch, mode: "insensitive" as const } } },
      { product: { sku: { contains: rawSearch, mode: "insensitive" as const } } },
      { product: { barcode: rawSearch } },
      { product: { barcode: { contains: rawSearch, mode: "insensitive" as const } } },
      { warehouse: { name: { contains: rawSearch, mode: "insensitive" as const } } },
      ...(barcodeSearch
        ? [
            { product: { barcode: barcodeSearch } },
            { product: { barcodeNormalized: barcodeSearch } },
            { product: { barcode: { contains: barcodeSearch, mode: "insensitive" as const } } },
            { product: { barcodeNormalized: { contains: barcodeSearch, mode: "insensitive" as const } } },
            { product: { sku: { contains: barcodeSearch, mode: "insensitive" as const } } }
          ]
        : [])
    ]
  };
}

inventoryRoute.get("/stock", async (c) => {
  const productId = c.req.query("productId");
  const warehouseId = c.req.query("warehouseId");
  const search = c.req.query("search");
  const sortBy = c.req.query("sortBy");
  const sortOrder = c.req.query("sortOrder") === "asc" ? "asc" : "desc";
  const pagination = getPagePagination(c, { defaultLimit: 20, maxLimit: 100 });
  const where = {
    quantityBase: { gt: 0 },
    ...(productId ? { productId } : {}),
    ...(warehouseId ? { warehouseId } : {}),
    ...buildStockBalanceSearchWhere(search)
  };
  const orderBy: Prisma.StockBalanceOrderByWithRelationInput[] =
    sortBy === "quantity"
      ? [{ quantityBase: sortOrder }, { product: { name: "asc" } }]
      : sortBy === "value"
        ? [{ valueBase: sortOrder }, { product: { name: "asc" } }]
        : [{ product: { name: "asc" } }, { warehouse: { name: "asc" } }];

  const [balances, total] = await Promise.all([
    prisma.stockBalance.findMany({
    where,
    include: {
      product: {
        include: {
          baseUnit: true
        }
      },
      warehouse: true
    },
    orderBy,
    skip: pagination.skip,
    take: pagination.limit
  }),
    prisma.stockBalance.count({ where })
  ]);

  return c.json({
    data: balances.map((balance) => ({
      productId: balance.productId,
      productName: balance.product.name,
      barcode: balance.product.barcode,
      warehouseId: balance.warehouseId,
      warehouseName: balance.warehouse.name,
      baseUnitName: balance.product.baseUnit.name,
      totalQuantity: Number(balance.quantityBase),
      valueBase: Number(balance.valueBase),
      earliestExpiryAt: balance.earliestExpiryAt,
      // Kept for compatibility with the existing inventory table. Full lot detail
      // is loaded only when the user opens the lot view.
      lots: balance.earliestExpiryAt ? [{ expiryDate: balance.earliestExpiryAt }] : []
    })),
    pagination: createPaginationMeta({ ...pagination, total })
  });
});

inventoryRoute.get("/lots", async (c) => {
  const productId = c.req.query("productId");
  const warehouseId = c.req.query("warehouseId");

  const pagination = getPagePagination(c);
  const where = {
    ...(productId ? { productId } : {}),
    ...(warehouseId ? { warehouseId } : {})
  };
  const [lots, total] = await Promise.all([
    prisma.stockLot.findMany({
    where,
    include: {
      product: true,
      warehouse: true,
      movements: {
        orderBy: {
          createdAt: "desc"
        }
      }
    },
    orderBy: [
      {
        expiryDate: "asc"
      },
      {
        createdAt: "asc"
      }
    ],
    skip: pagination.skip,
    take: pagination.limit
  }),
    prisma.stockLot.count({ where })
  ]);

  return c.json({ data: lots, pagination: createPaginationMeta({ ...pagination, total }) });
});

inventoryRoute.get("/movements", async (c) => {
  const type = c.req.query("type");
  const productId = c.req.query("productId");
  const warehouseId = c.req.query("warehouseId");
  const referenceId = c.req.query("referenceId");
  const search = c.req.query("search");
  const pagination = getPagePagination(c, { defaultLimit: 100, maxLimit: 200 });
  const allowedTypes = Object.values(StockMovementType);
  const movementType = allowedTypes.includes(type as StockMovementType)
    ? (type as StockMovementType)
    : undefined;

  const where = {
      createdAt: getRecentDateRange(c),
      ...(movementType ? { type: movementType } : {}),
      ...(productId ? { productId } : {}),
      ...(warehouseId ? { warehouseId } : {}),
      ...(referenceId ? { referenceId } : {}),
      ...buildStockMovementSearchWhere(search)
  };
  const [movements, total] = await Promise.all([
    prisma.stockMovement.findMany({
    where,
    include: {
      product: {
        include: {
          baseUnit: true
        }
      },
      warehouse: true,
      lot: true,
      createdByUser: true
    },
    orderBy: {
      createdAt: "desc"
    },
    skip: pagination.skip,
    take: pagination.limit
  }),
    prisma.stockMovement.count({ where })
  ]);

  return c.json({ data: movements, pagination: createPaginationMeta({ ...pagination, total }) });
});

inventoryRoute.get("/transfer-reports", async (c) => {
  const pagination = getPagePagination(c, { defaultLimit: 100, maxLimit: 200 });
  const search = c.req.query("search");
  const where = {
      createdAt: getRecentDateRange(c),
      type: {
        in: [StockMovementType.TRANSFER_OUT, StockMovementType.TRANSFER_IN]
      },
      ...buildStockMovementSearchWhere(search)
  };
  const [movements, total] = await Promise.all([
    prisma.stockMovement.findMany({
    where,
    include: {
      product: {
        include: {
          baseUnit: true
        }
      },
      warehouse: true,
      lot: true,
      createdByUser: true
    },
    orderBy: {
      createdAt: "desc"
    },
    skip: pagination.skip,
    take: pagination.limit
  }),
    prisma.stockMovement.count({ where })
  ]);

  return c.json({ data: movements, pagination: createPaginationMeta({ ...pagination, total }) });
});

inventoryRoute.get("/damage-reports", async (c) => {
  const pagination = getPagePagination(c, { defaultLimit: 100, maxLimit: 200 });
  const where = {
      createdAt: getRecentDateRange(c),
      type: StockMovementType.DAMAGE
  };
  const [movements, total] = await Promise.all([
    prisma.stockMovement.findMany({
    where,
    include: {
      product: {
        include: {
          baseUnit: true
        }
      },
      warehouse: true,
      lot: true,
      createdByUser: true
    },
    orderBy: {
      createdAt: "desc"
    },
    skip: pagination.skip,
    take: pagination.limit
  }),
    prisma.stockMovement.count({ where })
  ]);

  return c.json({ data: movements, pagination: createPaginationMeta({ ...pagination, total }) });
});

inventoryRoute.post("/movements/:id/cancel", async (c) => {
  const authUser = getAuthUser(c);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const parsed = cancelMovementSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const movement = await prisma.stockMovement.findUnique({
    where: { id },
    include: {
      lot: true
    }
  });

  if (!movement) {
    return c.json({ message: "Stock movement not found" }, 404);
  }

  if (movement.referenceType?.endsWith("_CANCEL")) {
    return c.json({ message: "Cancellation movement cannot be cancelled again" }, 400);
  }

  if (
    movement.type !== StockMovementType.OPENING_STOCK &&
    movement.type !== StockMovementType.ADJUSTMENT_IN &&
    movement.type !== StockMovementType.ADJUSTMENT_OUT &&
    movement.type !== StockMovementType.DAMAGE
  ) {
    return c.json(
      {
        message:
          "This movement must be cancelled from its source document or transfer reference"
      },
      400
    );
  }

  const existingCancel = await prisma.stockMovement.findFirst({
    where: {
      referenceType: `${movement.type}_CANCEL`,
      referenceId: movement.id
    }
  });

  if (existingCancel) {
    return c.json({ message: "Stock movement is already cancelled" }, 400);
  }

  if (!movement.lotId) {
    return c.json({ message: "Stock movement has no lot to reverse" }, 400);
  }

  const amount = Number(movement.quantity);
  const addedStock =
    movement.type === StockMovementType.OPENING_STOCK ||
    movement.type === StockMovementType.ADJUSTMENT_IN;

  if (addedStock && (!movement.lot || Number(movement.lot.remainingQuantity) < amount)) {
    return c.json(
      {
        message:
          "Stock movement cannot be cancelled because this lot was already used or transferred"
      },
      400
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.stockLot.update({
      where: { id: movement.lotId! },
      data: addedStock
        ? { remainingQuantity: { decrement: amount } }
        : { remainingQuantity: { increment: amount } }
    });

    const cancelMovement = await tx.stockMovement.create({
      data: {
        productId: movement.productId,
        warehouseId: movement.warehouseId,
        lotId: movement.lotId,
        type: addedStock
          ? StockMovementType.ADJUSTMENT_OUT
          : StockMovementType.ADJUSTMENT_IN,
        quantity: amount,
        unitCost: movement.unitCost,
        currencyId: movement.currencyId,
        exchangeRate: movement.exchangeRate,
        baseUnitCost: movement.baseUnitCost,
        referenceType: `${movement.type}_CANCEL`,
        referenceId: movement.id,
        note: parsed.data.reason ?? "Stock movement cancellation",
        createdByUserId: authUser?.id || null
      }
    });

    return {
      movement: cancelMovement
    };
  });

  await writeAudit(c, {
    action: "INVENTORY_MOVEMENT_CANCELLED",
    entityType: "StockMovement",
    entityId: movement.id,
    metadata: {
      reason: parsed.data.reason ?? null
    }
  });

  return c.json({ data: result });
});

inventoryRoute.post("/transfers/:referenceId/cancel", async (c) => {
  const authUser = getAuthUser(c);
  const referenceId = c.req.param("referenceId");
  const body = await c.req.json().catch(() => ({}));
  const parsed = cancelMovementSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const movements = await prisma.stockMovement.findMany({
    where: {
      referenceType: "TRANSFER",
      referenceId,
      type: {
        in: [StockMovementType.TRANSFER_OUT, StockMovementType.TRANSFER_IN]
      }
    },
    include: {
      lot: true
    }
  });

  if (movements.length === 0) {
    return c.json({ message: "Inventory transfer not found" }, 404);
  }

  const existingCancel = await prisma.stockMovement.findFirst({
    where: {
      referenceType: "TRANSFER_CANCEL",
      referenceId
    }
  });

  if (existingCancel) {
    return c.json({ message: "Inventory transfer is already cancelled" }, 400);
  }

  const transferIns = movements.filter(
    (movement) => movement.type === StockMovementType.TRANSFER_IN
  );

  for (const movement of transferIns) {
    if (!movement.lot || Number(movement.lot.remainingQuantity) < Number(movement.quantity)) {
      return c.json(
        {
          message:
            "Inventory transfer cannot be cancelled because destination stock was already used"
        },
        400
      );
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const cancelMovements = [];

    for (const movement of movements) {
      const amount = Number(movement.quantity);
      const wasTransferIn = movement.type === StockMovementType.TRANSFER_IN;

      if (!movement.lotId) {
        throw new Error("Transfer movement has no lot to reverse");
      }

      await tx.stockLot.update({
        where: { id: movement.lotId },
        data: wasTransferIn
          ? { remainingQuantity: { decrement: amount } }
          : { remainingQuantity: { increment: amount } }
      });

      const cancelMovement = await tx.stockMovement.create({
        data: {
          productId: movement.productId,
          warehouseId: movement.warehouseId,
          lotId: movement.lotId,
          type: wasTransferIn
            ? StockMovementType.TRANSFER_OUT
            : StockMovementType.TRANSFER_IN,
          quantity: amount,
          unitCost: movement.unitCost,
          currencyId: movement.currencyId,
          exchangeRate: movement.exchangeRate,
          baseUnitCost: movement.baseUnitCost,
          referenceType: "TRANSFER_CANCEL",
          referenceId,
          note: parsed.data.reason ?? "Inventory transfer cancellation",
          createdByUserId: authUser?.id || null
        }
      });

      cancelMovements.push(cancelMovement);
    }

    return {
      referenceId,
      movements: cancelMovements
    };
  });

  await writeAudit(c, {
    action: "INVENTORY_TRANSFER_CANCELLED",
    entityType: "StockMovement",
    entityId: referenceId,
    metadata: {
      reason: parsed.data.reason ?? null
    }
  });

  return c.json({ data: result });
});

inventoryRoute.post("/opening-stock", async (c) => {
  const authUser = getAuthUser(c);
  const body = await c.req.json().catch(() => null);
  const parsed = openingStockSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const product = await prisma.product.findUnique({
    where: {
      id: parsed.data.productId
    }
  });

  if (!product) {
    return c.json({ message: "Product not found" }, 404);
  }

  const warehouse = await prisma.warehouse.findUnique({
    where: {
      id: parsed.data.warehouseId
    }
  });

  if (!warehouse) {
    return c.json({ message: "Warehouse not found" }, 404);
  }

  const expiryDate = parseExpiryDate(parsed.data.expiryDate);

  if (expiryDate === "INVALID_DATE") {
    return c.json({ message: "Invalid expiryDate" }, 400);
  }

  if (product.hasExpiry && !expiryDate) {
    return c.json(
      {
        message: "Expiry date is required for this product"
      },
      400
    );
  }

  let stockSnapshot;
  try {
    stockSnapshot = parsed.data.currencyId
      ? await resolveCurrencySnapshot(prisma, parsed.data.currencyId)
      : { exchangeRate: 1, baseCurrencyId: null };
  } catch (error) {
    return c.json(
      { message: error instanceof Error ? error.message : "Currency rate could not be resolved" },
      400
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const lot = await tx.stockLot.create({
      data: {
        productId: parsed.data.productId,
        warehouseId: parsed.data.warehouseId,
        expiryDate,
        initialQuantity: parsed.data.quantity,
        remainingQuantity: parsed.data.quantity,
        unitCost: parsed.data.unitCost,
        currencyId: parsed.data.currencyId ?? null,
        exchangeRate: stockSnapshot.exchangeRate,
        baseUnitCost: parsed.data.unitCost * stockSnapshot.exchangeRate,
        sourceType: "OPENING_STOCK",
        note: parsed.data.note ?? null
      }
    });

    const movement = await tx.stockMovement.create({
      data: {
        productId: parsed.data.productId,
        warehouseId: parsed.data.warehouseId,
        lotId: lot.id,
        type: StockMovementType.OPENING_STOCK,
        quantity: parsed.data.quantity,
        unitCost: parsed.data.unitCost,
        currencyId: parsed.data.currencyId ?? null,
        exchangeRate: stockSnapshot.exchangeRate,
        baseUnitCost: parsed.data.unitCost * stockSnapshot.exchangeRate,
        referenceType: "OPENING_STOCK",
        referenceId: lot.id,
        note: parsed.data.note ?? null,
        createdByUserId: authUser?.id || null
      }
    });

    return {
      lot,
      movement
    };
  });

  await writeAudit(c, {
    action: "INVENTORY_OPENING_STOCK",
    entityType: "StockLot",
    entityId: result.lot.id,
    metadata: {
      productId: parsed.data.productId,
      warehouseId: parsed.data.warehouseId,
      quantity: parsed.data.quantity
    }
  });

  return c.json({ data: result }, 201);
});

inventoryRoute.patch("/opening-stock/:movementId", async (c) => {
  const authUser = getAuthUser(c);
  const movementId = c.req.param("movementId");
  const body = await c.req.json().catch(() => null);
  const parsed = updateOpeningStockSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const movement = await prisma.stockMovement.findUnique({
    where: { id: movementId },
    include: {
      product: true,
      lot: true
    }
  });

  if (!movement || movement.type !== StockMovementType.OPENING_STOCK || !movement.lot) {
    return c.json({ message: "Opening stock movement not found" }, 404);
  }

  const existingCancel = await prisma.stockMovement.findFirst({
    where: {
      referenceType: "OPENING_STOCK_CANCEL",
      referenceId: movement.id
    }
  });

  if (existingCancel) {
    return c.json({ message: "Cancelled opening stock cannot be edited" }, 400);
  }

  const expiryDate = parseExpiryDate(parsed.data.expiryDate);
  if (expiryDate === "INVALID_DATE") {
    return c.json({ message: "Invalid expiryDate" }, 400);
  }

  if (movement.product.hasExpiry && !expiryDate) {
    return c.json({ message: "Expiry date is required for this product" }, 400);
  }

  const oldInitial = Number(movement.lot.initialQuantity);
  const oldRemaining = Number(movement.lot.remainingQuantity);
  const usedQuantity = Math.max(0, oldInitial - oldRemaining);
  const newQuantity = parsed.data.quantity;

  if (newQuantity < usedQuantity) {
    return c.json(
      {
        message: "Opening stock cannot be reduced below already used quantity",
        usedQuantity
      },
      400
    );
  }

  const newRemaining = newQuantity - usedQuantity;
  let stockSnapshot;
  try {
    stockSnapshot = parsed.data.currencyId
      ? await resolveCurrencySnapshot(prisma, parsed.data.currencyId)
      : { exchangeRate: 1, baseCurrencyId: null };
  } catch (error) {
    return c.json(
      { message: error instanceof Error ? error.message : "Currency rate could not be resolved" },
      400
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const lot = await tx.stockLot.update({
      where: { id: movement.lotId! },
      data: {
        initialQuantity: newQuantity,
        remainingQuantity: newRemaining,
        unitCost: parsed.data.unitCost,
        currencyId: parsed.data.currencyId ?? null,
        exchangeRate: stockSnapshot.exchangeRate,
        baseUnitCost: parsed.data.unitCost * stockSnapshot.exchangeRate,
        expiryDate,
        note: parsed.data.note ?? null
      }
    });

    const updatedMovement = await tx.stockMovement.update({
      where: { id: movement.id },
      data: {
        quantity: newQuantity,
        unitCost: parsed.data.unitCost,
        currencyId: parsed.data.currencyId ?? null,
        exchangeRate: stockSnapshot.exchangeRate,
        baseUnitCost: parsed.data.unitCost * stockSnapshot.exchangeRate,
        note: parsed.data.note ?? null
      },
      include: {
        product: {
          include: {
            baseUnit: true
          }
        },
        warehouse: true,
        lot: true,
        createdByUser: true
      }
    });

    return { lot, movement: updatedMovement };
  });

  await writeAudit(c, {
    action: "INVENTORY_OPENING_STOCK_UPDATED",
    entityType: "StockMovement",
    entityId: movement.id,
    metadata: {
      oldQuantity: oldInitial,
      newQuantity,
      usedQuantity,
      updatedByUserId: authUser?.id || null
    }
  });

  return c.json({ data: result });
});

inventoryRoute.post("/adjustments", async (c) => {
  const authUser = getAuthUser(c);
  const body = await c.req.json().catch(() => null);
  const parsed = adjustmentSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const { product, warehouse } = await ensureProductAndWarehouse(
    parsed.data.productId,
    parsed.data.warehouseId
  );

  if (!product) {
    return c.json({ message: "Product not found" }, 404);
  }

  if (!warehouse) {
    return c.json({ message: "Warehouse not found" }, 404);
  }

  let unitConversion;
  try {
    unitConversion = resolveProductUnitConversion(product, parsed.data.unitId);
  } catch (error) {
    return c.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Selected unit is not configured for this product"
      },
      400
    );
  }

  const quantityBase = parsed.data.quantity * unitConversion.conversionRate;
  const unitCostBase =
    parsed.data.unitCost !== null && parsed.data.unitCost !== undefined
      ? Number(parsed.data.unitCost) / unitConversion.conversionRate
      : 0;

  const expiryDate = parseExpiryDate(parsed.data.expiryDate);

  if (expiryDate === "INVALID_DATE") {
    return c.json({ message: "Invalid expiryDate" }, 400);
  }

  if (parsed.data.type === "ADJUSTMENT_IN") {
    let stockSnapshot;
    try {
      stockSnapshot = parsed.data.currencyId
        ? await resolveCurrencySnapshot(prisma, parsed.data.currencyId)
        : { exchangeRate: 1, baseCurrencyId: null };
    } catch (error) {
      return c.json(
        { message: error instanceof Error ? error.message : "Currency rate could not be resolved" },
        400
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const lot = await tx.stockLot.create({
        data: {
          productId: parsed.data.productId,
          warehouseId: parsed.data.warehouseId,
          expiryDate,
          initialQuantity: quantityBase,
          remainingQuantity: quantityBase,
          unitCost: unitCostBase,
          currencyId: parsed.data.currencyId ?? null,
          exchangeRate: stockSnapshot.exchangeRate,
          baseUnitCost: unitCostBase * stockSnapshot.exchangeRate,
          sourceType: "ADJUSTMENT_IN",
          note: [
            parsed.data.note ?? null,
            `واحد ثبت: ${parsed.data.quantity} x ${unitConversion.conversionRate}`
          ].filter(Boolean).join(" | ") || null
        }
      });

      const movement = await tx.stockMovement.create({
        data: {
          productId: parsed.data.productId,
          warehouseId: parsed.data.warehouseId,
          lotId: lot.id,
          type: StockMovementType.ADJUSTMENT_IN,
          quantity: quantityBase,
          unitCost: unitCostBase,
          currencyId: parsed.data.currencyId ?? null,
          exchangeRate: stockSnapshot.exchangeRate,
          baseUnitCost: unitCostBase * stockSnapshot.exchangeRate,
          referenceType: "ADJUSTMENT",
          referenceId: lot.id,
          note: [
            parsed.data.note ?? null,
            `واحد ثبت: ${parsed.data.quantity} x ${unitConversion.conversionRate}`
          ].filter(Boolean).join(" | ") || null,
          createdByUserId: authUser?.id || null
        }
      });

      return { lot, movement };
    });

    await writeAudit(c, {
      action: "INVENTORY_ADJUSTMENT_IN",
      entityType: "StockLot",
      entityId: result.lot.id,
      metadata: {
        productId: parsed.data.productId,
        warehouseId: parsed.data.warehouseId,
        quantity: quantityBase,
        enteredQuantity: parsed.data.quantity,
        enteredUnitId: unitConversion.unitId,
        conversionRate: unitConversion.conversionRate
      }
    });

    return c.json({ data: result }, 201);
  }

  const lots = await prisma.stockLot.findMany({
    where: {
      productId: parsed.data.productId,
      warehouseId: parsed.data.warehouseId,
      remainingQuantity: { gt: 0 },
      ...(parsed.data.lotId ? { id: parsed.data.lotId } : {})
    },
    orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }]
  });

  let remaining = quantityBase;
  const allocations: Array<{ lot: (typeof lots)[number]; quantity: number }> = [];

  for (const lot of lots) {
    if (remaining <= 0) break;

    const available = Number(lot.remainingQuantity);
    const quantity = Math.min(available, remaining);

    allocations.push({ lot, quantity });
    remaining -= quantity;
  }

  if (remaining > 0) {
    return c.json(
      {
        message: "Not enough stock for adjustment",
        required: quantityBase,
        enteredQuantity: parsed.data.quantity,
        conversionRate: unitConversion.conversionRate,
        missing: remaining
      },
      400
    );
  }

  const movementType =
    parsed.data.type === "DAMAGE"
      ? StockMovementType.DAMAGE
      : StockMovementType.ADJUSTMENT_OUT;

  const result = await prisma.$transaction(async (tx) => {
    const movements = [];

    for (const allocation of allocations) {
      await tx.stockLot.update({
        where: { id: allocation.lot.id },
        data: {
          remainingQuantity: {
            decrement: allocation.quantity
          }
        }
      });

      const movement = await tx.stockMovement.create({
        data: {
          productId: parsed.data.productId,
          warehouseId: parsed.data.warehouseId,
          lotId: allocation.lot.id,
          type: movementType,
          quantity: allocation.quantity,
          unitCost: allocation.lot.unitCost,
          currencyId: allocation.lot.currencyId,
          exchangeRate: allocation.lot.exchangeRate,
          baseUnitCost: allocation.lot.baseUnitCost,
          referenceType: parsed.data.type,
          referenceId: allocation.lot.id,
          note: [
            parsed.data.note ?? null,
            `واحد ثبت: ${parsed.data.quantity} x ${unitConversion.conversionRate}`
          ].filter(Boolean).join(" | ") || null,
          createdByUserId: authUser?.id || null
        }
      });

      movements.push(movement);
    }

    return { movements };
  });

  await writeAudit(c, {
    action: parsed.data.type === "DAMAGE" ? "INVENTORY_DAMAGE" : "INVENTORY_ADJUSTMENT_OUT",
    entityType: "StockMovement",
    metadata: {
      productId: parsed.data.productId,
      warehouseId: parsed.data.warehouseId,
      quantity: quantityBase,
      enteredQuantity: parsed.data.quantity,
      enteredUnitId: unitConversion.unitId,
      conversionRate: unitConversion.conversionRate
    }
  });

  return c.json({ data: result }, 201);
});

inventoryRoute.post("/transfers", async (c) => {
  const authUser = getAuthUser(c);
  const body = await c.req.json().catch(() => null);
  const parsed = transferSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  if (parsed.data.fromWarehouseId === parsed.data.toWarehouseId) {
    return c.json({ message: "Source and destination warehouses must be different" }, 400);
  }

  const [product, fromWarehouse, toWarehouse] = await Promise.all([
    prisma.product.findUnique({ where: { id: parsed.data.productId } }),
    prisma.warehouse.findUnique({ where: { id: parsed.data.fromWarehouseId } }),
    prisma.warehouse.findUnique({ where: { id: parsed.data.toWarehouseId } })
  ]);

  if (!product) {
    return c.json({ message: "Product not found" }, 404);
  }

  if (!fromWarehouse || !toWarehouse) {
    return c.json({ message: "Warehouse not found" }, 404);
  }

  const lots = await prisma.stockLot.findMany({
    where: {
      productId: parsed.data.productId,
      warehouseId: parsed.data.fromWarehouseId,
      remainingQuantity: { gt: 0 },
      ...(parsed.data.lotId ? { id: parsed.data.lotId } : {})
    },
    orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }]
  });

  let remaining = parsed.data.quantity;
  const allocations: Array<{ lot: (typeof lots)[number]; quantity: number }> = [];

  for (const lot of lots) {
    if (remaining <= 0) break;

    const available = Number(lot.remainingQuantity);
    const quantity = Math.min(available, remaining);

    allocations.push({ lot, quantity });
    remaining -= quantity;
  }

  if (remaining > 0) {
    return c.json(
      {
        message: "Not enough stock for transfer",
        required: parsed.data.quantity,
        missing: remaining
      },
      400
    );
  }

  const referenceId = `TRANSFER-${Date.now()}`;

  const result = await prisma.$transaction(async (tx) => {
    const movements = [];
    const destinationLots = [];

    for (const allocation of allocations) {
      await tx.stockLot.update({
        where: { id: allocation.lot.id },
        data: {
          remainingQuantity: {
            decrement: allocation.quantity
          }
        }
      });

      const destinationLot = await tx.stockLot.create({
        data: {
          productId: parsed.data.productId,
          warehouseId: parsed.data.toWarehouseId,
          expiryDate: allocation.lot.expiryDate,
          initialQuantity: allocation.quantity,
          remainingQuantity: allocation.quantity,
          unitCost: allocation.lot.unitCost,
          currencyId: allocation.lot.currencyId,
          exchangeRate: allocation.lot.exchangeRate,
          baseUnitCost: allocation.lot.baseUnitCost,
          sourceType: "TRANSFER",
          sourceId: allocation.lot.id,
          note: parsed.data.note ?? null
        }
      });

      const transferOut = await tx.stockMovement.create({
        data: {
          productId: parsed.data.productId,
          warehouseId: parsed.data.fromWarehouseId,
          lotId: allocation.lot.id,
          type: StockMovementType.TRANSFER_OUT,
          quantity: allocation.quantity,
          unitCost: allocation.lot.unitCost,
          currencyId: allocation.lot.currencyId,
          exchangeRate: allocation.lot.exchangeRate,
          baseUnitCost: allocation.lot.baseUnitCost,
          referenceType: "TRANSFER",
          referenceId,
          note: parsed.data.note ?? null,
          createdByUserId: authUser?.id || null
        }
      });

      const transferIn = await tx.stockMovement.create({
        data: {
          productId: parsed.data.productId,
          warehouseId: parsed.data.toWarehouseId,
          lotId: destinationLot.id,
          type: StockMovementType.TRANSFER_IN,
          quantity: allocation.quantity,
          unitCost: allocation.lot.unitCost,
          currencyId: allocation.lot.currencyId,
          referenceType: "TRANSFER",
          referenceId,
          note: parsed.data.note ?? null,
          createdByUserId: authUser?.id || null
        }
      });

      destinationLots.push(destinationLot);
      movements.push(transferOut, transferIn);
    }

    return {
      referenceId,
      destinationLots,
      movements
    };
  });

  await writeAudit(c, {
    action: "INVENTORY_TRANSFER",
    entityType: "StockMovement",
    entityId: result.referenceId,
    metadata: {
      productId: parsed.data.productId,
      fromWarehouseId: parsed.data.fromWarehouseId,
      toWarehouseId: parsed.data.toWarehouseId,
      quantity: parsed.data.quantity
    }
  });

  return c.json({ data: result }, 201);
});
