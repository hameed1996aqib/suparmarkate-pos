import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { zodError } from "../../lib/api";
import { getAuthUser, hashPassword, hasPermission, writeAudit } from "../../lib/auth";
import { attachAuditUsers, auditCreateData, auditDeleteData, auditUpdateData } from "../../lib/audit-meta";

export const usersRoute = new Hono();

const userSchema = z.object({
  username: z.string().trim().min(3).max(80),
  displayName: z.string().trim().min(2).max(160),
  password: z.string().min(6).max(160).optional(),
  roleId: z.string().trim().optional().nullable(),
  roleName: z.string().trim().optional().nullable(),
  isActive: z.boolean().optional()
});

const roleSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).optional().nullable(),
  isActive: z.boolean().optional(),
  permissions: z.array(z.string().trim().min(1)).default([])
});

function serializeUser(user: any) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    isActive: user.isActive,
    roleId: user.roleId,
    role: user.role
      ? {
          id: user.role.id,
          name: user.role.name,
          permissions: user.role.permissions?.map((permission: any) => permission.key) || []
        }
      : null,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    createdByUserId: user.createdByUserId,
    updatedByUserId: user.updatedByUserId,
    deletedByUserId: user.deletedByUserId,
    deletedAt: user.deletedAt,
    createdByUser: user.createdByUser,
    updatedByUser: user.updatedByUser,
    deletedByUser: user.deletedByUser
  };
}

async function resolveRole(input: { roleId?: string | null; roleName?: string | null }) {
  if (input.roleId) {
    return prisma.role.findUnique({
      where: {
        id: input.roleId
      }
    });
  }

  if (input.roleName) {
    return prisma.role.findUnique({
      where: {
        name: input.roleName
      }
    });
  }

  return null;
}

function requireUsersPermission(c: any) {
  const user = getAuthUser(c);

  return hasPermission(user, "users.manage");
}

usersRoute.get("/", async (c) => {
  if (!requireUsersPermission(c)) {
    return c.json({ message: "Permission denied" }, 403);
  }

  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    include: {
      role: {
        include: {
          permissions: true
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  const enriched = await attachAuditUsers(users);

  return c.json({
    data: enriched.map(serializeUser)
  });
});

usersRoute.get("/roles", async (c) => {
  if (!requireUsersPermission(c)) {
    return c.json({ message: "Permission denied" }, 403);
  }

  const roles = await prisma.role.findMany({
    where: { deletedAt: null },
    include: {
      permissions: true
    },
    orderBy: {
      name: "asc"
    }
  });

  const enriched = await attachAuditUsers(roles);

  return c.json({
    data: enriched.map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      isActive: role.isActive,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
      createdByUser: role.createdByUser,
      updatedByUser: role.updatedByUser,
      permissions: role.permissions.map((permission) => permission.key)
    }))
  });
});

usersRoute.get("/permissions", async (c) => {
  if (!requireUsersPermission(c)) {
    return c.json({ message: "Permission denied" }, 403);
  }

  const permissions = await prisma.permission.findMany({
    orderBy: {
      key: "asc"
    }
  });

  return c.json({
    data: permissions.map((permission) => ({
      id: permission.id,
      key: permission.key,
      description: permission.description
    }))
  });
});

usersRoute.post("/roles", async (c) => {
  if (!requireUsersPermission(c)) {
    return c.json({ message: "Permission denied" }, 403);
  }

  const authUser = getAuthUser(c);
  const body = await c.req.json().catch(() => null);
  const parsed = roleSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const permissions = await prisma.permission.findMany({
    where: {
      key: {
        in: parsed.data.permissions
      }
    }
  });

  if (permissions.length !== parsed.data.permissions.length) {
    return c.json({ message: "One or more permissions were not found" }, 400);
  }

  const role = await prisma.role.create({
    data: {
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      isActive: parsed.data.isActive ?? true,
      ...auditCreateData(authUser?.id),
      permissions: {
        connect: permissions.map((permission) => ({ id: permission.id }))
      }
    },
    include: {
      permissions: true
    }
  });

  await writeAudit(c, {
    action: "ROLE_CREATED",
    entityType: "Role",
    entityId: role.id,
    metadata: {
      name: role.name,
      permissions: role.permissions.map((permission) => permission.key)
    }
  });

  return c.json({ data: role }, 201);
});

usersRoute.patch("/roles/:id", async (c) => {
  if (!requireUsersPermission(c)) {
    return c.json({ message: "Permission denied" }, 403);
  }

  const id = c.req.param("id");
  const authUser = getAuthUser(c);
  const body = await c.req.json().catch(() => null);
  const parsed = roleSchema.partial().safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const permissions =
    parsed.data.permissions === undefined
      ? null
      : await prisma.permission.findMany({
          where: {
            key: {
              in: parsed.data.permissions
            }
          }
        });

  if (permissions && permissions.length !== parsed.data.permissions?.length) {
    return c.json({ message: "One or more permissions were not found" }, 400);
  }

  const role = await prisma.role.update({
    where: { id },
    data: {
      name: parsed.data.name,
      description: parsed.data.description,
      isActive: parsed.data.isActive,
      ...auditUpdateData(authUser?.id),
      permissions: permissions
        ? {
            set: permissions.map((permission) => ({ id: permission.id }))
          }
        : undefined
    },
    include: {
      permissions: true
    }
  });

  await writeAudit(c, {
    action: "ROLE_UPDATED",
    entityType: "Role",
    entityId: role.id,
    metadata: {
      name: role.name,
      permissions: role.permissions.map((permission) => permission.key)
    }
  });

  return c.json({
    data: {
      ...(await attachAuditUsers({
        id: role.id,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
        isActive: role.isActive,
        createdAt: role.createdAt,
        updatedAt: role.updatedAt,
        createdByUserId: role.createdByUserId,
        updatedByUserId: role.updatedByUserId,
        permissions: role.permissions.map((permission) => permission.key)
      }))
    }
  });
});

