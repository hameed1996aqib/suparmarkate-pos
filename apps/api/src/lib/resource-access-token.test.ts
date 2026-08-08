import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createResourceAccessToken,
  verifyResourceAccessToken
} from "./resource-access-token";

describe("resource access tokens", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret-with-at-least-24-characters";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T08:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("binds a token to one resource and id", () => {
    const { token } = createResourceAccessToken({ resource: "pos-sale", id: "sale-1" });
    expect(verifyResourceAccessToken(token, { resource: "pos-sale", id: "sale-1" })).toBe(true);
    expect(verifyResourceAccessToken(token, { resource: "pos-sale", id: "sale-2" })).toBe(false);
    expect(verifyResourceAccessToken(token, { resource: "party-payment", id: "sale-1" })).toBe(false);
  });

  it("rejects tampered and expired tokens", () => {
    const { token } = createResourceAccessToken({
      resource: "pos-sale",
      id: "sale-1",
      ttlSeconds: 30
    });
    expect(verifyResourceAccessToken(`${token}x`, { resource: "pos-sale", id: "sale-1" })).toBe(false);
    vi.advanceTimersByTime(31_000);
    expect(verifyResourceAccessToken(token, { resource: "pos-sale", id: "sale-1" })).toBe(false);
  });
});
