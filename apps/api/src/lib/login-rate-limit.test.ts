import { describe, expect, it } from "vitest";
import { clearRateLimit, consumeRateLimit } from "./cache";

describe("login rate limiting", () => {
  it("blocks attempts after the configured limit and can be cleared", async () => {
    const key = `test:${Date.now()}:${Math.random()}`;

    expect((await consumeRateLimit(key, 2, 60)).allowed).toBe(true);
    expect((await consumeRateLimit(key, 2, 60)).allowed).toBe(true);
    const blocked = await consumeRateLimit(key, 2, 60);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);

    await clearRateLimit(key);
    expect((await consumeRateLimit(key, 2, 60)).allowed).toBe(true);
    await clearRateLimit(key);
  });
});
