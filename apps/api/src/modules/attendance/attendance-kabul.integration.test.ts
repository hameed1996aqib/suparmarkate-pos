import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AuthUser } from "../../lib/auth";
import { prisma } from "../../lib/prisma";
import { attendanceRoute } from "./routes";

const databaseUrl = process.env.DATABASE_URL || "";
if (!/[/_]supermarket_test(?:\?|$)/.test(databaseUrl)) {
  throw new Error("Attendance integration tests require supermarket_test.");
}

const app = new Hono<{ Variables: { authUser: AuthUser } }>();
let employeeId = "";

beforeAll(async () => {
  const admin = await prisma.user.findFirst({ where: { isActive: true } });
  if (!admin) throw new Error("Seeded admin is required.");

  const employee = await prisma.employee.create({
    data: {
      fullName: `Attendance Kabul ${Date.now()}`,
      monthlySalary: 0,
    },
  });
  employeeId = employee.id;

  app.use("*", async (c, next) => {
    c.set("authUser", {
      id: admin.id,
      username: admin.username,
      displayName: admin.displayName,
      role: "Admin",
      permissions: [],
      mustChangePassword: false,
      employee: null,
    });
    await next();
  });
  app.route("/", attendanceRoute);
});

afterAll(async () => {
  if (employeeId) {
    await prisma.attendanceRecord.deleteMany({ where: { employeeId } });
    await prisma.employee.delete({ where: { id: employeeId } });
  }
  await prisma.$disconnect();
});

describe("Kabul attendance day idempotency", () => {
  it("serializes concurrent manual writes into one employee/day record", async () => {
    const request = () => app.request("http://localhost/records", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        employeeId,
        date: "2026-06-30",
        status: "PRESENT",
        checkInAt: "08:00",
      }),
    });

    const responses = await Promise.all([request(), request()]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);

    const records = await prisma.attendanceRecord.findMany({
      where: { employeeId, localDate: "2026-06-30" },
    });
    expect(records).toHaveLength(1);
    expect(records[0]?.date.toISOString()).toBe("2026-06-29T19:30:00.000Z");
  });
});
