import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual, createHmac } from "node:crypto";
import { promisify } from "node:util";
import type { Context, Next } from "hono";
import { prisma } from "./prisma";

const scrypt = promisify(scryptCallback);
const TOKEN_TTL_DAYS = 30;

export type AuthUser = {
  id: string;
  username: string;
  displayName: string;
  role: string | null;
  permissions: string[];
  employee: {
    id: string;
    code: string | null;
    fullName: string;
    phone: string | null;
    position: string | null;
    monthlySalary: number;
  } | null;
};

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;

  if (!secret || secret.length < 24) {
    throw new Error("JWT_SECRET must be set and contain at least 24 characters");
  }

  return secret;
}

function base64Url(input: Buffer | string) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function decodeBase64Url(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + (4 - (normalized.length % 4)) % 4, "=");

  return Buffer.from(padded, "base64").toString("utf8");
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = (await scrypt(password, salt, 64)) as Buffer;

  return `scrypt:${salt}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [algorithm, salt, expectedHex] = stored.split(":");

  if (algorithm !== "scrypt" || !salt || !expectedHex) {
    return false;
  }

  const expected = Buffer.from(expectedHex, "hex");
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createAccessToken(input: { userId: string; sessionId: string; expiresAt: Date }) {
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      sub: input.userId,
      sid: input.sessionId,
      exp: Math.floor(input.expiresAt.getTime() / 1000)
    })
  );
  const signature = base64Url(
    createHmac("sha256", getJwtSecret()).update(`${header}.${payload}`).digest()
  );

  return `${header}.${payload}.${signature}`;
}

export function verifyAccessToken(token: string): { userId: string; sessionId: string } | null {
  const parts = token.split(".");

  if (parts.length !== 3) {
    return null;
  }

  const [header, payload, signature] = parts;
  const expected = base64Url(
    createHmac("sha256", getJwtSecret()).update(`${header}.${payload}`).digest()
  );

  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }

  const parsed = JSON.parse(decodeBase64Url(payload));
  const expiresAt = Number(parsed.exp || 0) * 1000;

  if (!parsed.sub || !parsed.sid || !expiresAt || expiresAt <= Date.now()) {
    return null;
  }

  return {
    userId: String(parsed.sub),
    sessionId: String(parsed.sid)
  };
}

export function getSessionExpiry() {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + TOKEN_TTL_DAYS);
  return expiresAt;
}

export async function loadAuthUser(userId: string): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
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
    return null;
  }

  return {
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
  };
}

export function hasPermission(user: AuthUser | null | undefined, permission: string) {
  if (!user) return false;
  if (user.role === "Admin") return true;
  return user.permissions.includes(permission);
}

export async function authMiddleware(c: Context, next: Next) {
  const path = new URL(c.req.url).pathname;
  const publicPaths = [
    "/",
    "/health",
    "/api/auth/login",
    "/api/pos/scan",
    "/api/attendance/scan"
  ];
  const isPublicPosSessionAsset =
    c.req.method === "GET" &&
    /^\/api\/pos\/sessions\/[^/]+\/(qr\.svg|connect|test)$/.test(path);
  const isPublicBarcodeAsset =
    c.req.method === "GET" && path.startsWith("/api/barcodes/");

  if (
    c.req.method === "OPTIONS" ||
    publicPaths.includes(path) ||
    isPublicPosSessionAsset ||
    isPublicBarcodeAsset ||
    path.startsWith("/uploads/") ||
    path.startsWith("/api/receipts/") ||
    path.startsWith("/api/pos-receipts/")
  ) {
    await next();
    return;
  }

  const header = c.req.header("authorization") || "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";

  if (!token) {
    return c.json({ message: "Authentication required" }, 401);
  }

  const payload = verifyAccessToken(token);

  if (!payload) {
    return c.json({ message: "Invalid or expired token" }, 401);
  }

  const session = await prisma.userSession.findUnique({
    where: {
      id: payload.sessionId
    }
  });

  if (
    !session ||
    session.userId !== payload.userId ||
    session.revokedAt ||
    session.expiresAt <= new Date() ||
    session.tokenHash !== hashToken(token)
  ) {
    return c.json({ message: "Session is no longer active" }, 401);
  }

  const user = await loadAuthUser(payload.userId);

  if (!user) {
    return c.json({ message: "User is disabled" }, 401);
  }

  c.set("authUser", user);
  c.set("authToken", token);
  c.set("authSessionId", payload.sessionId);

  await next();
}

export function getAuthUser(c: Context): AuthUser | null {
  return (c.get("authUser") as AuthUser | undefined) || null;
}

export async function writeAudit(
  c: Context,
  input: {
    action: string;
    entityType?: string | null;
    entityId?: string | null;
    description?: string | null;
    metadata?: Record<string, unknown> | null;
  }
) {
  const user = getAuthUser(c);

  await prisma.auditLog.create({
    data: {
      userId: user?.id || null,
      action: input.action,
      entityType: input.entityType || null,
      entityId: input.entityId || null,
      description: input.description || null,
      metadata: (input.metadata as any) || undefined,
      ipAddress: c.req.header("x-forwarded-for") || null,
      userAgent: c.req.header("user-agent") || null
    }
  });
}
