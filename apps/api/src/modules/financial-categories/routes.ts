import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { zodError } from "../../lib/api";
import { attachAuditUsers, auditCreateData, auditDeleteData, auditUpdateData } from "../../lib/audit-meta";
import { getAuthUser, writeAudit } from "../../lib/auth";
import { FinancialCategoryType } from "../../generated/prisma/enums";

export const financialCategoriesRoute = new Hono();

const categorySchema = z.object({
  type: z.nativeEnum(FinancialCategoryType).default(FinancialCategoryType.BOTH),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(300).optional().nullable(),
  isActive: z.boolean().optional()
});

financialCategoriesRoute.get("/", async (c) => {
  const type = c.req.query("type")?.toUpperCase();
  const categoryType = Object.values(FinancialCategoryType).includes(type as FinancialCategoryType)
    ? (type as FinancialCategoryType)
    : undefined;
  const usedCategoryRows = await prisma.moneyTransaction.findMany({
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

  const items = await prisma.financialCategory.findMany({
    where: {
      AND: [
        {
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
        ...(categoryType
          ? [
              {
                OR: [{ type: categoryType }, { type: FinancialCategoryType.BOTH }]
              }
            ]
          : [])
      ]
    },
    orderBy: [{ type: "asc" }, { name: "asc" }]
  });

  return c.json({ data: await attachAuditUsers(items) });
});

financialCategoriesRoute.post("/", async (c) => {
  const authUser = getAuthUser(c);
  const body = await c.req.json().catch(() => null);
  const parsed = categorySchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const item = await prisma.financialCategory.create({
    data: {
      ...parsed.data,
      ...auditCreateData(authUser?.id)
    }
  });

  await writeAudit(c, {
    action: "FINANCIAL_CATEGORY_CREATED",
    entityType: "FinancialCategory",
    entityId: item.id,
    metadata: { name: item.name, type: item.type }
  });

  return c.json({ data: item }, 201);
});

financialCategoriesRoute.patch("/:id", async (c) => {
  const authUser = getAuthUser(c);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = categorySchema.partial().safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const item = await prisma.financialCategory.update({
    where: { id },
    data: {
      ...parsed.data,
      ...auditUpdateData(authUser?.id)
    }
  });

  await writeAudit(c, {
    action: "FINANCIAL_CATEGORY_UPDATED",
    entityType: "FinancialCategory",
    entityId: item.id,
    metadata: { name: item.name, type: item.type }
  });

  return c.json({ data: item });
});

financialCategoriesRoute.delete("/:id", async (c) => {
  const authUser = getAuthUser(c);
  const id = c.req.param("id");

  const transactions = await prisma.moneyTransaction.count({
    where: {
      categoryId: id
    }
  });

  if (transactions > 0) {
    return c.json(
      {
        message:
          "این کتگوری مالی در عواید/مصارف یا معاملات مالی استفاده شده است و قابل حذف نیست. اگر لازم است، آن را غیرفعال کنید.",
        usage: {
          transactions
        }
      },
      400
    );
  }

  const item = await prisma.financialCategory.update({
    where: { id },
    data: auditDeleteData(authUser?.id)
  });

  await writeAudit(c, {
    action: "FINANCIAL_CATEGORY_DELETED",
    entityType: "FinancialCategory",
    entityId: item.id,
    metadata: { name: item.name, type: item.type }
  });

  return c.json({ message: "Financial category deactivated", data: item });
});
