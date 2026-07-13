import { Hono } from "hono";
import { Prisma } from "../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { cacheGetJson, cacheSetJson } from "../../lib/cache";

export const alertsRoute = new Hono();

function toNumber(value: unknown) {
  return Number(value ?? 0);
}

function getExpiryDaysFromQuery(value: string | undefined) {
  const days = Number(value ?? 30);

  if (Number.isNaN(days) || days < 1) {
    return 30;
  }

  return Math.min(days, 365);
}

function severityRank(severity: string) {
  const ranks: Record<string, number> = {
    critical: 1,
    warning: 2,
    info: 3
  };

  return ranks[severity] ?? 9;
}

alertsRoute.get("/", async (c) => {
  const days = getExpiryDaysFromQuery(c.req.query("days"));
  const highStockMultiplier = Math.min(
    20,
    Math.max(2, Number(c.req.query("highStockMultiplier") || 5))
  );
  const cacheKey = `alerts:all:v2:${days}:${highStockMultiplier}`;
  const cached = await cacheGetJson<Record<string, unknown>>(cacheKey);
  if (cached) return c.json({ data: cached, cache: "hit" });

  const now = new Date();
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + days);

  const [products, stockCounts, expiredLots, expiringSoonLots, expiryCounts, parties, creditCounts] = await Promise.all([
    prisma.$queryRaw<any[]>(Prisma.sql`
      WITH stock AS (
        SELECT p.id, p.name, p.barcode, p."minStock",
          COALESCE(SUM(sb."quantityBase"), 0) quantity,
          COALESCE(u."shortName", u.name) "unitName",
          COALESCE(w.name, 'همه گدام‌ها') "warehouseName"
        FROM "Product" p JOIN "Unit" u ON u.id = p."baseUnitId"
        LEFT JOIN "Warehouse" w ON w.id = p."defaultWarehouseId"
        LEFT JOIN "StockBalance" sb ON sb."productId" = p.id
        WHERE p."isActive" = true AND p."deletedAt" IS NULL
        GROUP BY p.id, u."shortName", u.name, w.name
      )
      SELECT *, CASE WHEN quantity <= 0 THEN 'OUT_OF_STOCK'
        WHEN "minStock" > 0 AND quantity <= "minStock" THEN 'LOW_STOCK'
        ELSE 'HIGH_STOCK' END "alertType"
      FROM stock WHERE quantity <= 0
        OR ("minStock" > 0 AND quantity <= "minStock")
        OR ("minStock" > 0 AND quantity >= "minStock" * ${highStockMultiplier})
      ORDER BY quantity ASC, name ASC LIMIT 500
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      WITH stock AS (
        SELECT p.id, p."minStock", COALESCE(SUM(sb."quantityBase"), 0) quantity
        FROM "Product" p LEFT JOIN "StockBalance" sb ON sb."productId" = p.id
        WHERE p."isActive" = true AND p."deletedAt" IS NULL GROUP BY p.id
      )
      SELECT COUNT(*) FILTER (WHERE quantity <= 0)::int "outOfStock",
        COUNT(*) FILTER (WHERE quantity > 0 AND "minStock" > 0 AND quantity <= "minStock")::int "lowStock",
        COUNT(*) FILTER (WHERE "minStock" > 0 AND quantity >= "minStock" * ${highStockMultiplier})::int "highStock"
      FROM stock
    `),
    prisma.stockLot.findMany({
      where: {
        remainingQuantity: { gt: 0 },
        expiryDate: { not: null, lt: now },
        product: { isActive: true, deletedAt: null }
      },
      include: {
        product: { include: { baseUnit: true, category: true } },
        warehouse: true
      },
      orderBy: { expiryDate: "asc" },
      take: 500
    }),
    prisma.stockLot.findMany({
      where: {
        remainingQuantity: { gt: 0 },
        expiryDate: { not: null, gte: now, lte: targetDate },
        product: { isActive: true, deletedAt: null }
      },
      include: {
        product: { include: { baseUnit: true, category: true } },
        warehouse: true
      },
      orderBy: { expiryDate: "asc" },
      take: 500
    }),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT COUNT(*) FILTER (WHERE "expiryDate" < ${now})::int expired,
        COUNT(*) FILTER (WHERE "expiryDate" >= ${now} AND "expiryDate" <= ${targetDate})::int "expiringSoon"
      FROM "StockLot" WHERE "remainingQuantity" > 0 AND "expiryDate" IS NOT NULL
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      WITH party_exposure AS (
        SELECT p.id, p.name, p.type, p."creditLimit",
          COALESCE(base.code, 'AFN') "currencyCode",
          COALESCE(SUM(
            GREATEST(pa."debitBalance" - pa."creditBalance", 0)
            * COALESCE(CASE WHEN c."isBase" = true THEN 1 ELSE latest_rate."rateToBase" END, 1)
          ), 0) "customerExposure",
          COALESCE(SUM(
            GREATEST(pa."creditBalance" - pa."debitBalance", 0)
            * COALESCE(CASE WHEN c."isBase" = true THEN 1 ELSE latest_rate."rateToBase" END, 1)
          ), 0) "supplierExposure",
          MAX(pa."updatedAt") "updatedAt"
        FROM "Party" p
        JOIN "PartyAccount" pa ON pa."partyId" = p.id
        JOIN "Currency" c ON c.id = pa."currencyId"
        LEFT JOIN "Currency" base ON base."isBase" = true AND base."deletedAt" IS NULL
        LEFT JOIN LATERAL (
          SELECT cr."rateToBase"
          FROM "CurrencyRate" cr
          WHERE cr."currencyId" = pa."currencyId"
            AND cr."deletedAt" IS NULL
            AND cr."effectiveAt" <= NOW()
          ORDER BY cr."effectiveAt" DESC, cr."createdAt" DESC
          LIMIT 1
        ) latest_rate ON true
        WHERE p."isActive" = true AND p."deletedAt" IS NULL AND p."creditLimit" > 0
        GROUP BY p.id, p.name, p.type, p."creditLimit", base.code
      )
      SELECT *
      FROM party_exposure
      WHERE (type IN ('CUSTOMER', 'BOTH') AND "customerExposure" > "creditLimit")
        OR (type IN ('SUPPLIER', 'BOTH') AND "supplierExposure" > "creditLimit")
      ORDER BY name ASC LIMIT 500
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      WITH party_exposure AS (
        SELECT p.id, p.type, p."creditLimit",
          COALESCE(SUM(
            GREATEST(pa."debitBalance" - pa."creditBalance", 0)
            * COALESCE(CASE WHEN c."isBase" = true THEN 1 ELSE latest_rate."rateToBase" END, 1)
          ), 0) "customerExposure",
          COALESCE(SUM(
            GREATEST(pa."creditBalance" - pa."debitBalance", 0)
            * COALESCE(CASE WHEN c."isBase" = true THEN 1 ELSE latest_rate."rateToBase" END, 1)
          ), 0) "supplierExposure"
        FROM "Party" p
        JOIN "PartyAccount" pa ON pa."partyId" = p.id
        JOIN "Currency" c ON c.id = pa."currencyId"
        LEFT JOIN LATERAL (
          SELECT cr."rateToBase"
          FROM "CurrencyRate" cr
          WHERE cr."currencyId" = pa."currencyId"
            AND cr."deletedAt" IS NULL
            AND cr."effectiveAt" <= NOW()
          ORDER BY cr."effectiveAt" DESC, cr."createdAt" DESC
          LIMIT 1
        ) latest_rate ON true
        WHERE p."isActive" = true AND p."deletedAt" IS NULL AND p."creditLimit" > 0
        GROUP BY p.id, p.type, p."creditLimit"
      )
      SELECT COUNT(*)::int count
      FROM party_exposure
      WHERE (type IN ('CUSTOMER', 'BOTH') AND "customerExposure" > "creditLimit")
        OR (type IN ('SUPPLIER', 'BOTH') AND "supplierExposure" > "creditLimit")
    `)
  ]);

  const alerts: Array<Record<string, unknown>> = [];

  for (const product of products) {
    const totalQuantity = toNumber(product.quantity);
    const minStock = toNumber(product.minStock);
    const unitName = product.unitName;

    if (totalQuantity <= 0) {
      alerts.push({
        id: `stock-out-${product.id}`,
        category: "stock",
        type: "OUT_OF_STOCK",
        severity: "critical",
        title: "ناموجودی",
        description: `${product.name} در هیچ گدام موجودی فعال ندارد.`,
        entityName: product.name,
        entityType: "product",
        productId: product.id,
        barcode: product.barcode,
        warehouseName: product.warehouseName,
        quantity: totalQuantity,
        threshold: minStock,
        unitName,
        createdAt: new Date().toISOString()
      });
      continue;
    }

    if (minStock > 0 && totalQuantity <= minStock) {
      alerts.push({
        id: `stock-low-${product.id}`,
        category: "stock",
        type: "LOW_STOCK",
        severity: "warning",
        title: "کم بودن موجودی",
        description: `${product.name} به حداقل موجودی رسیده است.`,
        entityName: product.name,
        entityType: "product",
        productId: product.id,
        barcode: product.barcode,
        warehouseName: product.warehouseName,
        quantity: totalQuantity,
        threshold: minStock,
        unitName,
        createdAt: new Date().toISOString()
      });
    }

    if (minStock > 0 && totalQuantity >= minStock * highStockMultiplier) {
      alerts.push({
        id: `stock-high-${product.id}`,
        category: "stock",
        type: "HIGH_STOCK",
        severity: "info",
        title: "موجودی خیلی زیاد",
        description: `${product.name} بیشتر از ${highStockMultiplier} برابر حداقل موجودی ذخیره شده است.`,
        entityName: product.name,
        entityType: "product",
        productId: product.id,
        barcode: product.barcode,
        warehouseName: product.warehouseName,
        quantity: totalQuantity,
        threshold: minStock * highStockMultiplier,
        unitName,
        createdAt: new Date().toISOString()
      });
    }
  }

  for (const lot of expiredLots) {
    alerts.push({
      id: `expired-${lot.id}`,
      category: "expiry",
      type: "EXPIRED",
      severity: "critical",
      title: "تاریخ انقضا گذشته",
      description: `${lot.product.name} در ${lot.warehouse.name} منقضی شده است.`,
      entityName: lot.product.name,
      entityType: "stockLot",
      productId: lot.productId,
      lotId: lot.id,
      warehouseName: lot.warehouse.name,
      quantity: toNumber(lot.remainingQuantity),
      unitName: lot.product.baseUnit.shortName || lot.product.baseUnit.name,
      expiryDate: lot.expiryDate,
      createdAt: lot.updatedAt
    });
  }

  for (const lot of expiringSoonLots) {
    alerts.push({
      id: `expiring-${lot.id}`,
      category: "expiry",
      type: "EXPIRING_SOON",
      severity: "warning",
      title: "نزدیک تاریخ انقضا",
      description: `${lot.product.name} تا ${days} روز آینده منقضی می‌شود.`,
      entityName: lot.product.name,
      entityType: "stockLot",
      productId: lot.productId,
      lotId: lot.id,
      warehouseName: lot.warehouse.name,
      quantity: toNumber(lot.remainingQuantity),
      unitName: lot.product.baseUnit.shortName || lot.product.baseUnit.name,
      expiryDate: lot.expiryDate,
      createdAt: lot.updatedAt
    });
  }

  for (const party of parties) {
      const customerExposure = toNumber(party.customerExposure);
      const supplierExposure = toNumber(party.supplierExposure);
      const creditLimit = toNumber(party.creditLimit);
      const isCustomer = party.type === "CUSTOMER" || party.type === "BOTH";
      const isSupplier = party.type === "SUPPLIER" || party.type === "BOTH";

      if (isCustomer && customerExposure > creditLimit) {
        alerts.push({
          id: `credit-customer-${party.id}`,
          category: "credit",
          type: "CUSTOMER_CREDIT_LIMIT",
          severity: "warning",
          title: "کریدیت لیمیت مشتری",
          description: `${party.name} از حد اعتبار تعیین‌شده بیشتر بدهکار است.`,
          entityName: party.name,
          entityType: "customer",
          partyId: party.id,
          amount: customerExposure,
          threshold: creditLimit,
          currencyCode: party.currencyCode,
          createdAt: party.updatedAt
        });
      }

      if (isSupplier && supplierExposure > creditLimit) {
        alerts.push({
          id: `credit-supplier-${party.id}`,
          category: "credit",
          type: "SUPPLIER_CREDIT_LIMIT",
          severity: "warning",
          title: "کریدیت لیمیت تأمین‌کننده",
          description: `بدهی فروشگاه به ${party.name} از حد تعیین‌شده بیشتر شده است.`,
          entityName: party.name,
          entityType: "supplier",
          partyId: party.id,
          amount: supplierExposure,
          threshold: creditLimit,
          currencyCode: party.currencyCode,
          createdAt: party.updatedAt
        });
      }
  }

  alerts.sort((a, b) => {
    const severityDelta =
      severityRank(String(a.severity)) - severityRank(String(b.severity));
    if (severityDelta !== 0) return severityDelta;

    return String(a.entityName ?? "").localeCompare(String(b.entityName ?? ""));
  });

  const counts = {
    outOfStock: toNumber(stockCounts[0]?.outOfStock),
    lowStock: toNumber(stockCounts[0]?.lowStock),
    highStock: toNumber(stockCounts[0]?.highStock),
    expired: toNumber(expiryCounts[0]?.expired),
    expiringSoon: toNumber(expiryCounts[0]?.expiringSoon),
    creditLimit: toNumber(creditCounts[0]?.count)
  };
  const exactCounts = {
    ...counts,
    critical: counts.outOfStock + counts.expired,
    warning: counts.lowStock + counts.expiringSoon + counts.creditLimit,
    info: counts.highStock,
    total:
      counts.outOfStock +
      counts.lowStock +
      counts.highStock +
      counts.expired +
      counts.expiringSoon +
      counts.creditLimit
  };

  const data = {
      days,
      highStockMultiplier,
      counts: exactCounts,
      alerts,
      isTruncated: alerts.length < exactCounts.total
  };
  await cacheSetJson(cacheKey, data, 30);
  return c.json({ data, cache: "miss" });
});

alertsRoute.get("/stock", async (c) => {
  const products = await prisma.product.findMany({
    where: {
      isActive: true
    },
    include: {
      baseUnit: true,
      defaultWarehouse: true,
      stockBalances: true
    },
    orderBy: {
      name: "asc"
    }
  });

  const outOfStock = [];
  const lowStock = [];

  for (const product of products) {
    const totalQuantity = product.stockBalances.reduce(
      (sum, balance) => sum + toNumber(balance.quantityBase),
      0
    );

    const minStock = toNumber(product.minStock);

    const item = {
      productId: product.id,
      productName: product.name,
      barcode: product.barcode,
      baseUnit: product.baseUnit,
      defaultWarehouse: product.defaultWarehouse,
      totalQuantity,
      minStock,
      lots: []
    };

    if (totalQuantity <= 0) {
      outOfStock.push({
        ...item,
        alertType: "OUT_OF_STOCK",
        message: "Product is out of stock"
      });

      continue;
    }

    if (minStock > 0 && totalQuantity <= minStock) {
      lowStock.push({
        ...item,
        alertType: "LOW_STOCK",
        message: "Product stock is lower than minimum stock"
      });
    }
  }

  return c.json({
    data: {
      outOfStock,
      lowStock,
      counts: {
        outOfStock: outOfStock.length,
        lowStock: lowStock.length
      }
    }
  });
});

alertsRoute.get("/expiry", async (c) => {
  const days = getExpiryDaysFromQuery(c.req.query("days"));

  const now = new Date();
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + days);

  const expiredLots = await prisma.stockLot.findMany({
    where: {
      remainingQuantity: {
        gt: 0
      },
      expiryDate: {
        not: null,
        lt: now
      }
    },
    include: {
      product: {
        include: {
          baseUnit: true
        }
      },
      warehouse: true
    },
    orderBy: {
      expiryDate: "asc"
    }
  });

  const expiringSoonLots = await prisma.stockLot.findMany({
    where: {
      remainingQuantity: {
        gt: 0
      },
      expiryDate: {
        not: null,
        gte: now,
        lte: targetDate
      }
    },
    include: {
      product: {
        include: {
          baseUnit: true
        }
      },
      warehouse: true
    },
    orderBy: {
      expiryDate: "asc"
    }
  });

  return c.json({
    data: {
      days,
      expired: expiredLots.map((lot) => ({
        alertType: "EXPIRED",
        message: "Product lot is expired",
        lot
      })),
      expiringSoon: expiringSoonLots.map((lot) => ({
        alertType: "EXPIRING_SOON",
        message: `Product lot will expire within ${days} days`,
        lot
      })),
      counts: {
        expired: expiredLots.length,
        expiringSoon: expiringSoonLots.length
      }
    }
  });
});

alertsRoute.get("/summary", async (c) => {
  const days = getExpiryDaysFromQuery(c.req.query("days"));

  const now = new Date();
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + days);

  const products = await prisma.product.findMany({
    where: {
      isActive: true
    },
    include: {
      stockBalances: true
    }
  });

  let outOfStockCount = 0;
  let lowStockCount = 0;

  for (const product of products) {
    const totalQuantity = product.stockBalances.reduce(
      (sum, balance) => sum + toNumber(balance.quantityBase),
      0
    );

    const minStock = toNumber(product.minStock);

    if (totalQuantity <= 0) {
      outOfStockCount += 1;
      continue;
    }

    if (minStock > 0 && totalQuantity <= minStock) {
      lowStockCount += 1;
    }
  }

  const expiredCount = await prisma.stockLot.count({
    where: {
      remainingQuantity: {
        gt: 0
      },
      expiryDate: {
        not: null,
        lt: now
      }
    }
  });

  const expiringSoonCount = await prisma.stockLot.count({
    where: {
      remainingQuantity: {
        gt: 0
      },
      expiryDate: {
        not: null,
        gte: now,
        lte: targetDate
      }
    }
  });

  return c.json({
    data: {
      stock: {
        outOfStock: outOfStockCount,
        lowStock: lowStockCount
      },
      expiry: {
        days,
        expired: expiredCount,
        expiringSoon: expiringSoonCount
      },
      totalAlerts:
        outOfStockCount + lowStockCount + expiredCount + expiringSoonCount
    }
  });
});
