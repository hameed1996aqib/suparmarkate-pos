import { prisma } from "./prisma";

type BalanceMismatch = {
  productId: string;
  warehouseId: string;
  projectedQuantity: unknown;
  actualQuantity: unknown;
  projectedValue: unknown;
  actualValue: unknown;
};

export async function reconcileStockBalances(options: { repair?: boolean } = {}) {
  const mismatches = await prisma.$queryRaw<BalanceMismatch[]>`
    WITH actual AS (
      SELECT "productId", "warehouseId",
        COALESCE(SUM("remainingQuantity"), 0) quantity,
        COALESCE(SUM("remainingQuantity" * "baseUnitCost"), 0) value
      FROM "StockLot"
      WHERE "remainingQuantity" > 0
      GROUP BY "productId", "warehouseId"
    ),
    keys AS (
      SELECT "productId", "warehouseId" FROM actual
      UNION
      SELECT "productId", "warehouseId" FROM "StockBalance"
    )
    SELECT keys."productId", keys."warehouseId",
      COALESCE(sb."quantityBase", 0) "projectedQuantity",
      COALESCE(actual.quantity, 0) "actualQuantity",
      COALESCE(sb."valueBase", 0) "projectedValue",
      COALESCE(actual.value, 0) "actualValue"
    FROM keys
    LEFT JOIN actual USING ("productId", "warehouseId")
    LEFT JOIN "StockBalance" sb USING ("productId", "warehouseId")
    WHERE COALESCE(sb."quantityBase", 0) <> COALESCE(actual.quantity, 0)
       OR COALESCE(sb."valueBase", 0) <> COALESCE(actual.value, 0)
  `;

  if (options.repair !== false) {
    for (const mismatch of mismatches) {
      await prisma.$executeRaw`
        SELECT refresh_stock_balance(${mismatch.productId}, ${mismatch.warehouseId})
      `;
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    mismatches: mismatches.length,
    repaired: options.repair !== false ? mismatches.length : 0
  };
}

export function startStockBalanceReconciliationScheduler() {
  if (process.env.STOCK_RECONCILIATION_ENABLED === "false") return;

  const hours = Math.max(1, Number(process.env.STOCK_RECONCILIATION_INTERVAL_HOURS || 24));
  const run = async () => {
    try {
      const { enqueueJob } = await import("./persistent-jobs");
      await enqueueJob("STOCK_RECONCILE", { source: "schedule" });
    } catch (error) {
      console.error("[stock-reconciliation] failed", error);
    }
  };

  setTimeout(() => void run(), 30_000);
  setInterval(() => void run(), hours * 60 * 60 * 1000);
}
