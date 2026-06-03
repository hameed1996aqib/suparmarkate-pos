import { Hono } from "hono";
import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../../lib/prisma";
import { zodError } from "../../lib/api";
import { attachAuditUsers, auditCreateData, auditDeleteData, auditUpdateData } from "../../lib/audit-meta";
import { getAuthUser, writeAudit } from "../../lib/auth";
import { cacheDeleteByPattern, cacheGetJson, cacheSetJson } from "../../lib/cache";
import { createPaginationMeta, getPagePagination } from "../../lib/pagination";

export const productsRoute = new Hono();

const productUnitSchema = z.object({
  unitId: z.string().min(1),
  conversionRate: z.coerce.number().positive(),
  purchasePrice: z.coerce.number().nonnegative().optional().nullable(),
  salePrice: z.coerce.number().nonnegative().optional().nullable(),
  isDefaultPurchase: z.boolean().optional(),
  isDefaultSale: z.boolean().optional()
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
  units: z.array(productUnitSchema).optional().default([])
});

const updateProductSchema = createProductSchema.partial().extend({
  units: z.array(productUnitSchema).optional()
});

const imageMimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function productImageExtension(mimeType: string, originalName: string) {
  const ext = path.extname(originalName).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext)) return ext;
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/gif") return ".gif";
  return ".png";
}

productsRoute.get("/", async (c) => {
  const pagination = getPagePagination(c, { defaultLimit: 100, maxLimit: 100 });
  const search = c.req.query("search");
  const where = {
      AND: [
        {
          OR: [
            {
              deletedAt: null
            },
            {
              stockLots: { some: {} }
            },
            {
              stockMovements: { some: {} }
            },
            {
              purchaseItems: { some: {} }
            },
            {
              purchaseReturnItems: { some: {} }
            },
            {
              saleItems: { some: {} }
            },
            {
              saleReturnItems: { some: {} }
            }
          ]
        },
        ...(search
          ? [
              {
                OR: [
                  { name: { contains: search, mode: "insensitive" as const } },
                  { barcode: { contains: search, mode: "insensitive" as const } },
                  { sku: { contains: search, mode: "insensitive" as const } }
                ]
              }
            ]
          : [])
      ]
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
          unit: true
        }
      }
    },
    orderBy: { createdAt: "desc" },
    skip: pagination.skip,
    take: pagination.limit
  }),
    prisma.product.count({ where }),
    prisma.product.count({ where: { deletedAt: null, isActive: true } }),
    prisma.product.count({ where: { deletedAt: null, barcode: { not: null } } })
  ]);

  return c.json({
    data: await attachAuditUsers(items),
    pagination: createPaginationMeta({ ...pagination, total }),
    summary: { total, active, barcodeCount }
  });
});

productsRoute.get("/pos-search", async (c) => {
  const search = (c.req.query("search") || "").trim();
  const categoryId = (c.req.query("categoryId") || "").trim();
  const requestedLimit = Number.parseInt(c.req.query("limit") || "60", 10);
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 60, 1), 100);
  const cacheKey = `pos:products:v1:${categoryId || "all"}:${limit}:${search.toLowerCase()}`;
  const cached = await cacheGetJson<unknown[]>(cacheKey);

  if (cached) {
    return c.json({ data: cached, cache: "hit" });
  }

  const items = await prisma.product.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      ...(categoryId ? { categoryId } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { barcode: { contains: search, mode: "insensitive" as const } },
              { sku: { contains: search, mode: "insensitive" as const } }
            ]
          }
        : {})
    },
    include: {
      category: true,
      baseUnit: true,
      defaultWarehouse: true,
      units: {
        include: {
          unit: true
        }
      }
    },
    orderBy: [{ name: "asc" }, { createdAt: "desc" }],
    take: limit
  });

  await cacheSetJson(cacheKey, items, 45);
  return c.json({ data: items, cache: "miss" });
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
          unit: true
        },
        orderBy: { createdAt: "asc" }
      }
    }
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

  const item = await prisma.product.create({
    data: {
      ...productData,
      ...auditCreateData(authUser?.id),
      units: {
        create: units.map((unit) => ({
          unitId: unit.unitId,
          conversionRate: unit.conversionRate,
          purchasePrice: unit.purchasePrice ?? null,
          salePrice: unit.salePrice ?? null,
          isDefaultPurchase: unit.isDefaultPurchase ?? false,
          isDefaultSale: unit.isDefaultSale ?? false
        }))
      }
    },
    include: {
      category: true,
      baseUnit: true,
      defaultWarehouse: true,
      units: {
        include: {
          unit: true
        }
      }
    }
  });

  await writeAudit(c, {
    action: "PRODUCT_CREATED",
    entityType: "Product",
    entityId: item.id,
    metadata: { name: item.name, barcode: item.barcode, sku: item.sku }
  });
  await cacheDeleteByPattern("pos:products:v1:*");

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

  const item = await prisma.$transaction(async (tx) => {
    if (units) {
      await tx.productUnit.deleteMany({
        where: { productId: id }
      });
    }

    return tx.product.update({
      where: { id },
      data: {
        ...productData,
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
                  isDefaultSale: unit.isDefaultSale ?? false
                }))
              }
            }
          : {})
      },
      include: {
        category: true,
        baseUnit: true,
        defaultWarehouse: true,
        units: {
          include: {
            unit: true
          }
        }
      }
    });
  });

  await writeAudit(c, {
    action: "PRODUCT_UPDATED",
    entityType: "Product",
    entityId: item.id,
    metadata: { name: item.name, barcode: item.barcode, sku: item.sku }
  });
  await cacheDeleteByPattern("pos:products:v1:*");

  return c.json({ data: item });
});

productsRoute.post("/:id/image", async (c) => {
  const authUser = getAuthUser(c);
  const id = c.req.param("id");
  const body = await c.req.parseBody();
  const file = body.file as any;

  if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
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
      ...auditUpdateData(authUser?.id)
    },
    include: {
      category: true,
      baseUnit: true,
      defaultWarehouse: true,
      units: {
        include: {
          unit: true
        }
      }
    }
  });

  await writeAudit(c, {
    action: "PRODUCT_IMAGE_UPLOADED",
    entityType: "Product",
    entityId: id,
    metadata: { imageUrl }
  });
  await cacheDeleteByPattern("pos:products:v1:*");

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
    saleReturnItems
  ] = await Promise.all([
    prisma.stockLot.count({ where: { productId: id } }),
    prisma.stockMovement.count({ where: { productId: id } }),
    prisma.purchaseItem.count({ where: { productId: id } }),
    prisma.purchaseReturnItem.count({ where: { productId: id } }),
    prisma.saleItem.count({ where: { productId: id } }),
    prisma.saleReturnItem.count({ where: { productId: id } })
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
          saleReturnItems
        }
      },
      400
    );
  }

  const item = await prisma.product.update({
    where: { id },
    data: auditDeleteData(authUser?.id)
  });

  await writeAudit(c, {
    action: "PRODUCT_DELETED",
    entityType: "Product",
    entityId: item.id,
    metadata: { name: item.name, barcode: item.barcode, sku: item.sku }
  });
  await cacheDeleteByPattern("pos:products:v1:*");

  return c.json({ message: "Product deactivated", data: item });
});
