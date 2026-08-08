import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./prisma";

function hashCredential(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export class DeviceAccountLockedError extends Error {
  constructor() {
    super("این موبایل در ۲۴ ساعت اخیر به حساب دیگری وصل شده است");
    this.name = "DeviceAccountLockedError";
  }
}

export class DeviceRevokedError extends Error {
  constructor() {
    super("\u062f\u0633\u062a\u0631\u0633\u06cc \u0627\u06cc\u0646 \u0645\u0648\u0628\u0627\u06cc\u0644 \u062a\u0648\u0633\u0637 \u0645\u062f\u06cc\u0631 \u0644\u063a\u0648 \u0634\u062f\u0647 \u0627\u0633\u062a\u061b \u062f\u0648\u0628\u0627\u0631\u0647 \u0648\u0627\u0631\u062f \u0634\u0648\u06cc\u062f");
    this.name = "DeviceRevokedError";
  }
}

export async function issueDeviceCredential(input: {
  userId: string;
  deviceId: string;
  name?: string | null;
  type?: string | null;
  allowReactivation?: boolean;
}) {
  const existing = await prisma.posDevice.findUnique({
    where: { code: input.deviceId }
  });
  const lastBoundAt = existing?.lastSeenAt || existing?.credentialIssuedAt || existing?.updatedAt;
  if (existing?.credentialRevokedAt && !input.allowReactivation) {
    throw new DeviceRevokedError();
  }
  if (
    existing?.userId &&
    existing.userId !== input.userId &&
    lastBoundAt &&
    lastBoundAt.getTime() > Date.now() - 24 * 60 * 60 * 1000
  ) {
    throw new DeviceAccountLockedError();
  }

  const credential = randomBytes(32).toString("base64url");
  const now = new Date();
  const device = await prisma.posDevice.upsert({
    where: { code: input.deviceId },
    update: {
      userId: input.userId,
      name: input.name?.trim() || "Muhaseb Mobile",
      type: input.type?.trim().toUpperCase() || "MOBILE",
      credentialHash: hashCredential(credential),
      credentialIssuedAt: now,
      credentialRevokedAt: null,
      lastSeenAt: now,
      isActive: true
    },
    create: {
      code: input.deviceId,
      userId: input.userId,
      name: input.name?.trim() || "Muhaseb Mobile",
      type: input.type?.trim().toUpperCase() || "MOBILE",
      credentialHash: hashCredential(credential),
      credentialIssuedAt: now,
      lastSeenAt: now,
      isActive: true
    },
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      credentialIssuedAt: true
    }
  });
  return { device, credential };
}

export async function verifyDeviceCredential(input: {
  userId: string;
  deviceId: string;
  credential: string;
}) {
  const device = await prisma.posDevice.findUnique({
    where: { code: input.deviceId }
  });
  if (
    !device ||
    !device.isActive ||
    device.userId !== input.userId ||
    device.credentialRevokedAt ||
    !device.credentialHash ||
    device.credentialHash !== hashCredential(input.credential)
  ) {
    return null;
  }
  await prisma.posDevice.update({
    where: { id: device.id },
    data: { lastSeenAt: new Date() }
  });
  return device;
}
