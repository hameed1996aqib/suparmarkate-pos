import { prisma } from "./src/lib/prisma";

async function main() {
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      productId: string;
      warehouseId: string;
      remainingQuantity: string;
      unitCost: string;
    }>
  >(`
    SELECT "id", "productId", "warehouseId", "remainingQuantity", "unitCost"
    FROM "StockLot"
    WHERE COALESCE("remainingQuantity", 0) > 0
      AND COALESCE("unitCost", 0) > 0
    ORDER BY "createdAt" DESC
    LIMIT 5
  `);

  console.table(rows);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });