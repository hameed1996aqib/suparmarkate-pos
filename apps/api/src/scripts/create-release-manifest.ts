import "dotenv/config";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../lib/prisma";
import { readCliArgument } from "../lib/cli-arguments";
import { runIntegrityAudit } from "../lib/integrity-audit";
import { writeJsonArtifact } from "../lib/json-artifact";

type RootPackage = {
  name: string;
  version: string;
};

function gitCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: path.resolve(process.cwd(), "../.."),
      encoding: "utf8"
    }).trim();
  } catch {
    return process.env.GITHUB_SHA || "unknown";
  }
}

const output =
  readCliArgument("output") ||
  `../../artifacts/release-gates/manifest-${Date.now()}.json`;
const phase = readCliArgument("phase") || "unassigned";
const backup = readCliArgument("backup") || null;

try {
  const rootPackage = JSON.parse(
    await readFile(path.resolve(process.cwd(), "../../package.json"), "utf8")
  ) as RootPackage;
  const integrity = await runIntegrityAudit(prisma, {
    label: `release-${phase}`
  });
  const manifest = {
    formatVersion: 1,
    createdAt: new Date().toISOString(),
    phase,
    application: {
      name: rootPackage.name,
      version: rootPackage.version,
      commit: gitCommit()
    },
    schema: {
      migration: integrity.database.latestMigration,
      migratedAt: integrity.database.latestMigrationFinishedAt
    },
    backup,
    integrity
  };
  const absolute = await writeJsonArtifact(output, manifest);

  console.log(`Release manifest written to ${absolute}`);
  if (integrity.summary.status === "blocked") {
    process.exitCode = 2;
  }
} finally {
  await prisma.$disconnect();
}
