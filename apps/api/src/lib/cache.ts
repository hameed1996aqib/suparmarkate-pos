import { createClient, type RedisClientType } from "redis";
import type { MiddlewareHandler } from "hono";

const enabled = process.env.REDIS_ENABLED !== "false" && Boolean(process.env.REDIS_URL);
let client: RedisClientType | null = null;
let connecting: Promise<RedisClientType | null> | null = null;

async function getClient() {
  if (!enabled) return null;
  if (client?.isReady) return client;
  if (connecting) return connecting;

  connecting = (async () => {
    try {
      const nextClient = createClient({
        url: process.env.REDIS_URL
      });

      nextClient.on("error", (error) => {
        console.warn("[redis] connection error:", error.message);
      });

      await nextClient.connect();
      client = nextClient as RedisClientType;
      console.info("[redis] cache connected");
      return client;
    } catch (error) {
      console.warn("[redis] cache unavailable; PostgreSQL fallback is active");
      return null;
    } finally {
      connecting = null;
    }
  })();

  return connecting;
}

export async function cacheGetJson<T>(key: string): Promise<T | null> {
  try {
    const redis = await getClient();
    const value = await redis?.get(key);
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}

export async function cacheSetJson(key: string, value: unknown, ttlSeconds: number) {
  try {
    const redis = await getClient();
    if (!redis) return;
    await redis.set(key, JSON.stringify(value), { EX: ttlSeconds });
  } catch {
    // Cache failures must never interrupt store operations.
  }
}

export async function cacheDeleteByPattern(pattern: string) {
  try {
    const redis = await getClient();
    if (!redis) return;

    for await (const key of redis.scanIterator({ MATCH: pattern, COUNT: 100 })) {
      await redis.del(key);
    }
  } catch {
    // Cache invalidation is best-effort; short TTLs remain the fallback.
  }
}

export const invalidateReadCachesAfterWrite: MiddlewareHandler = async (c, next) => {
  await next();

  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) && c.res.status < 400) {
    await Promise.all([
      cacheDeleteByPattern("dashboard:summary:*"),
      cacheDeleteByPattern("reports:management:*"),
      cacheDeleteByPattern("alerts:*"),
      cacheDeleteByPattern("pos:products:*")
    ]);
  }
};
