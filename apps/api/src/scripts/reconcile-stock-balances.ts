import "dotenv/config";
import { prisma } from "../lib/prisma";
import { reconcileStockBalances } from "../lib/stock-balance-reconciliation";

try {
  console.log(await reconcileStockBalances());
} finally {
  await prisma.$disconnect();
}
