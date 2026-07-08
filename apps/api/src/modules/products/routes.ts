import { Hono } from "hono";
import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Prisma } from "../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { zodError } from "../../lib/api";
import {
  attachAuditUsers,
  auditCreateData,
  auditDeleteData,
  auditUpdateData,
} from "../../lib/audit-meta";
import { getAuthUser, writeAudit } from "../../lib/auth";
import {
  cacheDeleteByPattern,
} from "../../lib/cache";
import { createPaginationMeta, getPagePagination } from "../../lib/pagination";
import {
  barcodeSearchCandidates,
  generateProductBarcodeCandidate,
  normalizeBarcodeText,
} from "../../lib/barcode";

export const productsRoute = new Hono();

const productUnitSchema = z.object({
  unitId: z.string().min(1),
  conversionRate: z.coerce.number().positive(),
  purchasePrice: z.coerce.number().nonnegative().optional().nullable(),
  salePrice: z.coerce.number().nonnegative().optional().nullable(),
  isDefaultPurchase: z.boolean().optional(),
  isDefaultSale: z.boolean().optional(),
});

const createProductSchema = z.object({
  name: z.string().trim().min(2).max(160),
  sku: z.string().trim().max(80).optional().nullable(),
  barcode: z.string().trim().max(80).optional().nullable(),
  description: z.string().trim().max(500).optional().nullable(),
  imageUrl: z.string().trim().max(500).optional().nullable(),
  categoryId: z.string().optional().nullable(),
  baseUnitId: z.string().min(1),
  defaultWarehouseId: z.string().optional().nullable(),
  hasExpiry: z.boolean().default(false),
  minStock: z.coerce.number().nonnegative().default(0),
  isActive: z.boolean().optional(),
  units: z.array(productUnitSchema).optional().default([]),
});

const updateProductSchema = createProductSchema.partial().extend({
  units: z.array(productUnitSchema).optional(),
});

const imageMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

async function generateUniqueProductBarcode() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const barcode = generateProductBarcodeCandidate();
    const existing = await prisma.product.findFirst({
      where: {
        OR: [{ barcode }, { barcodeNormalized: normalizeBarcodeText(barcode) }],
      },
    });

    if (!existing) return barcode;
  }

  throw new Error("Could not generate a unique product barcode");
}

async function resolveProductBarcode(value: string | null | undefined) {
  const raw = (value || "").trim();
  return raw || generateUniqueProductBarcode();
}

function duplicateBarcodeMessage(barcode: string) {
  return `بارکود ${barcode} قبلا برای محصول دیگری ثبت شده است. لطفا بارکود دیگر وارد کنید یا فیلد بارکود را خالی بگذارید تا سیستم بارکود جدید بسازد.`;
}

function isUniqueConstraintError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  return "code" in error && (error as { code?: string }).code === "P2002";
}

