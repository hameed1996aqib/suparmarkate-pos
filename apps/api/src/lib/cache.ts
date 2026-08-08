import { createClient, type RedisClientType } from "redis";
import type { MiddlewareHandler } from "hono";

const redisEnabled = process.env.REDIS_ENABLED !== "false";
const redisConfigured = Boolean(process.env.REDIS_URL);
const enabled = redisEnabled && redisConfigured;
let client: RedisClientType | null = null;
let connecting: Promise<RedisClientType | null> | null = null;
let lastConnectedAt: string | null = null;
let lastError: string | null = null;
const memoryRateLimits = new Map<string, { count: number; expiresAt: number }>();

async function getClient() {
  if (!enabled) return null;
  if (client?.isReady) return client;
  if (connecting) return connecting;

  connecting = (async () => {
    try {
      const nextClient = createClient({
        url: process.env.REDIS_URL,
        socket: {
          connectTimeout: 1000,
          reconnectStrategy: false
        }
      });

      nextClient.on("error", (error) => {
        lastError = error.message;
        console.warn("[redis] connection error:", error.message);
      });

      await nextClient.connect();
      client = nextClient as RedisClientType;
      lastConnectedAt = new Date().toISOString();
      lastError = null;
      console.info("[redis] cache connected");
      return client;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Redis connection failed";
      console.warn("[redis] cache unavailable; PostgreSQL fallback is active");
      return null;
    } finally {
      connecting = null;
    }
  })();

  return connecting;
}

export async function getRedisHealth() {
  const startedAt = performance.now();
  if (!redisEnabled) {
    return {
      enabled: false,
      configured: redisConfigured,
      connected: false,
      status: "disabled" as const,
      latencyMs: null,
      lastConnectedAt,
      error: null,
    };
  }
  if (!redisConfigured) {
    return {
      enabled: true,
      configured: false,
      connected: false,
      status: "unconfigured" as const,
      latencyMs: null,
      lastConnectedAt,
      error: "REDIS_URL is not configured",
    };
  }

  try {
    const redis = await getClient();
    if (!redis) {
      return {
        enabled: true,
        configured: true,
        connected: false,
        status: "unavailable" as const,
        latencyMs: null,
        lastConnectedAt,
        error: lastError || "Redis connection failed",
      };
    }

    const pong = await redis.ping();
    const latencyMs = Math.round((performance.now() - startedAt) * 10) / 10;
    lastConnectedAt = new Date().toISOString();
    lastError = null;
    return {
      enabled: true,
      configured: true,
      connected: pong === "PONG",
      status: pong === "PONG" ? ("connected" as const) : ("unavailable" as const),
      latencyMs,
      lastConnectedAt,
      error: pong === "PONG" ? null : "Redis ping did not return PONG",
    };
  } catch (error) {
    lastError = error instanceof Error ? error.message : "Redis ping failed";
    return {
      enabled: true,
      configured: true,
      connected: false,
      status: "unavailable" as const,
      latencyMs: null,
      lastConnectedAt,
      error: lastError,
    };
  }
}

export async function closeRedisCache() {
  const activeClient = client;
  client = null;
  connecting = null;
  if (!activeClient?.isOpen) return;
  await activeClient.quit().catch(() => activeClient.disconnect());
}

export async function cacheGetJson<T>(key: string): Promise<T | null> {
  try {
    const redis = await getClient();
    const value = await redis?.get(key);
    if (!value) return null;

    try {
      return JSON.parse(value) as T;
    } catch {
      await redis?.del(key);
      return null;
    }
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

export async function consumeRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
) {
  const safeLimit = Math.max(1, Math.trunc(limit));
  const safeWindowSeconds = Math.max(1, Math.trunc(windowSeconds));
  const redisKey = `rate-limit:${key}`;

  try {
    const redis = await getClient();
    if (redis) {
      const count = await redis.incr(redisKey);
      if (count === 1) await redis.expire(redisKey, safeWindowSeconds);
      const ttl = await redis.ttl(redisKey);
      return {
        allowed: count <= safeLimit,
        remaining: Math.max(0, safeLimit - count),
        retryAfterSeconds: Math.max(1, ttl > 0 ? ttl : safeWindowSeconds),
        source: "redis" as const
      };
    }
  } catch {
    // A single API instance can safely fall back to process memory.
  }

  const now = Date.now();
  const current = memoryRateLimits.get(redisKey);
  const next = !current || current.expiresAt <= now
    ? { count: 1, expiresAt: now + safeWindowSeconds * 1000 }
    : { count: current.count + 1, expiresAt: current.expiresAt };
  memoryRateLimits.set(redisKey, next);

  if (memoryRateLimits.size > 5000) {
    for (const [entryKey, entry] of memoryRateLimits) {
      if (entry.expiresAt <= now) memoryRateLimits.delete(entryKey);
    }
  }

  return {
    allowed: next.count <= safeLimit,
    remaining: Math.max(0, safeLimit - next.count),
    retryAfterSeconds: Math.max(1, Math.ceil((next.expiresAt - now) / 1000)),
    source: "memory" as const
  };
}

export async function clearRateLimit(key: string) {
  const redisKey = `rate-limit:${key}`;
  memoryRateLimits.delete(redisKey);
  try {
    const redis = await getClient();
    await redis?.del(redisKey);
  } catch {
    // Clearing a fallback limiter is best-effort.
  }
}

export const invalidateReadCachesAfterWrite: MiddlewareHandler = async (c, next) => {
  await next();

  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) && c.res.status < 400) {
    await Promise.all([
      cacheDeleteByPattern("dashboard:summary:*"),
      cacheDeleteByPattern("reports:*"),
      cacheDeleteByPattern("alerts:*"),
      cacheDeleteByPattern("pos:products:*")
    ]);
  }
};
