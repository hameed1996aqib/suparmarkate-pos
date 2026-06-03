const { PrismaClient } = require("./src/generated/prisma");

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        lower(table_name) LIKE '%stock%'
        OR lower(table_name) LIKE '%lot%'
        OR lower(table_name) LIKE '%inventory%'
      )
    ORDER BY table_name, ordinal_position
  `);

  console.table(rows);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });