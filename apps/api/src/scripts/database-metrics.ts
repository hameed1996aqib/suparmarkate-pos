import "dotenv/config";
import { prisma } from "../lib/prisma";

try {
  const tables = await prisma.$queryRaw<Array<{ table: string; totalBytes: bigint; rows: bigint }>>`
    SELECT relname "table", pg_total_relation_size(relid) "totalBytes", n_live_tup::bigint rows
    FROM pg_stat_user_tables
    ORDER BY pg_total_relation_size(relid) DESC
  `;
  console.table(tables.map((row) => ({
    table: row.table,
    rows: Number(row.rows),
    sizeMB: Math.round(Number(row.totalBytes) / 1024 / 1024 * 100) / 100
  })));
} finally {
  await prisma.$disconnect();
}
