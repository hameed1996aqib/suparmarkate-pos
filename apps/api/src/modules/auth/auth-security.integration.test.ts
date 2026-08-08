import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { authMiddleware, hashPassword } from "../../lib/auth";
import { prisma } from "../../lib/prisma";
import { authRoute } from "./routes";

const databaseUrl = process.env.DATABASE_URL || "";

if (!/[/_]supermarket_test(?:\?|$)/.test(databaseUrl)) {
  throw new Error("Auth security tests require the isolated supermarket_test database.");
}

const marker = `auth-security-${Date.now()}`;
const initialPassword = "Initial-Password-123";
const newPassword = "Changed-Password-456";
const deviceId = `MOBILE-${marker}`;
const rejectedUsername = `${marker}-unlinked`;
const rejectedDeviceId = `${deviceId}-unlinked`;
let userId = "";
let rejectedUserId = "";

const app = new Hono();
app.use("/api/*", authMiddleware);
app.route("/api/auth", authRoute);

async function login(
  password: string,
  username = marker,
  mobileDeviceId = deviceId,
) {
  return app.request("http://test.local/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username,
      password,
      deviceId: mobileDeviceId,
      deviceName: "Integration test mobile",
      deviceType: "MOBILE",
    }),
  });
}

beforeAll(async () => {
  process.env.JWT_SECRET = "integration-test-secret-with-at-least-24-characters";
  const adminRole = await prisma.role.findUnique({ where: { name: "Admin" } });
  if (!adminRole) throw new Error("Seeded Admin role is required for auth security tests.");
  const user = await prisma.user.create({
    data: {
      username: marker,
      displayName: "Auth Security Test",
      passwordHash: await hashPassword(initialPassword),
      mustChangePassword: true,
      roleId: adminRole.id,
    },
  });
  userId = user.id;
  const rejectedUser = await prisma.user.create({
    data: {
      username: rejectedUsername,
      displayName: "Unlinked Mobile User",
      passwordHash: await hashPassword(initialPassword),
    },
  });
  rejectedUserId = rejectedUser.id;
});

afterAll(async () => {
  const userIds = [userId, rejectedUserId];
  await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.userSession.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.posDevice.deleteMany({ where: { code: { in: [deviceId, rejectedDeviceId] } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe("initial password and mobile session security", () => {
  it("rejects mobile login before creating a session for an unlinked non-Admin user", async () => {
    const response = await login(initialPassword, rejectedUsername, rejectedDeviceId);
    expect(response.status).toBe(403);
    expect(await prisma.userSession.count({ where: { userId: rejectedUserId } })).toBe(0);
    expect(await prisma.posDevice.findUnique({ where: { code: rejectedDeviceId } })).toBeNull();
  });

  it("requires a password change, preserves the current session, and revokes it on logout", async () => {
    const loginResponse = await login(initialPassword);
    expect(loginResponse.status).toBe(200);
    const loginJson = await loginResponse.json() as any;
    const token = String(loginJson?.data?.token || "");
    expect(token).not.toBe("");
    expect(loginJson?.data?.device?.credential).toBeTruthy();
    expect(loginJson?.data?.user?.mustChangePassword).toBe(true);

    const blockedResponse = await app.request(
      "http://test.local/api/auth/register-device",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ deviceId, deviceName: "Blocked bootstrap" }),
      },
    );
    expect(blockedResponse.status).toBe(403);
    expect((await blockedResponse.json() as any)?.code).toBe("PASSWORD_CHANGE_REQUIRED");

    const changeResponse = await app.request(
      "http://test.local/api/auth/change-password",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ currentPassword: initialPassword, newPassword }),
      },
    );
    expect(changeResponse.status).toBe(200);

    const meResponse = await app.request("http://test.local/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(meResponse.status).toBe(200);
    expect((await meResponse.json() as any)?.data?.user?.mustChangePassword).toBe(false);

    expect((await login(initialPassword)).status).toBe(401);
    expect((await login(newPassword)).status).toBe(200);

    const logoutResponse = await app.request("http://test.local/api/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(logoutResponse.status).toBe(200);
    const expiredSessionResponse = await app.request("http://test.local/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(expiredSessionResponse.status).toBe(401);
  });
});
