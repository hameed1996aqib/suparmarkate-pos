import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { zodError } from "../../lib/api";
import { attachAuditUsers, auditCreateData, auditDeleteData, auditUpdateData } from "../../lib/audit-meta";
import { getAuthUser, writeAudit } from "../../lib/auth";

export const warehousesRoute = new Hono();

const createWarehouseSchema = z.object({
  name: z.string().trim().min(2).max(120),
  location: z.string().trim().max(200).optional().nullable(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional()
});

const updateWarehouseSchema = createWarehouseSchema.partial();

warehousesRoute.get("/", async (c) => {
  const stockWarehouseRows = await prisma.stockLot.groupBy({
    by: ["warehouseId"],
    where: {
      remainingQuantity: {
        gt: 0
      }
    }
  });
  const warehousesWithStock = stockWarehouseRows.map((row) => row.warehouseId);

  const items = await prisma.warehouse.findMany({
    where: {
      OR: [
        {
          deletedAt: null
        },
        {
          id: {
            in: warehousesWithStock
          }
        }
      ]
    },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }]
  });

  return c.json({ data: await attachAuditUsers(items) });
});

warehousesRoute.get("/:id", async (c) => {
  const id = c.req.param("id");

  const item = await prisma.warehouse.findUnique({
    where: { id }
  });

  if (!item || item.deletedAt) {
    return c.json({ message: "Warehouse not found" }, 404);
  }

  return c.json({ data: await attachAuditUsers(item) });
});

warehousesRoute.post("/", async (c) => {
  const authUser = getAuthUser(c);
  const body = await c.req.json().catch(() => null);
  const parsed = createWarehouseSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const item = await prisma.$transaction(async (tx) => {
    if (parsed.data.isDefault) {
      await tx.warehouse.updateMany({
        where: { isDefault: true },
        data: { isDefault: false }
      });
    }

    return tx.warehouse.create({
      data: {
        ...parsed.data,
        ...auditCreateData(authUser?.id)
      }
    });
  });

  await writeAudit(c, {
    action: "WAREHOUSE_CREATED",
    entityType: "Warehouse",
    entityId: item.id,
    metadata: { name: item.name }
  });

  return c.json({ data: item }, 201);
});

warehousesRoute.patch("/:id", async (c) => {
  const authUser = getAuthUser(c);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = updateWarehouseSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const item = await prisma.$transaction(async (tx) => {
    if (parsed.data.isDefault) {
      await tx.warehouse.updateMany({
        where: { isDefault: true, NOT: { id } },
        data: { isDefault: false }
      });
    }

    return tx.warehouse.update({
      where: { id },
      data: {
        ...parsed.data,
        ...auditUpdateData(authUser?.id)
      }
    });
  });

  await writeAudit(c, {
    action: "WAREHOUSE_UPDATED",
    entityType: "Warehouse",
    entityId: item.id,
    metadata: { name: item.name }
  });

  return c.json({ data: item });
});

warehousesRoute.delete("/:id", async (c) => {
  const authUser = getAuthUser(c);
  const id = c.req.param("id");

  const stockSummary = await prisma.stockLot.aggregate({
    where: {
      warehouseId: id,
      remainingQuantity: {
        gt: 0
      }
    },
    _sum: {
      remainingQuantity: true
    },
    _count: true
  });

  const remainingQuantity = Number(stockSummary._sum.remainingQuantity ?? 0);

  if (remainingQuantity > 0) {
    return c.json(
      {
        message:
          "این گدام هنوز موجودی دارد؛ اول موجودی را بفروشید، انتقال بدهید یا با تعدیل صفر کنید.",
        stockLots: stockSummary._count,
        remainingQuantity
      },
      400
    );
  }

  const item = await prisma.warehouse.update({
    where: { id },
    data: auditDeleteData(authUser?.id)
  });

  await writeAudit(c, {
    action: "WAREHOUSE_DELETED",
    entityType: "Warehouse",
    entityId: item.id,
    metadata: { name: item.name }
  });

  return c.json({ message: "Warehouse deactivated", data: item });
});
