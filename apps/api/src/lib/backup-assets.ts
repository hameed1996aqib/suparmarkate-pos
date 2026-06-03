import { copyFile, cp, link, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

type ManifestEntry = {
  relativePath: string;
  size: number;
  mtimeMs: number;
};

export function getUploadDir() {
  return path.resolve(path.join(process.cwd(), "uploads"));
}

function getBackupUploadDir(backupFilePath: string) {
  return `${backupFilePath}-uploads`;
}

function manifestPath(directory: string) {
  return path.join(directory, ".manifest.json");
}

async function walk(directory: string, root = directory): Promise<ManifestEntry[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const rows: ManifestEntry[] = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) rows.push(...(await walk(absolute, root)));
    else if (entry.isFile() && entry.name !== ".manifest.json") {
      const fileStat = await stat(absolute);
      rows.push({
        relativePath: path.relative(root, absolute),
        size: fileStat.size,
        mtimeMs: fileStat.mtimeMs
      });
    }
  }
  return rows;
}

async function previousSnapshot(destination: string) {
  const parent = path.dirname(destination);
  const candidates = (await readdir(parent, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(".dump-uploads"))
    .map((entry) => path.join(parent, entry.name))
    .filter((directory) => directory !== destination);

  const rows = await Promise.all(
    candidates.map(async (directory) => ({ directory, modified: (await stat(directory)).mtimeMs }))
  );
  return rows.sort((a, b) => b.modified - a.modified)[0]?.directory ?? null;
}

async function readManifest(directory: string | null) {
  if (!directory) return new Map<string, ManifestEntry>();
  const raw = await readFile(manifestPath(directory), "utf8").catch(() => "[]");
  return new Map((JSON.parse(raw) as ManifestEntry[]).map((entry) => [entry.relativePath, entry]));
}

export async function backupUploadedFiles(backupFilePath: string) {
  const source = getUploadDir();
  const destination = getBackupUploadDir(backupFilePath);
  const previous = await previousSnapshot(destination);
  const previousManifest = await readManifest(previous);
  const files = await walk(source);
  let linked = 0;
  let copied = 0;

  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });

  for (const file of files) {
    const sourceFile = path.join(source, file.relativePath);
    const destinationFile = path.join(destination, file.relativePath);
    await mkdir(path.dirname(destinationFile), { recursive: true });
    const previousFile = previous ? path.join(previous, file.relativePath) : "";
    const old = previousManifest.get(file.relativePath);

    if (old && old.size === file.size && old.mtimeMs === file.mtimeMs) {
      try {
        await link(previousFile, destinationFile);
        linked += 1;
        continue;
      } catch {
        // Cross-volume filesystems can reject hard links; copy remains correct.
      }
    }

    await copyFile(sourceFile, destinationFile);
    copied += 1;
  }

  await writeFile(manifestPath(destination), JSON.stringify(files, null, 2), "utf8");
  return { files: files.length, linked, copied };
}

export async function restoreUploadedFiles(backupFilePath: string) {
  const source = getBackupUploadDir(backupFilePath);
  const destination = getUploadDir();
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await cp(source, destination, { recursive: true, force: true }).catch(() => undefined);
  await rm(manifestPath(destination), { force: true });
}

export async function deleteUploadedFilesBackup(backupFilePath: string) {
  await rm(getBackupUploadDir(backupFilePath), { recursive: true, force: true });
}
