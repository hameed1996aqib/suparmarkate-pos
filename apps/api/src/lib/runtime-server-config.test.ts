import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ENV_KEYS = [
  "BACKUP_DIR",
  "BACKUP_HOST_DIR",
  "BACKUP_RETENTION_COUNT",
  "DHCP_RESERVATION_CONFIRMED",
  "UPS_CONFIRMED",
  "BACKUP_SECOND_DISK_CONFIRMED",
  "SERVER_CONFIG_PATH"
] as const;

const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
let temporaryDir = "";

beforeEach(async () => {
  temporaryDir = await mkdtemp(path.join(os.tmpdir(), "muhaseb-server-config-"));
  for (const key of ENV_KEYS) delete process.env[key];
  vi.resetModules();
});

afterEach(async () => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
  await rm(temporaryDir, { recursive: true, force: true });
});

describe("runtime server config", () => {
  it("keeps Docker host paths externally managed while persisting confirmations", async () => {
    const configFile = path.join(temporaryDir, "server-config.json");
    const containerBackupDir = path.join(temporaryDir, "backups");
    process.env.SERVER_CONFIG_PATH = configFile;
    process.env.BACKUP_DIR = containerBackupDir;
    process.env.BACKUP_HOST_DIR = "D:\\MuhasebBackups";

    const configModule = await import("./runtime-server-config");
    const initial = configModule.getRuntimeServerConfig();

    expect(initial.backupHostDir).toBe("D:\\MuhasebBackups");
    expect(initial.backupDirManagedExternally).toBe(true);
    expect(configModule.isRuntimeBackupDirChangeAllowed(initial, containerBackupDir)).toBe(true);
    expect(
      configModule.isRuntimeBackupDirChangeAllowed(initial, path.join(temporaryDir, "other"))
    ).toBe(false);

    const updated = await configModule.updateRuntimeServerConfig({
      backupDir: containerBackupDir,
      backupRetentionCount: 14,
      dhcpReservationConfirmed: true,
      upsConfirmed: true,
      backupOnSeparateDiskConfirmed: true
    });

    expect(updated).toMatchObject({
      backupHostDir: "D:\\MuhasebBackups",
      backupDirManagedExternally: true,
      backupRetentionCount: 14,
      dhcpReservationConfirmed: true,
      upsConfirmed: true,
      backupOnSeparateDiskConfirmed: true
    });
    expect(JSON.parse(await readFile(configFile, "utf8"))).toMatchObject({
      backupHostDir: "D:\\MuhasebBackups",
      backupDirManagedExternally: true,
      backupRetentionCount: 14
    });
  });

  it("does not trust persisted files to override Docker-managed host metadata", async () => {
    const configFile = path.join(temporaryDir, "server-config.json");
    const containerBackupDir = path.join(temporaryDir, "backups");
    process.env.SERVER_CONFIG_PATH = configFile;
    process.env.BACKUP_DIR = containerBackupDir;
    process.env.BACKUP_HOST_DIR = "E:\\ProtectedBackups";
    await writeFile(
      configFile,
      JSON.stringify({
        backupDir: containerBackupDir,
        backupRetentionCount: 30,
        backupHostDir: "C:\\WrongPath",
        backupDirManagedExternally: false
      }),
      "utf8"
    );

    const configModule = await import("./runtime-server-config");
    expect(configModule.getRuntimeServerConfig()).toMatchObject({
      backupHostDir: "E:\\ProtectedBackups",
      backupDirManagedExternally: true,
      backupRetentionCount: 30
    });
  });
});
