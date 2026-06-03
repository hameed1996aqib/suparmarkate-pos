import { mkdir, rm } from "node:fs/promises";
import { prisma } from "./prisma";
import { getUploadDir } from "./backup-assets";
import { createNativeBackup } from "./postgres-backup";
import { setMaintenanceMode } from "./maintenance-mode";
import { bootstrapStore } from "./store-baseline";
import { cacheDeleteByPattern } from "./cache";

function quoteTableName(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

export async function resetStoreData(adminUserId: string) {
  const admin = await prisma.user.findUniqueOrThrow({
    where: { id: adminUserId },
    select: {
      username: true,
      displayName: true,
      passwordHash: true
    }
  });
  const safetyBackup = await createNativeBackup();

  setMaintenanceMode("system reset");
  try {
    await prisma.$transaction(
      async (tx) => {
        const tables = await tx.$queryRaw<Array<{ table_name: string }>>`
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_type = 'BASE TABLE'
            AND table_name <> '_prisma_migrations'
        `;

        const tableNames = tables.map((table) => quoteTableName(table.table_name)).join(", ");
        if (!tableNames) throw new Error("No application tables found for reset");

        await tx.$executeRawUnsafe(`TRUNCATE TABLE ${tableNames} RESTART IDENTITY CASCADE`);
        await bootstrapStore(tx, admin);
      },
      {
        maxWait: 10_000,
        timeout: 120_000
      }
    );

    const uploadDir = getUploadDir();
    await rm(uploadDir, { recursive: true, force: true });
    await mkdir(uploadDir, { recursive: true });
    await Promise.all([
      cacheDeleteByPattern("dashboard:*"),
      cacheDeleteByPattern("reports:*"),
      cacheDeleteByPattern("alerts:*"),
      cacheDeleteByPattern("pos:*")
    ]);

    return {
      safetyBackup: safetyBackup.filename,
      adminUsername: admin.username,
      preserved: ["backups", "runtime server config", "current admin credentials"],
      seeded: [
        "current Admin login",
        "system roles and permissions",
        "AFN base currency and base rate",
        "central warehouse",
        "default unit",
        "central cash register and AFN cash account",
        "accounting chart",
        "Muhaseb company profile"
      ]
    };
  } finally {
    setMaintenanceMode(null);
  }
}
