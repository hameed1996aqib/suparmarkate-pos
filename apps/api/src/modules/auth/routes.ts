import { Hono, type Context } from "hono";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { prisma } from "../../lib/prisma";
import { zodError } from "../../lib/api";
import { clearRateLimit, consumeRateLimit } from "../../lib/cache";
import {
  DeviceAccountLockedError,
  DeviceRevokedError,
  issueDeviceCredential
} from "../../lib/device-credentials";
import {
  createAccessToken,
  getAuthUser,
  getSessionExpiry,
  hashPassword,
  hashToken,
  loadAuthUser,
  verifyPassword,
  writeAudit
} from "../../lib/auth";

export const authRoute = new Hono();

const loginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
  deviceId: z.string().trim().min(8).max(120).optional(),
  deviceName: z.string().trim().max(120).optional(),
  deviceType: z.enum(["MOBILE"]).optional()
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128)
});

function requestIp(c: Context) {
  return (
    c.req.header("cf-connecting-ip") ||
    c.req.header("x-real-ip") ||
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

async function auditFailedLogin(
  c: any,
  input: { username: string; action?: string; reason: string }
) {
  await prisma.auditLog.create({
    data: {
      action: input.action || "AUTH_LOGIN_FAILED",
      entityType: "User",
      description: input.reason,
      metadata: { username: input.username },
      ipAddress: requestIp(c),
      userAgent: c.req.header("user-agent") || null
    }
  });
}

authRoute.post("/login", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);

  if (!parsed.success) {
    await auditFailedLogin(c, {
      username: String((body as { username?: unknown } | null)?.username || ""),
      reason: "Login payload validation failed"
    });
    return c.json(zodError(parsed.error), 400);
  }

  const username = parsed.data.username.toLowerCase();
  const ip = requestIp(c);
  const identityKey = `login:identity:${hashToken(`${username}|${ip}`)}`;
  const ipKey = `login:ip:${hashToken(ip)}`;
  const windowSeconds = Math.max(60, Number(process.env.LOGIN_RATE_LIMIT_WINDOW_SECONDS || 900));
  const identityLimit = Math.max(1, Number(process.env.LOGIN_RATE_LIMIT_ATTEMPTS || 5));
  const ipLimit = Math.max(identityLimit, Number(process.env.LOGIN_RATE_LIMIT_IP_ATTEMPTS || 30));
  const [identityRate, ipRate] = await Promise.all([
    consumeRateLimit(identityKey, identityLimit, windowSeconds),
    consumeRateLimit(ipKey, ipLimit, windowSeconds)
  ]);

  if (!identityRate.allowed || !ipRate.allowed) {
    const retryAfterSeconds = Math.max(
      identityRate.retryAfterSeconds,
      ipRate.retryAfterSeconds
    );
    c.header("Retry-After", String(retryAfterSeconds));
    await auditFailedLogin(c, {
      username,
      action: "AUTH_LOGIN_RATE_LIMITED",
      reason: "Too many login attempts"
    });
    return c.json(
      { message: "تلاش ورود بیش از حد است؛ چند دقیقه بعد دوباره کوشش کنید." },
      429
    );
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
    await auditFailedLogin(c, { username, reason: "Unknown or inactive user" });
    return c.json({ message: "Invalid username or password" }, 401);
  }

  const passwordOk = await verifyPassword(parsed.data.password, user.passwordHash);

  if (!passwordOk) {
    await auditFailedLogin(c, { username, reason: "Invalid password" });
    return c.json({ message: "Invalid username or password" }, 401);
  }

  const isMobileLogin = parsed.data.deviceType === "MOBILE";
  const isAdmin = String(user.role?.name || "").toLowerCase() === "admin";
  if (isMobileLogin && !isAdmin && !user.employee) {
    await auditFailedLogin(c, {
      username,
      action: "AUTH_MOBILE_ROLE_REJECTED",
      reason: "Mobile login requires an Admin or linked Employee account"
    });
    return c.json(
      { message: "ورود اپ موبایل فقط برای مدیر یا کارمند متصل به حساب کاربری مجاز است" },
      403
    );
  }

  await clearRateLimit(identityKey);

  let issuedDevice: Awaited<ReturnType<typeof issueDeviceCredential>> | null = null;
  if (parsed.data.deviceId) {
    try {
      issuedDevice = await issueDeviceCredential({
        userId: user.id,
        deviceId: parsed.data.deviceId,
        name: parsed.data.deviceName,
        type: parsed.data.deviceType,
        allowReactivation: true
      });
    } catch (error) {
      if (error instanceof DeviceAccountLockedError) {
        await auditFailedLogin(c, {
          username,
          action: "AUTH_DEVICE_ACCOUNT_LOCKED",
          reason: error.message
        });
        return c.json({ message: error.message }, 409);
      }
      throw error;
    }
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
      device: issuedDevice
        ? { ...issuedDevice.device, credential: issuedDevice.credential }
        : null,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role?.name || null,
        permissions: user.role?.permissions.map((permission) => permission.key) || [],
        mustChangePassword: user.mustChangePassword,
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

authRoute.post("/change-password", async (c) => {
  const authUser = getAuthUser(c);
  if (!authUser) return c.json({ message: "Authentication required" }, 401);
  const body = await c.req.json().catch(() => null);
  const parsed = changePasswordSchema.safeParse(body);
  if (!parsed.success) return c.json(zodError(parsed.error), 400);

  const user = await prisma.user.findUnique({ where: { id: authUser.id } });
  if (!user || !(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
    return c.json({ message: "رمز عبور فعلی درست نیست" }, 400);
  }
  if (await verifyPassword(parsed.data.newPassword, user.passwordHash)) {
    return c.json({ message: "رمز جدید باید با رمز فعلی متفاوت باشد" }, 400);
  }

  const sessionId = (c as any).get("authSessionId") as string | undefined;
  await prisma.$transaction([
    prisma.user.update({
      where: { id: authUser.id },
      data: {
        passwordHash: await hashPassword(parsed.data.newPassword),
        mustChangePassword: false
      }
    }),
    prisma.userSession.updateMany({
      where: {
        userId: authUser.id,
        ...(sessionId ? { id: { not: sessionId } } : {})
      },
      data: { revokedAt: new Date() }
    })
  ]);

  await writeAudit(c, {
    action: "AUTH_PASSWORD_CHANGED",
    entityType: "User",
    entityId: authUser.id
  });
  return c.json({
    data: {
      user: { ...authUser, mustChangePassword: false }
    },
    message: "رمز عبور تغییر کرد"
  });
});

authRoute.post("/register-device", async (c) => {
  const authUser = getAuthUser(c);
  if (!authUser) return c.json({ message: "Authentication required" }, 401);
  const parsed = z.object({
    deviceId: z.string().trim().min(8).max(120),
    deviceName: z.string().trim().max(120).optional()
  }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(zodError(parsed.error), 400);

  try {
    const issued = await issueDeviceCredential({
      userId: authUser.id,
      deviceId: parsed.data.deviceId,
      name: parsed.data.deviceName,
      type: "MOBILE"
    });
    await writeAudit(c, {
      action: "AUTH_DEVICE_REGISTERED",
      entityType: "PosDevice",
      entityId: issued.device.id
    });
    return c.json({ data: { ...issued.device, credential: issued.credential } });
  } catch (error) {
    if (error instanceof DeviceAccountLockedError) {
      return c.json({ message: error.message }, 409);
    }
    if (error instanceof DeviceRevokedError) {
      return c.json({ message: error.message }, 403);
    }
    throw error;
  }
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
