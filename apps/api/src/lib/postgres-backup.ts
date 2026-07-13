import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { backupUploadedFiles, restoreUploadedFiles } from "./backup-assets";
import { getRuntimeServerConfig } from "./runtime-server-config";

export type NativeBackupMetadata = {
  version: number;
  format: "postgres-custom";
  app: "Muhaseb";
  createdAt: string;
  uploadsIncluded: boolean;
  tableCounts: Record<string, number>;
  uploadSnapshot?: { files: number; linked: number; copied: number } | null;
};

export function getBackupDir() {
  return getRuntimeServerConfig().backupDir;
}

export function formatBackupName(date = new Date()) {
  return `muhaseb-backup-${date.toISOString().replace(/:/g, "-").replace(/\./g, "-")}.dump`;
}

export function assertSafeBackupFilename(filename: string) {
  if (!/^muhaseb-backup-\d{4}-\d{2}-\d{2}T[\d-]+Z\.dump$/.test(filename)) {
    throw new Error("Invalid backup filename");
  }
}

function databaseUrl() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is required for PostgreSQL backup");
  return value;
}

function execute(
  command: string,
  args: string[],
  options: { stdinFile?: string; stdoutFile?: string } = {}
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      windowsHide: true,
      stdio: [options.stdinFile ? "pipe" : "ignore", options.stdoutFile ? "pipe" : "ignore", "pipe"]
    });
    let stderr = "";

    child.stderr!.on("data", (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-8000);
    });
    if (options.stdinFile) createReadStream(options.stdinFile).pipe(child.stdin!);
    if (options.stdoutFile) child.stdout!.pipe(createWriteStream(options.stdoutFile));
    child.on("error", (error) => reject(new Error(`${command} could not start: ${error.message}`)));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed with code ${code}: ${stderr.trim()}`));
    });
  });
}

function dockerContainer() {
  return process.env.PG_DOCKER_CONTAINER || "muhaseb_postgres";
}

async function executeSql(sql: string) {
  const args = ["--dbname", databaseUrl(), "--command", sql];

  try {
    await execute(process.env.PG_PSQL_PATH || "psql", args);
  } catch (error) {
    if (process.env.PG_DOCKER_FALLBACK === "false") throw error;
    await execute("docker", ["exec", dockerContainer(), "psql", "--dbname", databaseUrl(), "--command", sql]);
  }
}

async function createDump(filePath: string) {
  const args = [
    "--format=custom",
    "--no-owner",
    "--no-privileges",
    "--file",
    filePath,
    "--dbname",
    databaseUrl()
  ];

  try {
    await execute(process.env.PG_DUMP_PATH || "pg_dump", args);
  } catch (error) {
    if (process.env.PG_DOCKER_FALLBACK === "false") throw error;
    await execute(
      "docker",
      ["exec", dockerContainer(), "pg_dump", "--format=custom", "--no-owner", "--no-privileges", "--dbname", databaseUrl()],
      { stdoutFile: filePath }
    );
  }
}

async function restoreDump(filePath: string) {
  await executeSql(`
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid();
  `);

  const args = [
    "--clean",
    "--if-exists",
    "--single-transaction",
    "--exit-on-error",
    "--no-owner",
    "--no-privileges",
    "--dbname",
    databaseUrl(),
    filePath
  ];

  try {
    await execute(process.env.PG_RESTORE_PATH || "pg_restore", args);
  } catch (error) {
    if (process.env.PG_DOCKER_FALLBACK === "false") throw error;
    await execute(
      "docker",
      ["exec", "-i", dockerContainer(), "pg_restore", "--clean", "--if-exists", "--no-owner", "--no-privileges", "--dbname", databaseUrl()],
      { stdinFile: filePath }
    );
  }
}

function metadataPath(filePath: string) {
  return `${filePath}.meta.json`;
}

export async function readBackupMetadata(filePath: string): Promise<NativeBackupMetadata> {
  await access(filePath);
  const raw = await readFile(metadataPath(filePath), "utf8").catch(() => "");
  if (raw) return JSON.parse(raw) as NativeBackupMetadata;

  return {
    version: 3,
    format: "postgres-custom",
    app: "Muhaseb",
    createdAt: new Date().toISOString(),
    uploadsIncluded: false,
    tableCounts: {}
  };
}

export async function createNativeBackup() {
  const backupDir = getBackupDir();
  await mkdir(backupDir, { recursive: true });
  const filename = formatBackupName();
  const filePath = path.join(backupDir, filename);
  const includeUploads = process.env.BACKUP_UPLOADS_ENABLED !== "false";

  await createDump(filePath);

  const uploadSnapshot = includeUploads ? await backupUploadedFiles(filePath) : null;

  const metadata: NativeBackupMetadata = {
    version: 3,
    format: "postgres-custom",
    app: "Muhaseb",
    createdAt: new Date().toISOString(),
    uploadsIncluded: includeUploads,
    tableCounts: {},
    uploadSnapshot
  };
  await writeFile(metadataPath(filePath), JSON.stringify(metadata, null, 2), "utf8");

  return { filename, filePath, metadata };
}

export async function restoreNativeBackup(filePath: string) {
  await restoreDump(filePath);

  await restoreUploadedFiles(filePath);
}

export async function deleteBackupMetadata(filePath: string) {
  const { rm } = await import("node:fs/promises");
  await rm(metadataPath(filePath), { force: true });
}