usersRoute.delete("/roles/:id", async (c) => {
  if (!requireUsersPermission(c)) {
    return c.json({ message: "Permission denied" }, 403);
  }

  const id = c.req.param("id");
  const authUser = getAuthUser(c);
  const existing = await prisma.role.findUnique({
    where: { id }
  });

  if (!existing) {
    return c.json({ message: "Role not found" }, 404);
  }

  if (existing.isSystem) {
    return c.json({ message: "System roles cannot be deleted" }, 400);
  }

  const users = await prisma.user.count({
    where: {
      roleId: id,
      deletedAt: null
    }
  });

  if (users > 0) {
    return c.json(
      {
        message:
          "این رول به کاربر وصل است و قابل حذف نیست. اول رول کاربران را تغییر بدهید یا رول را فقط غیرفعال کنید.",
        usage: {
          users
        }
      },
      400
    );
  }

  const role = await prisma.role.update({
    where: { id },
    data: auditDeleteData(authUser?.id),
    include: {
      permissions: true
    }
  });

  await writeAudit(c, {
    action: "ROLE_DISABLED",
    entityType: "Role",
    entityId: role.id
  });

  return c.json({ message: "Role disabled", data: role });
});

usersRoute.post("/", async (c) => {
  if (!requireUsersPermission(c)) {
    return c.json({ message: "Permission denied" }, 403);
  }

  const authUser = getAuthUser(c);
  const body = await c.req.json().catch(() => null);
  const parsed = userSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  if (!parsed.data.password) {
    return c.json({ message: "Password is required for new users" }, 400);
  }

  const role = await resolveRole(parsed.data);

  if (!role && (parsed.data.roleId || parsed.data.roleName)) {
    return c.json({ message: "Role not found" }, 404);
  }

  const user = await prisma.user.create({
    data: {
      username: parsed.data.username,
      displayName: parsed.data.displayName,
      passwordHash: await hashPassword(parsed.data.password),
      roleId: role?.id || null,
      isActive: parsed.data.isActive ?? true,
      ...auditCreateData(authUser?.id)
    },
    include: {
      role: {
        include: {
          permissions: true
        }
      }
    }
  });

  await writeAudit(c, {
    action: "USER_CREATED",
    entityType: "User",
    entityId: user.id,
    metadata: {
      username: user.username,
      role: role?.name || null
    }
  });

  return c.json({ data: serializeUser(await attachAuditUsers(user)) }, 201);
});

usersRoute.patch("/:id", async (c) => {
  if (!requireUsersPermission(c)) {
    return c.json({ message: "Permission denied" }, 403);
  }

  const id = c.req.param("id");
  const authUser = getAuthUser(c);
  const body = await c.req.json().catch(() => null);
  const parsed = userSchema.partial().safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const role = await resolveRole(parsed.data);

  if (!role && (parsed.data.roleId || parsed.data.roleName)) {
    return c.json({ message: "Role not found" }, 404);
  }

  const data: any = {
    username: parsed.data.username,
    displayName: parsed.data.displayName,
    roleId: role ? role.id : parsed.data.roleId === null || parsed.data.roleName === null ? null : undefined,
    isActive: parsed.data.isActive,
    ...auditUpdateData(authUser?.id)
  };

  if (parsed.data.password) {
    data.passwordHash = await hashPassword(parsed.data.password);
  }

  const user = await prisma.user.update({
    where: {
      id
    },
    data,
    include: {
      role: {
        include: {
          permissions: true
        }
      }
    }
  });

  await writeAudit(c, {
    action: "USER_UPDATED",
    entityType: "User",
    entityId: user.id
  });

  return c.json({ data: serializeUser(await attachAuditUsers(user)) });
});

usersRoute.delete("/:id", async (c) => {
  if (!requireUsersPermission(c)) {
    return c.json({ message: "Permission denied" }, 403);
  }

  const id = c.req.param("id");
  const authUser = getAuthUser(c);
  const user = await prisma.user.update({
    where: {
      id
    },
    data: auditDeleteData(authUser?.id),
    include: {
      role: {
        include: {
          permissions: true
        }
      }
    }
  });

  await writeAudit(c, {
    action: "USER_DISABLED",
    entityType: "User",
    entityId: user.id
  });

  return c.json({ message: "User disabled", data: serializeUser(await attachAuditUsers(user)) });
});
