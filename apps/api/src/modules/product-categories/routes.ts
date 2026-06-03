import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { zodError } from "../../lib/api";
import { attachAuditUsers, auditCreateData, auditDeleteData, auditUpdateData } from "../../lib/audit-meta";
import { getAuthUser, writeAudit } from "../../lib/auth";

export const productCategoriesRoute = new Hono();

const createCategorySchema = z.object({
  name: z.string().trim().min(2).max(120),
  parentId: z.string().trim().optional().nullable(),
  isActive: z.boolean().optional()
});

const updateCategorySchema = createCategorySchema.partial();

productCategoriesRoute.get("/", async (c) => {
  const usedCategoryRows = await prisma.product.findMany({
    where: {
      categoryId: {
        not: null
      }
    },
    select: {
      categoryId: true
    },
    distinct: ["categoryId"]
  });
  const usedCategoryIds = usedCategoryRows
    .map((row) => row.categoryId)
    .filter((id): id is string => Boolean(id));

  const items = await prisma.productCategory.findMany({
    where: {
      OR: [
        {
          deletedAt: null
        },
        {
          id: {
            in: usedCategoryIds
          }
        }
      ]
    },
    orderBy: { name: "asc" }
  });

  return c.json({ data: await attachAuditUsers(items) });
});

productCategoriesRoute.get("/lookup", async (c) => {
  const items = await prisma.productCategory.findMany({
    where: { deletedAt: null, isActive: true },
    select: { id: true, name: true, parentId: true, isActive: true },
    orderBy: { name: "asc" }
  });
  return c.json({ data: items });
});

productCategoriesRoute.get("/:id", async (c) => {
  const id = c.req.param("id");

  const item = await prisma.productCategory.findUnique({
    where: { id },
    include: {
      products: {
        select: {
          id: true,
          name: true,
          barcode: true,
          hasExpiry: true,
          isActive: true
        }
      }
    }
  });

  if (!item || item.deletedAt) {
    return c.json({ message: "Product category not found" }, 404);
  }

  return c.json({ data: await attachAuditUsers(item) });
});

productCategoriesRoute.post("/", async (c) => {
  const authUser = getAuthUser(c);
  const body = await c.req.json().catch(() => null);
  const parsed = createCategorySchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const item = await prisma.productCategory.create({
    data: {
      ...parsed.data,
      ...auditCreateData(authUser?.id)
    }
  });

  await writeAudit(c, {
    action: "PRODUCT_CATEGORY_CREATED",
    entityType: "ProductCategory",
    entityId: item.id,
    metadata: { name: item.name }
  });

  return c.json({ data: item }, 201);
});

productCategoriesRoute.patch("/:id", async (c) => {
  const authUser = getAuthUser(c);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = updateCategorySchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const item = await prisma.productCategory.update({
    where: { id },
    data: {
      ...parsed.data,
      ...auditUpdateData(authUser?.id)
    }
  });

  await writeAudit(c, {
    action: "PRODUCT_CATEGORY_UPDATED",
    entityType: "ProductCategory",
    entityId: item.id,
    metadata: { name: item.name }
  });

  return c.json({ data: item });
});

productCategoriesRoute.delete("/:id", async (c) => {
  const authUser = getAuthUser(c);
  const id = c.req.param("id");

  const [products, childCategories] = await Promise.all([
    prisma.product.count({
      where: {
        categoryId: id
      }
    }),
    prisma.productCategory.count({
      where: {
        parentId: id,
        deletedAt: null
      }
    })
  ]);

  if (products + childCategories > 0) {
    return c.json(
      {
        message:
          "این کتگوری در محصول یا زیرکتگوری استفاده شده است و قابل حذف نیست. اگر لازم است، آن را غیرفعال کنید.",
        usage: {
          products,
          childCategories
        }
      },
      400
    );
  }

  const item = await prisma.productCategory.update({
    where: { id },
    data: auditDeleteData(authUser?.id)
  });

  await writeAudit(c, {
    action: "PRODUCT_CATEGORY_DELETED",
    entityType: "ProductCategory",
    entityId: item.id,
    metadata: { name: item.name }
  });

  return c.json({ message: "Product category deactivated", data: item });
});
