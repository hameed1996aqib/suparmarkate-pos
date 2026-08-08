import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import {
  cacheDeleteByPattern,
  cacheGetJson,
  cacheSetJson,
  closeRedisCache,
  getRedisHealth,
} from "./cache";

const redisUrl = process.env.REDIS_URL || "";
const integrationIt = redisUrl ? it : it.skip;

afterAll(async () => {
  await closeRedisCache();
});

describe("Redis cache integration", () => {
  integrationIt("reports health and supports the cache lifecycle", async () => {
    const key = `integration:cache:${randomUUID()}`;
    const health = await getRedisHealth();

    expect(health).toMatchObject({
      enabled: true,
      configured: true,
      connected: true,
      status: "connected",
      error: null,
    });
    expect(health.latencyMs).toBeTypeOf("number");

    await cacheSetJson(key, { status: "ok" }, 30);
    await expect(cacheGetJson(key)).resolves.toEqual({ status: "ok" });
    await cacheDeleteByPattern("integration:cache:*");
    await expect(cacheGetJson(key)).resolves.toBeNull();
  });
});
