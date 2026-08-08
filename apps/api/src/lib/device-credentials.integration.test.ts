import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "./prisma";
import {
  DeviceAccountLockedError,
  DeviceRevokedError,
  issueDeviceCredential,
  verifyDeviceCredential,
} from "./device-credentials";

const databaseUrl = process.env.DATABASE_URL || "";

if (!/[/_]supermarket_test(?:\?|$)/.test(databaseUrl)) {
  throw new Error("Device credential tests require the isolated supermarket_test database.");
}

const marker = `DEVICE-SECURITY-${Date.now()}`;
let firstUserId = "";
let secondUserId = "";

beforeAll(async () => {
  const [firstUser, secondUser] = await Promise.all([
    prisma.user.create({
      data: {
        username: `${marker}-A`,
        displayName: "Device Test A",
        passwordHash: "not-used-by-this-test",
      },
    }),
    prisma.user.create({
      data: {
        username: `${marker}-B`,
        displayName: "Device Test B",
        passwordHash: "not-used-by-this-test",
      },
    }),
  ]);
  firstUserId = firstUser.id;
  secondUserId = secondUser.id;
});

afterAll(async () => {
  await prisma.posDevice.deleteMany({ where: { code: { startsWith: marker } } });
  await prisma.user.deleteMany({ where: { id: { in: [firstUserId, secondUserId] } } });
  await prisma.$disconnect();
});

describe("mobile device credentials", () => {
  it("issues a credential and only accepts the matching user and secret", async () => {
    const deviceId = `${marker}-VERIFY`;
    const issued = await issueDeviceCredential({ userId: firstUserId, deviceId });

    expect(await verifyDeviceCredential({
      userId: firstUserId,
      deviceId,
      credential: issued.credential,
    })).not.toBeNull();
    expect(await verifyDeviceCredential({
      userId: firstUserId,
      deviceId,
      credential: "wrong-credential",
    })).toBeNull();
    expect(await verifyDeviceCredential({
      userId: secondUserId,
      deviceId,
      credential: issued.credential,
    })).toBeNull();
  });

  it("blocks a second account on the same mobile for 24 hours", async () => {
    const deviceId = `${marker}-ACCOUNT-LOCK`;
    await issueDeviceCredential({ userId: firstUserId, deviceId });

    await expect(
      issueDeviceCredential({ userId: secondUserId, deviceId }),
    ).rejects.toBeInstanceOf(DeviceAccountLockedError);
  });

  it("keeps an Admin-revoked device blocked until a fresh login reactivates it", async () => {
    const deviceId = `${marker}-REVOKED`;
    const firstCredential = await issueDeviceCredential({
      userId: firstUserId,
      deviceId,
    });
    await prisma.posDevice.update({
      where: { code: deviceId },
      data: {
        credentialHash: null,
        credentialRevokedAt: new Date(),
        isActive: false,
      },
    });

    await expect(
      issueDeviceCredential({ userId: firstUserId, deviceId }),
    ).rejects.toBeInstanceOf(DeviceRevokedError);
    expect(await verifyDeviceCredential({
      userId: firstUserId,
      deviceId,
      credential: firstCredential.credential,
    })).toBeNull();

    const reactivated = await issueDeviceCredential({
      userId: firstUserId,
      deviceId,
      allowReactivation: true,
    });
    expect(await verifyDeviceCredential({
      userId: firstUserId,
      deviceId,
      credential: reactivated.credential,
    })).not.toBeNull();
  });
});
