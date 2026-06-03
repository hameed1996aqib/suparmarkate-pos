import "dotenv/config";
import { createAutomatedBackup } from "../modules/backups/service";
import { prisma } from "../lib/prisma";

try {
  const result = await createAutomatedBackup();
  console.log(`Backup created: ${result.filename}`);
} finally {
  await prisma.$disconnect();
}
