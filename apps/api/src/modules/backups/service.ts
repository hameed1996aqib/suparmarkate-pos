import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { deleteUploadedFilesBackup } from "../../lib/backup-assets";
import {
  createNativeBackup,
  deleteBackupMetadata,
  getBackupDir,
  readBackupMetadata
} from "../../lib/postgres-backup";
import { getRuntimeServerConfig } from "../../lib/runtime-server-config";

export async function listBackupFiles() {
  const files = await readdir(getBackupDir()).catch(() => []);
  const rows = await Promise.all(
    files.filter((name) => name.endsWith(".dump")).map(async (name) => {
      const filePath = path.join(getBackupDir(), name);
      const fileStat = await stat(filePath);
      const metadata = await readBackupMetadata(filePath);
      return {
        id: name,
        name,
        date: metadata.createdAt || fileStat.mtime.toISOString(),
        sizeBytes: fileStat.size,
        size: fileStat.size < 1048576 ? `${(fileStat.size / 1024).toFixed(1)}KB` : `${(fileStat.size / 1048576).toFixed(2)}MB`,
        status: "موفق",
        format: metadata.format,
        uploadsIncluded: metadata.uploadsIncluded
      };
    })
  );
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

export async function pruneOldBackups() {
  const retention = getRuntimeServerConfig().backupRetentionCount;
  const files = await listBackupFiles();
  await Promise.all(
    files.slice(retention).map(async (file) => {
      const filePath = path.join(getBackupDir(), file.name);
      await rm(filePath, { force: true });
      await deleteBackupMetadata(filePath);
      await deleteUploadedFilesBackup(filePath);
    })
  );
}

export async function createAutomatedBackup() {
  const result = await createNativeBackup();
  await pruneOldBackups();
  return result;
}
