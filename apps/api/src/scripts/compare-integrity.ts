import { readFile } from "node:fs/promises";
import path from "node:path";
import { readCliArgument } from "../lib/cli-arguments";
import { compareIntegrityReports } from "../lib/integrity-compare";
import type { IntegrityAuditReport } from "../lib/integrity-audit";
import { writeJsonArtifact } from "../lib/json-artifact";

async function readReport(filePath: string) {
  const raw = await readFile(path.resolve(filePath), "utf8");
  return JSON.parse(raw) as IntegrityAuditReport;
}

const beforePath = readCliArgument("before");
const afterPath = readCliArgument("after");
const output = readCliArgument("output");

if (!beforePath || !afterPath) {
  throw new Error("--before and --after integrity report paths are required.");
}

const comparison = compareIntegrityReports(
  await readReport(beforePath),
  await readReport(afterPath)
);

if (output) {
  const absolute = await writeJsonArtifact(output, comparison);
  console.log(`Integrity comparison written to ${absolute}`);
} else {
  console.log(JSON.stringify(comparison, null, 2));
}

if (!comparison.passed) {
  process.exitCode = 2;
}
