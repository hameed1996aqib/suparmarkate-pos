import "dotenv/config";
import { prisma } from "../lib/prisma";
import { readCliArgument } from "../lib/cli-arguments";
import { runIntegrityAudit } from "../lib/integrity-audit";
import { writeJsonArtifact } from "../lib/json-artifact";

const output = readCliArgument("output");
const label = readCliArgument("label") || "manual";

try {
  const report = await runIntegrityAudit(prisma, { label });

  if (output) {
    const absolute = await writeJsonArtifact(output, report);
    console.log(`Integrity report written to ${absolute}`);
  } else {
    console.log(JSON.stringify(report, null, 2));
  }

  if (report.summary.status === "blocked") {
    process.exitCode = 2;
  }
} finally {
  await prisma.$disconnect();
}