async function ensureBarcodeIsAvailable(
  barcode: string,
  excludeProductId?: string,
) {
  const normalized = normalizeBarcodeText(barcode);
  if (!normalized) return;

  const existing = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id
    FROM "Product"
    WHERE "deletedAt" IS NULL
      ${excludeProductId ? Prisma.sql`AND id <> ${excludeProductId}` : Prisma.empty}
      AND (
        barcode = ${barcode}
        OR "barcodeNormalized" = ${normalized}
        OR NULLIF(
          replace(
            replace(
              replace(
                replace(
                  regexp_replace(
                    translate(
                      COALESCE(barcode, ''),
                      '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩',
                      '01234567890123456789'
                    ),
                    '[-[:space:]]+',
                    '',
                    'g'
                  ),
                  chr(8203),
                  ''
                ),
                chr(8204),
                ''
              ),
              chr(8205),
              ''
            ),
            chr(8288),
            ''
          ),
          ''
        ) = ${normalized}
      )
    LIMIT 1
  `);

  if (existing.length) {
    throw new Error(duplicateBarcodeMessage(barcode));
  }
}

function buildProductSearchWhere(search: string | null | undefined) {
  const rawSearch = (search || "").trim();
  const barcodeSearch = normalizeBarcodeText(rawSearch);

  if (!rawSearch) return {};

  return {
    OR: [
      { name: { contains: rawSearch, mode: "insensitive" as const } },
      { sku: { contains: rawSearch, mode: "insensitive" as const } },
      { barcode: rawSearch },
      { barcode: { contains: rawSearch, mode: "insensitive" as const } },
      ...(barcodeSearch
        ? [
            { barcode: barcodeSearch },
            { barcodeNormalized: barcodeSearch },
            {
              barcode: {
                contains: barcodeSearch,
                mode: "insensitive" as const,
              },
            },
            {
              barcodeNormalized: {
                contains: barcodeSearch,
                mode: "insensitive" as const,
              },
            },
            { sku: { contains: barcodeSearch, mode: "insensitive" as const } },
          ]
        : []),
    ],
  };
}

function buildBarcodeFilterWhere(filter: string | null | undefined) {
  switch ((filter || "all").trim()) {
    case "has":
      return { barcode: { not: null } };
    case "missing":
      return { barcode: null };
    case "system":
      return { barcode: { startsWith: "20" } };
    case "manual":
      return {
        AND: [
          { barcode: { not: null } },
          { NOT: { barcode: { startsWith: "20" } } }
        ]
      };
    default:
      return {};
  }
}

function productImageExtension(mimeType: string, originalName: string) {
  const ext = path.extname(originalName).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext)) return ext;
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/gif") return ".gif";
  return ".png";
}

const productLookupInclude = {
  category: true,
  baseUnit: true,
  defaultWarehouse: true,
  units: {
    include: {
      unit: true,
    },
    orderBy: { createdAt: "asc" as const },
  },
};

productsRoute.get("/", async (c) => {
  const pagination = getPagePagination(c, {
    defaultLimit: 100,
    maxLimit: 200,
  });
  const search = c.req.query("search");
  const barcodeFilter = c.req.query("barcodeFilter");
  const where = {
    AND: [
      {
        OR: [
          {
            deletedAt: null,
          },
          {
            stockLots: { some: {} },
          },
          {
            stockMovements: { some: {} },
          },
          {
            purchaseItems: { some: {} },
          },
          {
            purchaseReturnItems: { some: {} },
          },
          {
            saleItems: { some: {} },
          },
          {
            saleReturnItems: { some: {} },
          },
        ],
      },
      ...(search ? [buildProductSearchWhere(search)] : []),
      buildBarcodeFilterWhere(barcodeFilter),
    ],
  };
  const [items, total, active, barcodeCount] = await Promise.all([
    prisma.product.findMany({
      where,
      include: {
        category: true,
        baseUnit: true,
        defaultWarehouse: true,
        units: {
          include: {
            unit: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: pagination.skip,
      take: pagination.limit,
    }),
    prisma.product.count({ where }),
    prisma.product.count({ where: { deletedAt: null, isActive: true } }),
    prisma.product.count({
      where: { deletedAt: null, barcode: { not: null } },
    }),
  ]);

  return c.json({
    data: await attachAuditUsers(items),
    pagination: createPaginationMeta({ ...pagination, total }),
    summary: { total, active, barcodeCount },
  });
});

productsRoute.get("/lookup", async (c) => {
  const search = (c.req.query("search") || "").trim();
  const requestedLimit = Number.parseInt(c.req.query("limit") || "50", 10);
  const limit = Math.min(
    Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 50, 1),
    100,
  );
  const barcodeCandidates = barcodeSearchCandidates(search);
  const baseWhere = { deletedAt: null, isActive: true };

  if (!search) {
    const items = await prisma.product.findMany({
      where: baseWhere,
      include: productLookupInclude,
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: limit,
    });

    return c.json({ data: items, pagination: { limit, total: items.length } });
  }

  const exactBarcodeRows = barcodeCandidates.length
    ? await prisma.product.findMany({
        where: {
          ...baseWhere,
          OR: [
            { barcode: { in: barcodeCandidates } },
            { barcodeNormalized: { in: barcodeCandidates } },
          ],
        },
        include: productLookupInclude,
        take: limit,
      })
    : [];
  const exactIds = new Set(exactBarcodeRows.map((item) => item.id));
  const remainingLimit = Math.max(0, limit - exactBarcodeRows.length);
  const fuzzyRows = remainingLimit
    ? await prisma.product.findMany({
        where: {
          ...baseWhere,
          ...(exactIds.size ? { id: { notIn: Array.from(exactIds) } } : {}),
          ...buildProductSearchWhere(search),
        },
        include: productLookupInclude,
        orderBy: [{ name: "asc" }, { updatedAt: "desc" }],
        take: remainingLimit,
      })
    : [];
  const data = [...exactBarcodeRows, ...fuzzyRows];

  return c.json({ data, pagination: { limit, total: data.length } });
});

productsRoute.get("/pos-search", async (c) => {
  const search = (c.req.query("search") || "").trim();
  const categoryId = (c.req.query("categoryId") || "").trim();
  const warehouseId = (c.req.query("warehouseId") || "").trim();
  const requestedLimit = Number.parseInt(c.req.query("limit") || "60", 10);
  const requestedOffset = Number.parseInt(c.req.query("offset") || "0", 10);
  const limit = Math.min(
    Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 60, 1),
    100,
  );
  const offset = Math.max(
    Number.isFinite(requestedOffset) ? requestedOffset : 0,
    0,
  );

  const searchWhere = buildProductSearchWhere(search);
  const barcodeCandidates = barcodeSearchCandidates(search);
  const baseWhere = {
    deletedAt: null,
    isActive: true,
    ...(categoryId ? { categoryId } : {}),
  };
  const exactBarcodeWhere =
    search && barcodeCandidates.length
      ? {
          ...baseWhere,
          OR: [
            { barcode: { in: barcodeCandidates } },
            { barcodeNormalized: { in: barcodeCandidates } },
          ],
        }
      : null;
  const exactIdRows = exactBarcodeWhere
    ? await prisma.product.findMany({
        where: exactBarcodeWhere,
        select: { id: true },
      })
    : [];
  const exactIds = exactIdRows.map((item) => item.id);
  const fuzzyWhere = {
    ...baseWhere,
    ...searchWhere,
    ...(exactIds.length ? { id: { notIn: exactIds } } : {}),
  };
  const where = search ? fuzzyWhere : baseWhere;
  const facetWhere = {
    deletedAt: null,
    isActive: true,
    ...searchWhere,
  };

  const exactCount = exactIds.length;
  const exactSkip = Math.min(offset, exactCount);
  const exactTake = Math.max(0, Math.min(limit, exactCount - exactSkip));
  const fuzzySkip = Math.max(0, offset - exactCount);
  const fuzzyTake = Math.max(0, limit - exactTake);

  const [exactRows, fuzzyRows, fuzzyTotal, categoryRows] = await Promise.all([
    exactBarcodeWhere && exactTake > 0
      ? prisma.product.findMany({
          where: exactBarcodeWhere,
          include: {
            category: true,
            baseUnit: true,
            defaultWarehouse: true,
            units: {
              include: {
                unit: true,
              },
            },
          },
          orderBy: [{ barcodeNormalized: "asc" }, { name: "asc" }],
          skip: exactSkip,
          take: exactTake,
        })
      : [],
    fuzzyTake > 0
      ? prisma.product.findMany({
          where,
          include: {
            category: true,
            baseUnit: true,
            defaultWarehouse: true,
            units: {
              include: {
                unit: true,
              },
            },
          },
          orderBy: [{ name: "asc" }, { createdAt: "desc" }],
          skip: fuzzySkip,
          take: fuzzyTake,
        })
      : [],
    prisma.product.count({ where }),
    prisma.product.groupBy({
      by: ["categoryId"],
      where: facetWhere,
      _count: { _all: true },
    }),
  ]);
  const items = [...exactRows, ...fuzzyRows];
  const total = exactCount + fuzzyTotal;
  const productIds = items.map((item) => item.id);
  const stockRows = productIds.length
    ? await prisma.stockBalance.groupBy({
        by: ["productId"],
        where: {
          productId: { in: productIds },
          ...(warehouseId ? { warehouseId } : {}),
        },
        _sum: { quantityBase: true },
      })
    : [];
  const stockByProductId = new Map(
    stockRows.map((row) => [row.productId, Number(row._sum.quantityBase || 0)]),
  );
  const categoryIds = categoryRows
    .map((row) => row.categoryId)
    .filter((id): id is string => Boolean(id));
  const categories = categoryIds.length
    ? await prisma.productCategory.findMany({
        where: { id: { in: categoryIds }, deletedAt: null, isActive: true },
        select: { id: true, name: true },
      })
    : [];
  const categoryNameById = new Map(
    categories.map((item) => [item.id, item.name]),
  );
  const facets = categoryRows
    .filter((row) => row.categoryId && categoryNameById.has(row.categoryId))
    .map((row) => ({
      id: row.categoryId as string,
      name: categoryNameById.get(row.categoryId as string) || "",
      count: row._count._all,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const payload = {
    data: items.map((item) => ({
      ...item,
      totalStock: stockByProductId.get(item.id) || 0,
    })),
    pagination: {
      offset,
      limit,
      total,
      hasMore: offset + items.length < total,
      nextOffset: offset + items.length,
    },
    facets: {
      categories: facets,
    },
  };

  return c.json({ ...payload, cache: "miss" });
});

productsRoute.get("/barcode-duplicates", async (c) => {
  const rows = await prisma.$queryRaw<
    Array<{
      normalized: string;
      count: number;
      products: Array<{ id: string; name: string; barcode: string | null }>;
    }>
  >`
    WITH normalized AS (
      SELECT
        id,
        name,
        barcode,
        NULLIF(
          replace(
            replace(
              replace(
                replace(
                  regexp_replace(
                    translate(
                      COALESCE(barcode, ''),
                      '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩',
                      '01234567890123456789'
                    ),
                    '[-[:space:]]+',
                    '',
                    'g'
                  ),
                  chr(8203),
                  ''
                ),
                chr(8204),
                ''
              ),
              chr(8205),
              ''
            ),
            chr(8288),
            ''
          ),
          ''
        ) AS normalized
      FROM "Product"
      WHERE barcode IS NOT NULL AND "deletedAt" IS NULL
    )
    SELECT
      normalized,
      COUNT(*)::int AS count,
      json_agg(
        json_build_object('id', id, 'name', name, 'barcode', barcode)
        ORDER BY name
      ) AS products
    FROM normalized
    WHERE normalized IS NOT NULL
    GROUP BY normalized
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC, normalized ASC
  `;

  return c.json({ data: rows });
});

productsRoute.get("/:id", async (c) => {
  const id = c.req.param("id");

  const item = await prisma.product.findUnique({
    where: { id },
    include: {
      category: true,
      baseUnit: true,
      defaultWarehouse: true,
      units: {
        include: {
          unit: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!item || item.deletedAt) {
    return c.json({ message: "Product not found" }, 404);
  }

  return c.json({ data: await attachAuditUsers(item) });
});

productsRoute.post("/", async (c) => {
  const authUser = getAuthUser(c);
  const body = await c.req.json().catch(() => null);
  const parsed = createProductSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const { units, ...productData } = parsed.data;
  const barcode = await resolveProductBarcode(productData.barcode);
  const barcodeNormalized = normalizeBarcodeText(barcode);
  await ensureBarcodeIsAvailable(barcode);

  let item;
  try {
    item = await prisma.product.create({
      data: {
        ...productData,
        barcode,
        barcodeNormalized,
        ...auditCreateData(authUser?.id),
        units: {
          create: units.map((unit) => ({
            unitId: unit.unitId,
            conversionRate: unit.conversionRate,
            purchasePrice: unit.purchasePrice ?? null,
            salePrice: unit.salePrice ?? null,
            isDefaultPurchase: unit.isDefaultPurchase ?? false,
            isDefaultSale: unit.isDefaultSale ?? false,
          })),
        },
      },
      include: {
        category: true,
        baseUnit: true,
        defaultWarehouse: true,
        units: {
          include: {
            unit: true,
          },
        },
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return c.json({ message: duplicateBarcodeMessage(barcode) }, 409);
    }
    throw error;
  }

  await writeAudit(c, {
    action: "PRODUCT_CREATED",
    entityType: "Product",
    entityId: item.id,
    metadata: { name: item.name, barcode: item.barcode, sku: item.sku },
  });
  await cacheDeleteByPattern("pos:products:*");

  return c.json({ data: item }, 201);
});

productsRoute.patch("/:id", async (c) => {
  const authUser = getAuthUser(c);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = updateProductSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const { units, ...productData } = parsed.data;
  const nextBarcode = Object.prototype.hasOwnProperty.call(productData, "barcode")
    ? await resolveProductBarcode(productData.barcode)
    : undefined;
  const nextProductData = {
    ...productData,
    ...(nextBarcode
      ? {
          barcode: nextBarcode,
          barcodeNormalized: normalizeBarcodeText(nextBarcode),
        }
      : {}),
  };

  if (nextProductData.barcode) {
    await ensureBarcodeIsAvailable(nextProductData.barcode, id);
  }

  let item;
  try {
    item = await prisma.$transaction(async (tx) => {
      if (units) {
        await tx.productUnit.deleteMany({
          where: { productId: id },
        });
      }

      return tx.product.update({
        where: { id },
        data: {
          ...nextProductData,
          ...auditUpdateData(authUser?.id),
          ...(units
            ? {
                units: {
                  create: units.map((unit) => ({
                    unitId: unit.unitId,
                    conversionRate: unit.conversionRate,
                    purchasePrice: unit.purchasePrice ?? null,
                    salePrice: unit.salePrice ?? null,
                    isDefaultPurchase: unit.isDefaultPurchase ?? false,
                    isDefaultSale: unit.isDefaultSale ?? false,
                  })),
                },
              }
            : {}),
        },
        include: {
          category: true,
          baseUnit: true,
          defaultWarehouse: true,
          units: {
            include: {
              unit: true,
            },
          },
        },
      });
    });
  } catch (error) {
    if (isUniqueConstraintError(error) && nextProductData.barcode) {
      return c.json(
        { message: duplicateBarcodeMessage(nextProductData.barcode) },
        409,
      );
    }
    throw error;
  }

  await writeAudit(c, {
    action: "PRODUCT_UPDATED",
    entityType: "Product",
    entityId: item.id,
    metadata: { name: item.name, barcode: item.barcode, sku: item.sku },
  });
  await cacheDeleteByPattern("pos:products:*");

  return c.json({ data: item });
});

productsRoute.post("/:id/image", async (c) => {
  const authUser = getAuthUser(c);
  const id = c.req.param("id");
  const body = await c.req.parseBody();
  const file = body.file as any;

  if (
    !file ||
    typeof file === "string" ||
    typeof file.arrayBuffer !== "function"
  ) {
    return c.json({ message: "عکس محصول ضروری است" }, 400);
  }

  const mimeType = String(file.type || "");
  if (!imageMimeTypes.has(mimeType)) {
    return c.json({ message: "فقط فایل عکس قابل آپلود است" }, 400);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const maxSize = 5 * 1024 * 1024;
  if (buffer.byteLength > maxSize) {
    return c.json({ message: "حجم عکس باید کمتر از ۵MB باشد" }, 400);
  }

  const product = await prisma.product.findUnique({ where: { id } });
  if (!product || product.deletedAt) {
    return c.json({ message: "Product not found" }, 404);
  }

  const uploadDir = path.join(process.cwd(), "uploads", "products");
  await mkdir(uploadDir, { recursive: true });

  const originalName = String(file.name || "product-image.png");
  const ext = productImageExtension(mimeType, originalName);
  const fileName = `${id}-${Date.now()}${ext}`;
  await writeFile(path.join(uploadDir, fileName), buffer);

  const imageUrl = `/uploads/products/${fileName}`;
  const updated = await prisma.product.update({
    where: { id },
    data: {
      imageUrl,
      ...auditUpdateData(authUser?.id),
    },
    include: {
      category: true,
      baseUnit: true,
      defaultWarehouse: true,
      units: {
        include: {
          unit: true,
        },
      },
    },
  });

  await writeAudit(c, {
    action: "PRODUCT_IMAGE_UPLOADED",
    entityType: "Product",
    entityId: id,
    metadata: { imageUrl },
  });
  await cacheDeleteByPattern("pos:products:*");

  return c.json({ data: updated });
});

productsRoute.delete("/:id", async (c) => {
  const authUser = getAuthUser(c);
  const id = c.req.param("id");

  const [
    stockLots,
    stockMovements,
    purchaseItems,
    purchaseReturnItems,
    saleItems,
    saleReturnItems,
  ] = await Promise.all([
    prisma.stockLot.count({ where: { productId: id } }),
    prisma.stockMovement.count({ where: { productId: id } }),
    prisma.purchaseItem.count({ where: { productId: id } }),
    prisma.purchaseReturnItem.count({ where: { productId: id } }),
    prisma.saleItem.count({ where: { productId: id } }),
    prisma.saleReturnItem.count({ where: { productId: id } }),
  ]);
  const usageCount =
    stockLots +
    stockMovements +
    purchaseItems +
    purchaseReturnItems +
    saleItems +
    saleReturnItems;

  if (usageCount > 0) {
    return c.json(
      {
        message:
          "این محصول در موجودی، خرید یا فروش استفاده شده است و قابل حذف نیست. اگر لازم است، آن را غیرفعال کنید.",
        usage: {
          stockLots,
          stockMovements,
          purchaseItems,
          purchaseReturnItems,
          saleItems,
          saleReturnItems,
        },
      },
      400,
    );
  }

  const item = await prisma.product.update({
    where: { id },
    data: auditDeleteData(authUser?.id),
  });

  await writeAudit(c, {
    action: "PRODUCT_DELETED",
    entityType: "Product",
    entityId: item.id,
    metadata: { name: item.name, barcode: item.barcode, sku: item.sku },
  });
  await cacheDeleteByPattern("pos:products:*");

  return c.json({ message: "Product deactivated", data: item });
});

