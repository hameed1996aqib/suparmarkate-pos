import { rm } from "node:fs/promises";
import path from "node:path";
import { prisma } from "./prisma";
import { cleanupExportFiles } from "../modules/exports/service";

function safeEntityType(value: string) {
  return value.trim().replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
}

export async function runRetentionCleanup() {
  const auditDays = Math.max(30, Number(process.env.AUDIT_LOG_RETENTION_DAYS || 730));
  const qrDays = Math.max(1, Number(process.env.QR_TOKEN_RETENTION_DAYS || 30));
  const sessionDays = Math.max(1, Number(process.env.SESSION_RETENTION_DAYS || 30));
  const jobDays = Math.max(7, Number(process.env.JOB_RETENTION_DAYS || 30));
  const exportDays = Math.max(1, Number(process.env.EXPORT_RETENTION_DAYS || 7));
  const now = Date.now();

  const [audit, qr, sessions, jobs, attachments] = await Promise.all([
    prisma.auditLog.deleteMany({ where: { createdAt: { lt: new Date(now - auditDays * 86400000) } } }),
    prisma.attendanceQrToken.deleteMany({ where: { createdAt: { lt: new Date(now - qrDays * 86400000) } } }),
    prisma.userSession.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date(now - sessionDays * 86400000) } },
          { revokedAt: { lt: new Date(now - sessionDays * 86400000) } }
        ]
      }
    }),
    prisma.persistentJob.deleteMany({
      where: {
        status: { in: ["COMPLETED", "FAILED"] },
        completedAt: { lt: new Date(now - jobDays * 86400000) }
      }
    }),
    prisma.documentAttachment.findMany({
      where: { deletedAt: { lt: new Date(now - 7 * 86400000) } },
      select: { id: true, url: true, entityType: true }
    })
  ]);

  let attachmentFiles = 0;
  for (const attachment of attachments) {
    const relative = attachment.url.replace(/^\/uploads\//, "");
    const target = path.resolve(process.cwd(), "uploads", relative);
    const uploadsRoot = path.resolve(process.cwd(), "uploads");
    if (target.startsWith(uploadsRoot)) {
      await rm(target, { force: true }).catch(() => undefined);
      await rm(
        path.resolve(
          process.cwd(),
          "uploads",
          "thumbnails",
          safeEntityType(attachment.entityType),
          `${path.basename(target)}.webp`
        ),
        { force: true }
      ).catch(() => undefined);
      attachmentFiles += 1;
    }
  }
  const exportFiles = await cleanupExportFiles(exportDays);

  return {
    auditLogs: audit.count,
    qrTokens: qr.count,
    sessions: sessions.count,
    jobs: jobs.count,
    attachmentFiles,
    exportFiles
  };
}
