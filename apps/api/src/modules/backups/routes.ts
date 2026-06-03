import { Hono } from "hono";
import { rm } from "node:fs/promises";
import path from "node:path";
import type { Context } from "hono";
import { deleteUploadedFilesBackup } from "../../lib/backup-assets";
import { getAuthUser, hasPermission, writeAudit } from "../../lib/auth";
import { enqueueJob, getJob } from "../../lib/persistent-jobs";
import {
  assertSafeBackupFilename,
  createNativeBackup,
  deleteBackupMetadata,
  getBackupDir,
  readBackupMetadata,
  restoreNativeBackup
} from "../../lib/postgres-backup";
import { setMaintenanceMode } from "../../lib/maintenance-mode";
import { listBackupFiles } from "./service";

export const backupsRoute = new Hono();

function requireBackupPermission(c: Context) {
  if (!hasPermission(getAuthUser(c), "backup.manage")) {
    return c.json({ message: "Backup permission is required" }, 403);
  }
  return null;
}

backupsRoute.get("/", async (c) => {
  const error = requireBackupPermission(c);
  if (error) return error;
  return c.json({ data: await listBackupFiles() });
});

backupsRoute.post("/", async (c) => {
  const error = requireBackupPermission(c);
  if (error) return error;
  const job = await enqueueJob("BACKUP_CREATE", { source: "manual" });
  await writeAudit(c, {
    action: "backup.create.started",
    entityType: "Backup",
    entityId: job.id,
    description: "Manual PostgreSQL backup queued",
    metadata: { jobId: job.id }
  });
  return c.json({ data: job }, 202);
});

backupsRoute.get("/jobs/:jobId", async (c) => {
  const error = requireBackupPermission(c);
  if (error) return error;
  const job = await getJob(c.req.param("jobId"));
  if (!job) return c.json({ message: "Backup job not found" }, 404);
  return c.json({
    data: {
      ...job,
      status: job.status.toLowerCase(),
      filename: (job.result as { filename?: string } | null)?.filename ?? null
    }
  });
});

backupsRoute.get("/:filename", async (c) => {
  const error = requireBackupPermission(c);
  if (error) return error;
  const filename = c.req.param("filename");
  try {
    assertSafeBackupFilename(filename);
    return c.json({ data: { filename, ...(await readBackupMetadata(path.join(getBackupDir(), filename))) } });
  } catch {
    return c.json({ message: "Backup not found or filename is invalid" }, 404);
  }
});

backupsRoute.post("/:filename/restore", async (c) => {
  const error = requireBackupPermission(c);
  if (error) return error;
  const filename = c.req.param("filename");
  const body = (await c.req.json().catch(() => ({}))) as { confirm?: string; mode?: string };
  try {
    assertSafeBackupFilename(filename);
  } catch {
    return c.json({ message: "Invalid backup filename" }, 400);
  }
  const filePath = path.join(getBackupDir(), filename);
  const metadata = await readBackupMetadata(filePath);
  if (body.mode !== "restore" || body.confirm !== "RESTORE") {
    return c.json({ message: "Backup validated", data: { filename, ...metadata, restoreMode: "preview" } });
  }
  const safetyBackup = await createNativeBackup();
  setMaintenanceMode(`restoring ${filename}`);
  try {
    await restoreNativeBackup(filePath);
  } finally {
    setMaintenanceMode(null);
  }
  await writeAudit(c, {
    action: "backup.restore",
    entityType: "Backup",
    entityId: filename,
    description: "PostgreSQL backup restored",
    metadata: { filename, safetyBackup: safetyBackup.filename }
  });
  return c.json({ message: "Backup restored successfully", data: { filename, safetyBackup: safetyBackup.filename, restoreMode: "restore" } });
});

backupsRoute.delete("/:filename", async (c) => {
  const error = requireBackupPermission(c);
  if (error) return error;
  const filename = c.req.param("filename");
  try {
    assertSafeBackupFilename(filename);
  } catch {
    return c.json({ message: "Invalid backup filename" }, 400);
  }
  const filePath = path.join(getBackupDir(), filename);
  await rm(filePath, { force: true });
  await deleteBackupMetadata(filePath);
  await deleteUploadedFilesBackup(filePath);
  await writeAudit(c, { action: "backup.delete", entityType: "Backup", entityId: filename, description: "PostgreSQL backup deleted", metadata: { filename } });
  return c.json({ message: "Backup deleted" });
});
