import { Hono } from "hono";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { AuthUser } from "./auth";
import { idempotencyMiddleware } from "./idempotency";
import { prisma } from "./prisma";

const databaseUrl = process.env.DATABASE_URL || "";
if (!/[/_]supermarket_test(?:\?|$)/.test(databaseUrl)) {
  throw new Error("Idempotency integration tests require supermarket_test.");
}

const testUserId = "idempotency-integration-user";
const scope = `user:${testUserId}`;
let executionCount = 0;

const app = new Hono<{ Variables: { authUser: AuthUser } }>();
app.use("*", async (c, next) => {
  c.set("authUser", {
    id: testUserId,
    username: "idempotency-test",
    displayName: "Idempotency Test",
    role: "Admin",
    permissions: [],
    mustChangePassword: false,
    employee: null
  });
  await next();
});
app.use("*", idempotencyMiddleware);
app.post("/mutation", async (c) => {
  const body = await c.req.json<{ value: number }>();
  await new Promise((resolve) => setTimeout(resolve, 60));
  executionCount += 1;
  return c.json({ executionCount, value: body.value }, 201);
});

beforeEach(async () => {
  executionCount = 0;
  await prisma.idempotencyRecord.deleteMany({ where: { scope } });
});

afterAll(async () => {
  await prisma.idempotencyRecord.deleteMany({ where: { scope } });
  await prisma.$disconnect();
});

function request(value: number, key?: string, payloadHash?: string) {
  return app.request("http://localhost/mutation", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "Idempotency-Key": key } : {}),
      ...(payloadHash ? { "X-Idempotency-Payload-Hash": payloadHash } : {})
    },
    body: JSON.stringify({ value })
  });
}

describe("global write idempotency", () => {
  it("executes concurrent requests with the same operation ID exactly once", async () => {
    const key = `idem-${Date.now()}-same-operation`;
    const [first, second] = await Promise.all([request(12, key), request(12, key)]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(executionCount).toBe(1);
    expect([first, second].filter((response) => response.headers.get("Idempotency-Replayed") === "true"))
      .toHaveLength(1);
    expect(first.headers.get("X-Operation-Id")).toBe(key);
    expect(second.headers.get("X-Operation-Id")).toBe(key);
  });

  it("rejects reusing one operation ID for a different request", async () => {
    const key = `idem-${Date.now()}-conflict`;
    expect((await request(1, key)).status).toBe(201);
    const conflict = await request(2, key);

    expect(conflict.status).toBe(409);
    expect(executionCount).toBe(1);
    expect(await conflict.json()).toMatchObject({ operationId: key });
  });

  it("does not trust a client payload hash over the actual request body", async () => {
    const key = `idem-${Date.now()}-body-conflict`;
    expect((await request(11, key, "same-client-hash")).status).toBe(201);
    const conflict = await request(12, key, "same-client-hash");

    expect(conflict.status).toBe(409);
    expect(executionCount).toBe(1);
  });

  it("protects old clients without a key inside the retry window", async () => {
    const [first, second] = await Promise.all([request(7), request(7)]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(executionCount).toBe(1);
    expect(first.headers.get("X-Operation-Id")).toBeTruthy();
    expect(second.headers.get("X-Operation-Id")).toBe(
      first.headers.get("X-Operation-Id")
    );
  });
});
