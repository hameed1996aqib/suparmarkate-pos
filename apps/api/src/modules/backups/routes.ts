import { Hono } from "hono";
import { rm } from "node:fs/promises";
import path from "node:path";
import type { Context } from "hono";
import { deleteUploadedFilesBackup } from "../../lib/backup-assets";
import {
  BackupRestoreError,
  executeBackupRestore
} from "../../lib/backup-restore";
import { getAuthUser, hasPermission, writeAudit } from "../../lib/auth";
import { enqueueJob, getJob } from "../../lib/persistent-jobs";
import {
  assertSafeBackupFilename,
  deleteBackupMetadata,
  getBackupDir,
  validateNativeBackup
} from "../../lib/postgres-backup";
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
    const validation = await validateNativeBackup(path.join(getBackupDir(), filename));
    return c.json({
      data: {
        filename,
        ...validation.metadata,
        validation: {
          valid: validation.valid,
          legacy: validation.legacy,
          restoreMode: validation.restoreMode,
          database: validation.database,
          uploads: validation.uploads,
          errors: validation.errors,
          warnings: validation.warnings
        }
      }
    });
  } catch (error) {
    return c.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Backup not found or filename is invalid"
      },
      404
    );
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
  let validation: Awaited<ReturnType<typeof validateNativeBackup>>;
  try {
    validation = await validateNativeBackup(filePath);
  } catch (error) {
    return c.json(
      {
        message: error instanceof Error ? error.message : "Backup file could not be read",
        data: { filename, restoreMode: "rejected" }
      },
      404
    );
  }
  if (body.mode !== "restore" || body.confirm !== "RESTORE") {
    return c.json({
      message: validation.valid ? "Backup validated" : "Backup validation failed",
      data: {
        filename,
        ...validation.metadata,
        validation,
        restoreMode: "preview"
      }
    });
  }
  if (!validation.valid) {
    return c.json(
      {
        message: `Backup validation failed: ${validation.errors.join("; ")}`,
        data: { filename, validation, restoreMode: "rejected" }
      },
      422
    );
  }

  const authUser = getAuthUser(c)!;
  try {
    const result = await executeBackupRestore({
      filename,
      initialValidation: validation,
      actor: {
        id: authUser.id,
        username: authUser.username,
        displayName: authUser.displayName,
        ipAddress: c.req.header("x-forwarded-for") || null,
        userAgent: c.req.header("user-agent") || null
      }
    });
    return c.json({
      message: "Backup restored and verified successfully. Sign in again to continue.",
      data: { ...result, restoreMode: "restore", requiresLogin: true }
    });
  } catch (error) {
    const restoreError = error instanceof BackupRestoreError ? error : null;
    return c.json(
      {
        message: error instanceof Error ? error.message : "Backup restore failed",
        data: {
          filename,
          safetyBackup: restoreError?.safetyBackup ?? null,
          restoreMode: "failed",
          rollback: restoreError?.rollback ?? "unknown",
          rollbackError: restoreError?.rollbackError ?? null
        }
      },
      restoreError?.causeMessage === "restore already in progress" ? 409 : 500
    );
  }
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
