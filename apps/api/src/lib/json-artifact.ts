import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export async function writeJsonArtifact(filePath: string, value: unknown) {
  const absolute = path.resolve(filePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return absolute;
}
