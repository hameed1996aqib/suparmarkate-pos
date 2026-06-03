import { Hono } from "hono";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { prisma } from "../../lib/prisma";
import { zodError } from "../../lib/api";
import {
  createAccessToken,
  getAuthUser,
  getSessionExpiry,
  hashToken,
  loadAuthUser,
  verifyPassword,
  writeAudit
} from "../../lib/auth";

export const authRoute = new Hono();

const loginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1)
});

authRoute.post("/login", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const user = await prisma.user.findUnique({
    where: {
      username: parsed.data.username
    },
    include: {
      employee: true,
      role: {
        include: {
          permissions: true
        }
      }
    }
  });

  if (!user || !user.isActive) {
    return c.json({ message: "Invalid username or password" }, 401);
  }

  const passwordOk = await verifyPassword(parsed.data.password, user.passwordHash);

  if (!passwordOk) {
    return c.json({ message: "Invalid username or password" }, 401);
  }

  const expiresAt = getSessionExpiry();
  const session = await prisma.userSession.create({
    data: {
      userId: user.id,
      tokenHash: `pending:${randomUUID()}`,
      userAgent: c.req.header("user-agent") || null,
      ipAddress: c.req.header("x-forwarded-for") || null,
      expiresAt
    }
  });
  const token = createAccessToken({
    userId: user.id,
    sessionId: session.id,
    expiresAt
  });

  await prisma.userSession.update({
    where: {
      id: session.id
    },
    data: {
      tokenHash: hashToken(token)
    }
  });
  await prisma.user.update({
    where: {
      id: user.id
    },
    data: {
      lastLoginAt: new Date()
    }
  });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "AUTH_LOGIN",
      entityType: "User",
      entityId: user.id,
      ipAddress: c.req.header("x-forwarded-for") || null,
      userAgent: c.req.header("user-agent") || null
    }
  });

  return c.json({
    data: {
      token,
      expiresAt,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role?.name || null,
        permissions: user.role?.permissions.map((permission) => permission.key) || [],
        employee: user.employee
          ? {
              id: user.employee.id,
              code: user.employee.code,
              fullName: user.employee.fullName,
              phone: user.employee.phone,
              position: user.employee.position,
              monthlySalary: Number(user.employee.monthlySalary || 0)
            }
          : null
      }
    }
  });
});

authRoute.get("/me", async (c) => {
  const user = getAuthUser(c);

  return c.json({
    data: {
      user
    }
  });
});

authRoute.post("/logout", async (c) => {
  const sessionId = (c as any).get("authSessionId") as string | undefined;

  if (sessionId) {
    await prisma.userSession.update({
      where: {
        id: sessionId
      },
      data: {
        revokedAt: new Date()
      }
    });
  }

  await writeAudit(c, {
    action: "AUTH_LOGOUT"
  });

  return c.json({ message: "Logged out" });
});
