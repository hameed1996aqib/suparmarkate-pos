import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";

export type RuntimeServerConfig = {
  backupDir: string;
  backupRetentionCount: number;
};

function configPath() {
  return path.resolve(
    process.env.SERVER_CONFIG_PATH || path.join(process.cwd(), "data", "server-config.json")
  );
}

function defaultConfig(): RuntimeServerConfig {
  return {
    backupDir: path.resolve(process.env.BACKUP_DIR || path.join(process.cwd(), "backups")),
    backupRetentionCount: Math.min(
      365,
      Math.max(1, Number.parseInt(process.env.BACKUP_RETENTION_COUNT || "7", 10) || 7)
    )
  };
}

function normalize(input: Partial<RuntimeServerConfig>): RuntimeServerConfig {
  const fallback = defaultConfig();
  const backupDir = path.resolve(String(input.backupDir || fallback.backupDir).trim());
  const backupRetentionCount = Math.min(
    365,
    Math.max(1, Number.parseInt(String(input.backupRetentionCount ?? fallback.backupRetentionCount), 10) || 7)
  );

  return { backupDir, backupRetentionCount };
}

function loadConfig() {
  try {
    return normalize(JSON.parse(readFileSync(configPath(), "utf8")) as Partial<RuntimeServerConfig>);
  } catch {
    return defaultConfig();
  }
}

let current = loadConfig();

export function getRuntimeServerConfig() {
  return { ...current };
}

export async function updateRuntimeServerConfig(input: Partial<RuntimeServerConfig>) {
  const next = normalize({ ...current, ...input });
  const target = configPath();
  const temporary = `${target}.tmp`;
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await rename(temporary, target);
  current = next;
  return getRuntimeServerConfig();
}

export async function ensureRuntimeServerConfigFile() {
  try {
    await readFile(configPath(), "utf8");
  } catch {
    await updateRuntimeServerConfig(current);
  }
}
