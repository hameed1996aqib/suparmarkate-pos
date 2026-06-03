import type { Context } from "hono";
import { prisma } from "./prisma";

function normalizeDeviceCode(value: string | undefined | null) {
  const trimmed = String(value || "").trim();

  if (!trimmed) return null;

  return trimmed.slice(0, 80);
}

export async function getRequestPosDevice(c: Context, userId?: string | null) {
  const code = normalizeDeviceCode(c.req.header("x-pos-device-code"));
  const name =
    String(c.req.header("x-pos-device-name") || code || "POS Device")
      .trim()
      .slice(0, 120) || "POS Device";
  const type =
    String(c.req.header("x-pos-device-type") || "DESKTOP")
      .trim()
      .slice(0, 40) || "DESKTOP";

  if (!code) {
    return null;
  }

  return prisma.posDevice.upsert({
    where: { code },
    update: {
      name,
      type,
      userId: userId || undefined,
      lastSeenAt: new Date(),
      isActive: true
    },
    create: {
      code,
      name,
      type,
      userId: userId || null,
      lastSeenAt: new Date()
    }
  });
}
