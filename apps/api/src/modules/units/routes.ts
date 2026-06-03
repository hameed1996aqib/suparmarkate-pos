import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { zodError } from "../../lib/api";
import { attachAuditUsers, auditCreateData, auditDeleteData, auditUpdateData } from "../../lib/audit-meta";
import { getAuthUser, writeAudit } from "../../lib/auth";

export const unitsRoute = new Hono();

const createUnitSchema = z.object({
  name: z.string().trim().min(1).max(100),
  shortName: z.string().trim().max(20).optional().nullable(),
  isActive: z.boolean().optional()
});

const updateUnitSchema = createUnitSchema.partial();

unitsRoute.get("/", async (c) => {
  const [baseProductRows, productUnitRows, purchaseItemRows, saleItemRows] =
    await Promise.all([
      prisma.product.findMany({
        select: {
          baseUnitId: true
        },
        distinct: ["baseUnitId"]
      }),
      prisma.productUnit.findMany({
        select: {
          unitId: true
        },
        distinct: ["unitId"]
      }),
      prisma.purchaseItem.findMany({
        select: {
          unitId: true
        },
        distinct: ["unitId"]
      }),
      prisma.saleItem.findMany({
        select: {
          unitId: true
        },
        distinct: ["unitId"]
      })
    ]);
  const usedUnitIds = Array.from(
    new Set([
      ...baseProductRows.map((row) => row.baseUnitId),
      ...productUnitRows.map((row) => row.unitId),
      ...purchaseItemRows.map((row) => row.unitId),
      ...saleItemRows.map((row) => row.unitId)
    ])
  );

  const items = await prisma.unit.findMany({
    where: {
      OR: [
        {
          deletedAt: null
        },
        {
          id: {
            in: usedUnitIds
          }
        }
      ]
    },
    orderBy: { name: "asc" }
  });

  return c.json({ data: await attachAuditUsers(items) });
});

unitsRoute.get("/lookup", async (c) => {
  const items = await prisma.unit.findMany({
    where: { deletedAt: null, isActive: true },
    select: { id: true, name: true, shortName: true, isActive: true },
    orderBy: { name: "asc" }
  });
  return c.json({ data: items });
});

unitsRoute.get("/:id", async (c) => {
  const id = c.req.param("id");

  const item = await prisma.unit.findUnique({
    where: { id }
  });

  if (!item || item.deletedAt) {
    return c.json({ message: "Unit not found" }, 404);
  }

  return c.json({ data: await attachAuditUsers(item) });
});

unitsRoute.post("/", async (c) => {
  const authUser = getAuthUser(c);
  const body = await c.req.json().catch(() => null);
  const parsed = createUnitSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const item = await prisma.unit.create({
    data: {
      ...parsed.data,
      ...auditCreateData(authUser?.id)
    }
  });

  await writeAudit(c, {
    action: "UNIT_CREATED",
    entityType: "Unit",
    entityId: item.id,
    metadata: { name: item.name }
  });

  return c.json({ data: item }, 201);
});

unitsRoute.patch("/:id", async (c) => {
  const authUser = getAuthUser(c);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = updateUnitSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const item = await prisma.unit.update({
    where: { id },
    data: {
      ...parsed.data,
      ...auditUpdateData(authUser?.id)
    }
  });

  await writeAudit(c, {
    action: "UNIT_UPDATED",
    entityType: "Unit",
    entityId: item.id,
    metadata: { name: item.name }
  });

  return c.json({ data: item });
});

unitsRoute.delete("/:id", async (c) => {
  const authUser = getAuthUser(c);
  const id = c.req.param("id");

  const [baseProducts, productUnits, purchaseItems, saleItems] = await Promise.all([
    prisma.product.count({
      where: {
        baseUnitId: id
      }
    }),
    prisma.productUnit.count({
      where: {
        unitId: id
      }
    }),
    prisma.purchaseItem.count({
      where: {
        unitId: id
      }
    }),
    prisma.saleItem.count({
      where: {
        unitId: id
      }
    })
  ]);
  const usageCount = baseProducts + productUnits + purchaseItems + saleItems;

  if (usageCount > 0) {
    return c.json(
      {
        message:
          "این واحد در محصول، خرید یا فروش استفاده شده است و قابل حذف نیست. اگر لازم است، آن را غیرفعال کنید.",
        usage: {
          baseProducts,
          productUnits,
          purchaseItems,
          saleItems
        }
      },
      400
    );
  }

  const item = await prisma.unit.update({
    where: { id },
    data: auditDeleteData(authUser?.id)
  });

  await writeAudit(c, {
    action: "UNIT_DELETED",
    entityType: "Unit",
    entityId: item.id,
    metadata: { name: item.name }
  });

  return c.json({ message: "Unit deactivated", data: item });
});
