import "dotenv/config";

import { prisma } from "../lib/prisma";

type InvalidLotRow = {
  source: string;
  id: string;
  productId: string;
  warehouseId: string;
  initialQuantity: unknown;
  remainingQuantity: unknown;
};

try {
  const invalidLots = await prisma.$queryRaw<InvalidLotRow[]>`
    SELECT
      'StockLot'::text AS source,
      id,
      "productId",
      "warehouseId",
      "initialQuantity",
      "remainingQuantity"
    FROM "StockLot"
    WHERE "initialQuantity" < 0
       OR "remainingQuantity" < 0
       OR "remainingQuantity" > "initialQuantity"
    ORDER BY id
    LIMIT 100
  `;
  const invalidMovements = await prisma.$queryRaw<Array<{
    source: string;
    id: string;
    productId: string;
    warehouseId: string;
    quantity: unknown;
  }>>`
    SELECT
      'StockMovement'::text AS source,
      id,
      "productId",
      "warehouseId",
      quantity
    FROM "StockMovement"
    WHERE quantity <= 0
    ORDER BY id
    LIMIT 100
  `;

  if (invalidLots.length > 0 || invalidMovements.length > 0) {
    console.error(JSON.stringify({
      message: "Inventory constraints were not validated because invalid legacy rows exist.",
      sampleCount: invalidLots.length + invalidMovements.length,
      rows: [...invalidLots, ...invalidMovements],
    }, null, 2));
    process.exitCode = 2;
  } else {
    const statements = [
      'ALTER TABLE "StockLot" VALIDATE CONSTRAINT "StockLot_initialQuantity_nonnegative"',
      'ALTER TABLE "StockLot" VALIDATE CONSTRAINT "StockLot_remainingQuantity_nonnegative"',
      'ALTER TABLE "StockLot" VALIDATE CONSTRAINT "StockLot_remaining_not_above_initial"',
      'ALTER TABLE "StockMovement" VALIDATE CONSTRAINT "StockMovement_quantity_positive"',
    ];
    for (const statement of statements) {
      await prisma.$executeRawUnsafe(statement);
    }
    console.log("All additive inventory constraints validated successfully.");
  }
} finally {
  await prisma.$disconnect();
}
