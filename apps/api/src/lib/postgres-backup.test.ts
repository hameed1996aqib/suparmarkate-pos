import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  backupMetadataPath,
  type NativeBackupMetadata,
  validateNativeBackup
} from "./postgres-backup";

describe("native backup validation", () => {
  let root = "";
  let backupFile = "";
  const validToc = [
    "; Archive created at 2026-07-29 00:00:00 UTC",
    "1; 2615 2200 SCHEMA - public postgres",
    "2; 1259 100 TABLE public Sale postgres"
  ].join("\n");

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "muhaseb-postgres-backup-"));
    backupFile = path.join(root, "muhaseb-backup-2026-07-29T00-00-00-000Z.dump");
    await writeFile(backupFile, "fake-custom-archive", "utf8");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writeMetadata(overrides: Partial<NativeBackupMetadata> = {}) {
    const fileStat = await stat(backupFile);
    const databaseSha256 = createHash("sha256")
      .update("fake-custom-archive", "utf8")
      .digest("hex");
    const metadata: NativeBackupMetadata = {
      version: 4,
      format: "postgres-custom",
      app: "Muhaseb",
      appVersion: "0.1.0",
      schemaVersion: "20260703212653_test",
      createdAt: "2026-07-29T00:00:00.000Z",
      uploadsIncluded: false,
      databaseSizeBytes: fileStat.size,
      databaseSha256,
      tableCounts: {},
      uploadSnapshot: null,
      ...overrides
    };
    await writeFile(backupMetadataPath(backupFile), JSON.stringify(metadata), "utf8");
  }

  it("accepts a checksummed custom archive", async () => {
    await writeMetadata();
    const result = await validateNativeBackup(backupFile, {
      inspectArchive: async () => validToc
    });

    expect(result).toMatchObject({
      valid: true,
      legacy: false,
      restoreMode: "database-only",
      database: { checksumMatches: true, archiveEntries: 2 }
    });
  });

  it("rejects a corrupted archive checksum", async () => {
    await writeMetadata({ databaseSha256: "0".repeat(64) });
    const result = await validateNativeBackup(backupFile, {
      inspectArchive: async () => validToc
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Database backup checksum does not match metadata");
  });

  it("rejects an archive that pg_restore cannot inspect", async () => {
    await writeMetadata();
    const result = await validateNativeBackup(backupFile, {
      inspectArchive: async () => {
        throw new Error("input file does not appear to be a valid archive");
      }
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("valid archive");
  });

  it("allows legacy metadata-free dumps as database-only and preserves uploads", async () => {
    const result = await validateNativeBackup(backupFile, {
      inspectArchive: async () => validToc
    });

    expect(result).toMatchObject({
      valid: true,
      legacy: true,
      restoreMode: "database-only"
    });
    expect(result.warnings.join(" ")).toContain("current uploads will be preserved");
  });

  it("rejects metadata that requires a missing upload snapshot", async () => {
    await writeMetadata({ uploadsIncluded: true });
    const result = await validateNativeBackup(backupFile, {
      inspectArchive: async () => validToc
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("upload snapshot is missing");
  });

  it("rejects malformed metadata instead of silently treating it as legacy", async () => {
    await mkdir(path.dirname(backupMetadataPath(backupFile)), { recursive: true });
    await writeFile(backupMetadataPath(backupFile), "{broken", "utf8");
    const result = await validateNativeBackup(backupFile, {
      inspectArchive: async () => validToc
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("metadata is invalid");
  });
});
