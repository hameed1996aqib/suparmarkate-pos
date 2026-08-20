import { createHash } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client";

type CountRow = { count: bigint | number | string };
type TextValue = string | number | bigint | null;

type DatabaseIdentityRow = {
  databaseName: string;
  serverVersion: string;
};

type MigrationRow = {
  migrationName: string;
  finishedAt: Date | string | null;
};

type IntegritySampleRow = {
  code: string;
  identifier: string;
};

type IntegritySchemaFeatures = {
  hasInventoryOperation: boolean;
  hasMovementOperationId: boolean;
  hasMovementOccurredAt: boolean;
  hasAttendanceLocalDate: boolean;
};

type BusinessSnapshotRow = {
  products: bigint | number | string;
  stockLots: bigint | number | string;
  stockMovements: bigint | number | string;
  sales: bigint | number | string;
  saleReturns: bigint | number | string;
  purchases: bigint | number | string;
  purchaseReturns: bigint | number | string;
  journalEntries: bigint | number | string;
  stockQuantityBase: TextValue;
  stockValueBase: TextValue;
  journalBaseDebit: TextValue;
  journalBaseCredit: TextValue;
  completedSaleBaseTotal: TextValue;
  completedPurchaseBaseTotal: TextValue;
};

export type IntegritySeverity = "blocker" | "warning";

export type IntegrityIssue = {
  code: string;
  severity: IntegritySeverity;
  count: number;
  description: string;
  recommendation?: string;
  sampleIds?: string[];
};

export type BusinessSnapshot = {
  counts: {
    products: number;
    stockLots: number;
    stockMovements: number;
    sales: number;
    saleReturns: number;
    purchases: number;
    purchaseReturns: number;
    journalEntries: number;
  };
  totals: {
    stockQuantityBase: string;
    stockValueBase: string;
    journalBaseDebit: string;
    journalBaseCredit: string;
    completedSaleBaseTotal: string;
    completedPurchaseBaseTotal: string;
  };
  fingerprint: string;
};

export type IntegrityMetrics = {
  unbalancedJournals: number;
  salesMissingCogs: number;
  negativeStockBalances: number;
  negativeStockLots: number;
  stockBalanceMismatches: number;
  salesMissingBaseSnapshot: number;
  moneyTransactionsMissingBaseSnapshot: number;
  journalLinesMissingBaseSnapshot: number;
  activeBaseCurrencies: number;
  activeAfnBaseCurrencies: number;
  duplicateJournalSources: number;
  duplicateNormalizedBarcodeGroups: number;
  barcodesMissingNormalizedValue: number;
  stockLotsAboveInitial: number;
  stockMovementLedgerMismatches: number;
  inactiveStockLocations: number;
  incompleteStockMovementSnapshots: number;
  stockMovementsMissingOperation: number;
  stockMovementsMissingOccurredAt: number;
  partialInventoryOperations: number;
  attendanceLocalDateCollisions: number;
  attendanceLocalDateMismatches: number;
};

export type IntegrityAuditReport = {
  formatVersion: 1;
  label: string;
  generatedAt: string;
  database: {
    name: string;
    serverVersion: string;
    latestMigration: string | null;
    latestMigrationFinishedAt: string | null;
  };
  metrics: IntegrityMetrics;
  issues: IntegrityIssue[];
  summary: {
    status: "pass" | "blocked";
    blockers: number;
    warnings: number;
  };
  businessSnapshot: BusinessSnapshot;
};

const blockerDefinitions: Array<{
  key: keyof IntegrityMetrics;
  code: string;
  description: string;
}> = [
  {
    key: "unbalancedJournals",
    code: "UNBALANCED_JOURNALS",
    description: "Journal debit and credit totals do not balance."
  },
  {
    key: "negativeStockBalances",
    code: "NEGATIVE_STOCK_BALANCES",
    description: "Projected stock contains an unauthorized negative quantity."
  },
  {
    key: "negativeStockLots",
    code: "NEGATIVE_STOCK_LOTS",
    description: "One or more stock lots have a negative remaining quantity."
  },
  {
    key: "stockBalanceMismatches",
    code: "STOCK_BALANCE_MISMATCHES",
    description: "StockBalance does not match the sum of active stock lots."
  },
  {
    key: "activeBaseCurrencies",
    code: "INVALID_BASE_CURRENCY_COUNT",
    description: "Exactly one active base currency is required."
  },
  {
    key: "activeAfnBaseCurrencies",
    code: "AFN_NOT_THE_ONLY_BASE_CURRENCY",
    description: "AFN must be the one active base currency."
  },
  {
    key: "duplicateJournalSources",
    code: "DUPLICATE_JOURNAL_SOURCES",
    description: "A source document is linked to more than one journal entry."
  },
  {
    key: "stockLotsAboveInitial",
    code: "STOCK_LOTS_ABOVE_INITIAL",
    description: "A stock lot has a remaining quantity greater than its initial quantity."
  },
  {
    key: "stockMovementLedgerMismatches",
    code: "STOCK_MOVEMENT_LEDGER_MISMATCHES",
    description: "The signed movement ledger does not reconcile to the current lot quantity."
  },
  {
    key: "attendanceLocalDateCollisions",
    code: "ATTENDANCE_LOCAL_DATE_COLLISIONS",
    description: "More than one attendance record resolves to the same employee and Kabul date."
  }
];

const warningDefinitions: Array<{
  key: keyof IntegrityMetrics;
  code: string;
  description: string;
}> = [
  {
    key: "salesMissingCogs",
    code: "SALES_MISSING_COGS",
    description: "Completed sales with a known cost are missing a COGS journal."
  },
  {
    key: "salesMissingBaseSnapshot",
    code: "SALES_MISSING_BASE_SNAPSHOT",
    description: "Sales are missing a valid base-currency snapshot."
  },
  {
    key: "moneyTransactionsMissingBaseSnapshot",
    code: "MONEY_TRANSACTIONS_MISSING_BASE_SNAPSHOT",
    description: "Money transactions are missing a valid base-currency snapshot."
  },
  {
    key: "journalLinesMissingBaseSnapshot",
    code: "JOURNAL_LINES_MISSING_BASE_SNAPSHOT",
    description: "Journal lines are missing a valid base-currency snapshot."
  },
  {
    key: "duplicateNormalizedBarcodeGroups",
    code: "DUPLICATE_NORMALIZED_BARCODES",
    description: "Active products share the same normalized barcode."
  },
  {
    key: "barcodesMissingNormalizedValue",
    code: "BARCODES_MISSING_NORMALIZED_VALUE",
    description: "Legacy products have a barcode but no normalized barcode value."
  },
  {
    key: "inactiveStockLocations",
    code: "INACTIVE_STOCK_LOCATIONS",
    description: "Positive stock exists for an inactive or deleted product/warehouse."
  },
  {
    key: "incompleteStockMovementSnapshots",
    code: "INCOMPLETE_STOCK_MOVEMENT_SNAPSHOTS",
    description: "Stock movements are missing a valid cost or currency snapshot."
  },
  {
    key: "stockMovementsMissingOperation",
    code: "STOCK_MOVEMENTS_MISSING_OPERATION",
    description: "Legacy or partial stock movements are not linked to an inventory operation."
  },
  {
    key: "stockMovementsMissingOccurredAt",
    code: "STOCK_MOVEMENTS_MISSING_OCCURRED_AT",
    description: "Legacy stock movements do not have an explicit business occurrence time."
  },
  {
    key: "partialInventoryOperations",
    code: "PARTIAL_INVENTORY_OPERATIONS",
    description: "Inventory operations are empty or have an incomplete cancellation state."
  },
  {
    key: "attendanceLocalDateMismatches",
    code: "ATTENDANCE_LOCAL_DATE_MISMATCHES",
    description: "Stored attendance localDate differs from the Kabul date derived from its timestamp."
  }
];

function toNumber(value: CountRow["count"] | undefined) {
  return Number(value ?? 0);
}

function decimalText(value: TextValue | undefined) {
  if (value === null || value === undefined) return "0";
  return String(value);
}

function isExpectedSingleBaseMetric(key: keyof IntegrityMetrics) {
  return key === "activeBaseCurrencies" || key === "activeAfnBaseCurrencies";
}

const issueRecommendations: Record<string, string> = {
  UNBALANCED_JOURNALS: "Open the listed journals and correct them with an explicit reversing entry; never edit posted lines in place.",
  SALES_MISSING_COGS: "Review each sale and use the admin COGS repair action only after confirming its stored lot costs.",
  NEGATIVE_STOCK_BALANCES: "Block further writes for the product and reconcile its lots and movements before an admin adjustment.",
  NEGATIVE_STOCK_LOTS: "Inspect the lot movement chain and correct it with a reviewed inventory adjustment.",
  STOCK_BALANCE_MISMATCHES: "Rebuild only the listed StockBalance projections from StockLot after reviewing the mismatch.",
  SALES_MISSING_BASE_SNAPSHOT: "Review the document currency and rate; repair the snapshot only with admin approval.",
  MONEY_TRANSACTIONS_MISSING_BASE_SNAPSHOT: "Review the transaction currency and rate before an approved snapshot repair.",
  JOURNAL_LINES_MISSING_BASE_SNAPSHOT: "Review the source document and rebuild the base values through an approved accounting repair.",
  INVALID_BASE_CURRENCY_COUNT: "Keep exactly one active base currency.",
  AFN_NOT_THE_ONLY_BASE_CURRENCY: "Keep AFN as the only active base currency.",
  DUPLICATE_JOURNAL_SOURCES: "Review duplicate source journals and reverse the invalid duplicate; do not delete posted entries.",
  DUPLICATE_NORMALIZED_BARCODES: "Use the duplicate-barcode admin workflow to change a barcode or perform a reviewed merge.",
  BARCODES_MISSING_NORMALIZED_VALUE: "Run the barcode normalization preview and update only non-conflicting products.",
  STOCK_LOTS_ABOVE_INITIAL: "Inspect the lot reversals and returns, then correct the movement chain with an approved adjustment.",
  STOCK_MOVEMENT_LEDGER_MISMATCHES: "Compare the listed lot with all of its movements and repair it through an explicit admin operation.",
  INACTIVE_STOCK_LOCATIONS: "Reactivate the referenced product or warehouse, or transfer/adjust its stock after admin review.",
  INCOMPLETE_STOCK_MOVEMENT_SNAPSHOTS: "Review the source document currency and cost; do not infer historical costs automatically.",
  STOCK_MOVEMENTS_MISSING_OPERATION: "Treat these as legacy movements and link them only through an admin-reviewed migration tool.",
  STOCK_MOVEMENTS_MISSING_OCCURRED_AT: "Keep createdAt as the legacy fallback unless an admin confirms the business date.",
  PARTIAL_INVENTORY_OPERATIONS: "Inspect the complete operation and its movement splits before cancelling or recreating it.",
  ATTENDANCE_LOCAL_DATE_COLLISIONS: "Resolve each employee-day collision manually; never merge attendance records automatically.",
  ATTENDANCE_LOCAL_DATE_MISMATCHES: "Review the record timestamp and set localDate only after confirming the Kabul workday."
};

export function evaluateIntegrityMetrics(
  metrics: IntegrityMetrics,
  samples: Partial<Record<string, string[]>> = {}
) {
  const issues: IntegrityIssue[] = [];

  for (const definition of blockerDefinitions) {
    const value = metrics[definition.key];
    const invalid = isExpectedSingleBaseMetric(definition.key) ? value !== 1 : value > 0;
    if (!invalid) continue;

    issues.push({
      code: definition.code,
      severity: "blocker",
      count: value,
      description: definition.description,
      recommendation: issueRecommendations[definition.code] ?? "Review this finding before changing business data.",
      sampleIds: samples[definition.code] ?? []
    });
  }

  for (const definition of warningDefinitions) {
    const value = metrics[definition.key];
    if (value <= 0) continue;

    issues.push({
      code: definition.code,
      severity: "warning",
      count: value,
      description: definition.description,
      recommendation: issueRecommendations[definition.code] ?? "Review this finding before changing business data.",
      sampleIds: samples[definition.code] ?? []
    });
  }

  const blockers = issues.filter((issue) => issue.severity === "blocker").length;
  const warnings = issues.length - blockers;

  return {
    issues,
    summary: {
      status: blockers === 0 ? ("pass" as const) : ("blocked" as const),
      blockers,
      warnings
    }
  };
}

function buildBusinessSnapshot(row: BusinessSnapshotRow): BusinessSnapshot {
  const snapshotWithoutHash = {
    counts: {
      products: toNumber(row.products),
      stockLots: toNumber(row.stockLots),
      stockMovements: toNumber(row.stockMovements),
      sales: toNumber(row.sales),
      saleReturns: toNumber(row.saleReturns),
      purchases: toNumber(row.purchases),
      purchaseReturns: toNumber(row.purchaseReturns),
      journalEntries: toNumber(row.journalEntries)
    },
    totals: {
      stockQuantityBase: decimalText(row.stockQuantityBase),
      stockValueBase: decimalText(row.stockValueBase),
      journalBaseDebit: decimalText(row.journalBaseDebit),
      journalBaseCredit: decimalText(row.journalBaseCredit),
      completedSaleBaseTotal: decimalText(row.completedSaleBaseTotal),
      completedPurchaseBaseTotal: decimalText(row.completedPurchaseBaseTotal)
    }
  };

  return {
    ...snapshotWithoutHash,
    fingerprint: createHash("sha256")
      .update(JSON.stringify(snapshotWithoutHash))
      .digest("hex")
  };
}

function groupIntegritySamples(rows: IntegritySampleRow[]) {
  return rows.reduce<Partial<Record<string, string[]>>>((result, row) => {
    const values = result[row.code] ?? [];
    if (values.length < 10 && !values.includes(row.identifier)) values.push(row.identifier);
    result[row.code] = values;
    return result;
  }, {});
}

async function loadIntegritySamples(
  db: PrismaClient,
  schema: IntegritySchemaFeatures | undefined
) {
  const baseRows = await db.$queryRaw<IntegritySampleRow[]>`
    WITH lot_ledger AS (
      SELECT
        "lotId",
        SUM(CASE
          WHEN type IN ('OPENING_STOCK', 'PURCHASE', 'SALE_RETURN', 'ADJUSTMENT_IN', 'TRANSFER_IN') THEN quantity
          ELSE -quantity
        END) AS quantity
      FROM "StockMovement"
      WHERE "lotId" IS NOT NULL
      GROUP BY "lotId"
    ), actual_balance AS (
      SELECT "productId", "warehouseId", SUM("remainingQuantity") AS quantity,
        SUM("remainingQuantity" * "baseUnitCost") AS value
      FROM "StockLot"
      GROUP BY "productId", "warehouseId"
    ), balance_keys AS (
      SELECT "productId", "warehouseId" FROM actual_balance
      UNION SELECT "productId", "warehouseId" FROM "StockBalance"
    ), samples AS (
      SELECT 'UNBALANCED_JOURNALS'::text AS code, journal.id::text AS identifier
      FROM "JournalEntry" journal LEFT JOIN "JournalLine" line ON line."journalEntryId" = journal.id
      GROUP BY journal.id
      HAVING ABS(COALESCE(SUM(line.debit), 0) - COALESCE(SUM(line.credit), 0)) > 0.0001
        OR ABS(COALESCE(SUM(line."baseDebit"), 0) - COALESCE(SUM(line."baseCredit"), 0)) > 0.0001
      UNION ALL
      SELECT 'SALES_MISSING_COGS', sale.id FROM "Sale" sale
      WHERE sale.status = 'COMPLETED'
        AND EXISTS (SELECT 1 FROM "SaleItem" item WHERE item."saleId" = sale.id AND COALESCE(item."baseTotalCost", item."totalCost", 0) > 0)
        AND NOT EXISTS (SELECT 1 FROM "JournalEntry" journal WHERE journal."sourceId" = sale.id AND journal."sourceType" IN ('POS_SALE_COGS', 'SALE_COGS'))
      UNION ALL
      SELECT 'NEGATIVE_STOCK_BALANCES', "productId" || ':' || "warehouseId" FROM "StockBalance" WHERE "quantityBase" < 0
      UNION ALL
      SELECT 'NEGATIVE_STOCK_LOTS', id FROM "StockLot" WHERE "remainingQuantity" < 0
      UNION ALL
      SELECT 'STOCK_BALANCE_MISMATCHES', keys."productId" || ':' || keys."warehouseId"
      FROM balance_keys keys
      LEFT JOIN actual_balance actual USING ("productId", "warehouseId")
      LEFT JOIN "StockBalance" balance USING ("productId", "warehouseId")
      WHERE ABS(COALESCE(balance."quantityBase", 0) - COALESCE(actual.quantity, 0)) > 0.0001
         OR ABS(COALESCE(balance."valueBase", 0) - COALESCE(actual.value, 0)) > 0.0001
      UNION ALL
      SELECT 'SALES_MISSING_BASE_SNAPSHOT', id FROM "Sale"
      WHERE status = 'COMPLETED' AND ("baseCurrencyId" IS NULL OR "exchangeRate" <= 0 OR (total <> 0 AND "baseTotal" = 0))
      UNION ALL
      SELECT 'MONEY_TRANSACTIONS_MISSING_BASE_SNAPSHOT', id FROM "MoneyTransaction"
      WHERE "baseCurrencyId" IS NULL OR "exchangeRate" <= 0 OR (amount <> 0 AND "baseAmount" = 0)
      UNION ALL
      SELECT 'JOURNAL_LINES_MISSING_BASE_SNAPSHOT', id FROM "JournalLine"
      WHERE (debit <> 0 OR credit <> 0) AND ("baseCurrencyId" IS NULL OR "exchangeRate" <= 0 OR (debit <> 0 AND "baseDebit" = 0) OR (credit <> 0 AND "baseCredit" = 0))
      UNION ALL
      SELECT 'INVALID_BASE_CURRENCY_COUNT', id FROM "Currency" WHERE "isBase" = true AND "isActive" = true AND "deletedAt" IS NULL
      UNION ALL
      SELECT 'AFN_NOT_THE_ONLY_BASE_CURRENCY', id FROM "Currency" WHERE "isBase" = true AND "isActive" = true AND "deletedAt" IS NULL
      UNION ALL
      SELECT 'DUPLICATE_JOURNAL_SOURCES', "sourceType" || ':' || "sourceId" FROM "JournalEntry"
      WHERE "sourceType" IS NOT NULL AND "sourceId" IS NOT NULL GROUP BY "sourceType", "sourceId" HAVING COUNT(*) > 1
      UNION ALL
      SELECT 'DUPLICATE_NORMALIZED_BARCODES', "barcodeNormalized" FROM "Product"
      WHERE "barcodeNormalized" IS NOT NULL AND "deletedAt" IS NULL AND "isActive" = true
      GROUP BY "barcodeNormalized" HAVING COUNT(*) > 1
      UNION ALL
      SELECT 'BARCODES_MISSING_NORMALIZED_VALUE', id FROM "Product"
      WHERE barcode IS NOT NULL AND "barcodeNormalized" IS NULL AND "deletedAt" IS NULL AND "isActive" = true
      UNION ALL
      SELECT 'STOCK_LOTS_ABOVE_INITIAL', id FROM "StockLot" WHERE "remainingQuantity" > "initialQuantity" + 0.0001
      UNION ALL
      SELECT 'STOCK_MOVEMENT_LEDGER_MISMATCHES', lot.id FROM "StockLot" lot
      LEFT JOIN lot_ledger ledger ON ledger."lotId" = lot.id
      WHERE ABS(lot."remainingQuantity" - COALESCE(ledger.quantity, 0)) > 0.0001
      UNION ALL
      SELECT 'INACTIVE_STOCK_LOCATIONS', lot.id FROM "StockLot" lot
      JOIN "Product" product ON product.id = lot."productId" JOIN "Warehouse" warehouse ON warehouse.id = lot."warehouseId"
      WHERE lot."remainingQuantity" > 0 AND (product."deletedAt" IS NOT NULL OR product."isActive" = false OR warehouse."deletedAt" IS NOT NULL OR warehouse."isActive" = false)
      UNION ALL
      SELECT 'INCOMPLETE_STOCK_MOVEMENT_SNAPSHOTS', id FROM "StockMovement"
      WHERE quantity <> 0 AND ("exchangeRate" IS NULL OR "exchangeRate" <= 0 OR "baseUnitCost" IS NULL OR "unitCost" IS NULL)
    ), ranked AS (
      SELECT code, identifier, ROW_NUMBER() OVER (PARTITION BY code ORDER BY identifier) AS row_number FROM samples
    )
    SELECT code, identifier FROM ranked WHERE row_number <= 10
  `;

  const extensionRows: IntegritySampleRow[] = [];
  if (schema?.hasInventoryOperation && schema.hasMovementOperationId) {
    extensionRows.push(...await db.$queryRaw<IntegritySampleRow[]>`
      SELECT 'PARTIAL_INVENTORY_OPERATIONS' AS code, operation.id AS identifier
      FROM "InventoryOperation" operation
      WHERE NOT EXISTS (SELECT 1 FROM "StockMovement" movement WHERE movement."operationId" = operation.id)
         OR (operation.status = 'CANCELLED' AND NOT EXISTS (
           SELECT 1 FROM "StockMovement" movement WHERE movement."operationId" = operation.id AND movement."referenceType" LIKE '%_CANCEL'
         ))
      LIMIT 10
    `);
    extensionRows.push(...await db.$queryRaw<IntegritySampleRow[]>`
      SELECT 'STOCK_MOVEMENTS_MISSING_OPERATION' AS code, id AS identifier
      FROM "StockMovement" WHERE "operationId" IS NULL ORDER BY id LIMIT 10
    `);
  }
  if (schema?.hasMovementOccurredAt) {
    extensionRows.push(...await db.$queryRaw<IntegritySampleRow[]>`
      SELECT 'STOCK_MOVEMENTS_MISSING_OCCURRED_AT' AS code, id AS identifier
      FROM "StockMovement" WHERE "occurredAt" IS NULL ORDER BY id LIMIT 10
    `);
  }
  if (schema?.hasAttendanceLocalDate) {
    extensionRows.push(...await db.$queryRaw<IntegritySampleRow[]>`
      SELECT 'ATTENDANCE_LOCAL_DATE_COLLISIONS' AS code,
        "employeeId" || ':' || TO_CHAR((date AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kabul', 'YYYY-MM-DD') AS identifier
      FROM "AttendanceRecord" GROUP BY "employeeId", identifier HAVING COUNT(*) > 1 LIMIT 10
    `);
    extensionRows.push(...await db.$queryRaw<IntegritySampleRow[]>`
      SELECT 'ATTENDANCE_LOCAL_DATE_MISMATCHES' AS code, id AS identifier
      FROM "AttendanceRecord"
      WHERE "localDate" IS NOT NULL AND "localDate" <> TO_CHAR((date AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kabul', 'YYYY-MM-DD')
      ORDER BY id LIMIT 10
    `);
  }

  return groupIntegritySamples([...baseRows, ...extensionRows]);
}

export async function runIntegrityAudit(
  db: PrismaClient,
  options: { label?: string } = {}
): Promise<IntegrityAuditReport> {
  const [
    identityRows,
    migrationRows,
    unbalancedRows,
    missingCogsRows,
    negativeBalanceRows,
    negativeLotRows,
    mismatchRows,
    saleBaseRows,
    moneyBaseRows,
    journalBaseRows,
    baseCurrencyRows,
    afnBaseCurrencyRows,
    duplicateJournalRows,
    duplicateBarcodeRows,
    missingNormalizedRows,
    snapshotRows
  ] = await db.$transaction([
    db.$queryRaw<DatabaseIdentityRow[]>`
      SELECT
        current_database() AS "databaseName",
        current_setting('server_version') AS "serverVersion"
    `,
    db.$queryRaw<MigrationRow[]>`
      SELECT
        migration_name AS "migrationName",
        finished_at AS "finishedAt"
      FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL
        AND rolled_back_at IS NULL
      ORDER BY finished_at DESC
      LIMIT 1
    `,
    db.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::bigint AS count
      FROM (
        SELECT je.id
        FROM "JournalEntry" je
        LEFT JOIN "JournalLine" jl ON jl."journalEntryId" = je.id
        GROUP BY je.id
        HAVING ABS(COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0)) > 0.0001
          OR ABS(COALESCE(SUM(jl."baseDebit"), 0) - COALESCE(SUM(jl."baseCredit"), 0)) > 0.0001
      ) unbalanced
    `,
    db.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::bigint AS count
      FROM "Sale" sale
      WHERE sale.status = 'COMPLETED'
        AND EXISTS (
          SELECT 1
          FROM "SaleItem" item
          WHERE item."saleId" = sale.id
            AND COALESCE(item."baseTotalCost", item."totalCost", 0) > 0
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "JournalEntry" journal
          WHERE journal."sourceId" = sale.id
            AND journal."sourceType" IN ('POS_SALE_COGS', 'SALE_COGS')
        )
    `,
    db.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::bigint AS count
      FROM "StockBalance"
      WHERE "quantityBase" < 0
    `,
    db.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::bigint AS count
      FROM "StockLot"
      WHERE "remainingQuantity" < 0
    `,
    db.$queryRaw<CountRow[]>`
      WITH actual AS (
        SELECT
          "productId",
          "warehouseId",
          COALESCE(SUM("remainingQuantity"), 0) AS quantity,
          COALESCE(SUM("remainingQuantity" * "baseUnitCost"), 0) AS value
        FROM "StockLot"
        GROUP BY "productId", "warehouseId"
      ),
      keys AS (
        SELECT "productId", "warehouseId" FROM actual
        UNION
        SELECT "productId", "warehouseId" FROM "StockBalance"
      )
      SELECT COUNT(*)::bigint AS count
      FROM keys
      LEFT JOIN actual USING ("productId", "warehouseId")
      LEFT JOIN "StockBalance" balance USING ("productId", "warehouseId")
      WHERE ABS(COALESCE(balance."quantityBase", 0) - COALESCE(actual.quantity, 0)) > 0.0001
         OR ABS(COALESCE(balance."valueBase", 0) - COALESCE(actual.value, 0)) > 0.0001
    `,
    db.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::bigint AS count
      FROM "Sale"
      WHERE status = 'COMPLETED'
        AND (
          "baseCurrencyId" IS NULL
          OR "exchangeRate" <= 0
          OR (total <> 0 AND "baseTotal" = 0)
        )
    `,
    db.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::bigint AS count
      FROM "MoneyTransaction"
      WHERE "baseCurrencyId" IS NULL
         OR "exchangeRate" <= 0
         OR (amount <> 0 AND "baseAmount" = 0)
    `,
    db.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::bigint AS count
      FROM "JournalLine"
      WHERE (debit <> 0 OR credit <> 0)
        AND (
          "baseCurrencyId" IS NULL
          OR "exchangeRate" <= 0
          OR ((debit <> 0 AND "baseDebit" = 0) OR (credit <> 0 AND "baseCredit" = 0))
        )
    `,
    db.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::bigint AS count
      FROM "Currency"
      WHERE "isBase" = true
        AND "isActive" = true
        AND "deletedAt" IS NULL
    `,
    db.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::bigint AS count
      FROM "Currency"
      WHERE code = 'AFN'
        AND "isBase" = true
        AND "isActive" = true
        AND "deletedAt" IS NULL
    `,
    db.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::bigint AS count
      FROM (
        SELECT "sourceType", "sourceId"
        FROM "JournalEntry"
        WHERE "sourceType" IS NOT NULL
          AND "sourceId" IS NOT NULL
        GROUP BY "sourceType", "sourceId"
        HAVING COUNT(*) > 1
      ) duplicated
    `,
    db.$queryRaw<CountRow[]>`
      WITH normalized AS (
        SELECT
          NULLIF(
            regexp_replace(
              translate(
                COALESCE(barcode, ''),
                '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩',
                '01234567890123456789'
              ),
              '[[:space:]‌‍⁠-]+',
              '',
              'g'
            ),
            ''
          ) AS value
        FROM "Product"
        WHERE barcode IS NOT NULL
          AND "deletedAt" IS NULL
          AND "isActive" = true
      )
      SELECT COUNT(*)::bigint AS count
      FROM (
        SELECT value
        FROM normalized
        WHERE value IS NOT NULL
        GROUP BY value
        HAVING COUNT(*) > 1
      ) duplicated
    `,
    db.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::bigint AS count
      FROM "Product"
      WHERE barcode IS NOT NULL
        AND "barcodeNormalized" IS NULL
        AND "deletedAt" IS NULL
        AND "isActive" = true
    `,
    db.$queryRaw<BusinessSnapshotRow[]>`
      SELECT
        (SELECT COUNT(*) FROM "Product")::bigint AS products,
        (SELECT COUNT(*) FROM "StockLot")::bigint AS "stockLots",
        (SELECT COUNT(*) FROM "StockMovement")::bigint AS "stockMovements",
        (SELECT COUNT(*) FROM "Sale")::bigint AS sales,
        (SELECT COUNT(*) FROM "SaleReturn")::bigint AS "saleReturns",
        (SELECT COUNT(*) FROM "Purchase")::bigint AS purchases,
        (SELECT COUNT(*) FROM "PurchaseReturn")::bigint AS "purchaseReturns",
        (SELECT COUNT(*) FROM "JournalEntry")::bigint AS "journalEntries",
        (SELECT COALESCE(SUM("quantityBase"), 0) FROM "StockBalance") AS "stockQuantityBase",
        (SELECT COALESCE(SUM("valueBase"), 0) FROM "StockBalance") AS "stockValueBase",
        (SELECT COALESCE(SUM("baseDebit"), 0) FROM "JournalLine") AS "journalBaseDebit",
        (SELECT COALESCE(SUM("baseCredit"), 0) FROM "JournalLine") AS "journalBaseCredit",
        (
          SELECT COALESCE(SUM("baseTotal"), 0)
          FROM "Sale"
          WHERE status = 'COMPLETED'
        ) AS "completedSaleBaseTotal",
        (
          SELECT COALESCE(SUM("baseTotal"), 0)
          FROM "Purchase"
          WHERE status = 'COMPLETED'
        ) AS "completedPurchaseBaseTotal"
    `
  ], {
    isolationLevel: "RepeatableRead",
    timeout: 120_000
  });

  const [schemaRows, stockAuditResults] = await Promise.all([
    db.$queryRaw<Array<{
      hasInventoryOperation: boolean;
      hasMovementOperationId: boolean;
      hasMovementOccurredAt: boolean;
      hasAttendanceLocalDate: boolean;
    }>>`
      SELECT
        to_regclass('public."InventoryOperation"') IS NOT NULL AS "hasInventoryOperation",
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'StockMovement' AND column_name = 'operationId'
        ) AS "hasMovementOperationId",
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'StockMovement' AND column_name = 'occurredAt'
        ) AS "hasMovementOccurredAt",
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'AttendanceRecord' AND column_name = 'localDate'
        ) AS "hasAttendanceLocalDate"
    `,
    db.$transaction([
      db.$queryRaw<CountRow[]>`
        SELECT COUNT(*)::bigint AS count
        FROM "StockLot"
        WHERE "remainingQuantity" > "initialQuantity" + 0.0001
      `,
      db.$queryRaw<CountRow[]>`
        WITH ledger AS (
          SELECT
            "lotId",
            SUM(
              CASE
                WHEN type IN ('OPENING_STOCK', 'PURCHASE', 'SALE_RETURN', 'ADJUSTMENT_IN', 'TRANSFER_IN')
                  THEN quantity
                ELSE -quantity
              END
            ) AS quantity
          FROM "StockMovement"
          WHERE "lotId" IS NOT NULL
          GROUP BY "lotId"
        )
        SELECT COUNT(*)::bigint AS count
        FROM "StockLot" lot
        LEFT JOIN ledger ON ledger."lotId" = lot.id
        WHERE ABS(lot."remainingQuantity" - COALESCE(ledger.quantity, 0)) > 0.0001
      `,
      db.$queryRaw<CountRow[]>`
        SELECT COUNT(*)::bigint AS count
        FROM "StockLot" lot
        JOIN "Product" product ON product.id = lot."productId"
        JOIN "Warehouse" warehouse ON warehouse.id = lot."warehouseId"
        WHERE lot."remainingQuantity" > 0
          AND (
            product."deletedAt" IS NOT NULL OR product."isActive" = false
            OR warehouse."deletedAt" IS NOT NULL OR warehouse."isActive" = false
          )
      `,
      db.$queryRaw<CountRow[]>`
        SELECT COUNT(*)::bigint AS count
        FROM "StockMovement"
        WHERE quantity <> 0
          AND (
            "exchangeRate" IS NULL OR "exchangeRate" <= 0
            OR "baseUnitCost" IS NULL OR "unitCost" IS NULL
          )
      `
    ], { isolationLevel: "RepeatableRead", timeout: 120_000 })
  ]);

  const schema = schemaRows[0];
  let operationRows: CountRow[] = [{ count: 0 }];
  let missingOperationRows: CountRow[] = [{ count: 0 }];
  let missingOccurredAtRows: CountRow[] = [{ count: 0 }];
  let attendanceCollisionRows: CountRow[] = [{ count: 0 }];
  let attendanceMismatchRows: CountRow[] = [{ count: 0 }];

  if (schema?.hasInventoryOperation && schema.hasMovementOperationId) {
    [operationRows, missingOperationRows] = await Promise.all([
      db.$queryRaw<CountRow[]>`
        SELECT COUNT(*)::bigint AS count
        FROM "InventoryOperation" operation
        WHERE NOT EXISTS (
          SELECT 1 FROM "StockMovement" movement WHERE movement."operationId" = operation.id
        ) OR (
          operation.status = 'CANCELLED'
          AND NOT EXISTS (
            SELECT 1 FROM "StockMovement" movement
            WHERE movement."operationId" = operation.id
              AND movement."referenceType" LIKE '%_CANCEL'
          )
        )
      `,
      db.$queryRaw<CountRow[]>`
        SELECT COUNT(*)::bigint AS count
        FROM "StockMovement"
        WHERE "operationId" IS NULL
      `
    ]);
  }

  if (schema?.hasMovementOccurredAt) {
    missingOccurredAtRows = await db.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::bigint AS count
      FROM "StockMovement"
      WHERE "occurredAt" IS NULL
    `;
  }

  if (schema?.hasAttendanceLocalDate) {
    [attendanceCollisionRows, attendanceMismatchRows] = await Promise.all([
      db.$queryRaw<CountRow[]>`
        SELECT COUNT(*)::bigint AS count
        FROM (
          SELECT
            "employeeId",
            TO_CHAR((date AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kabul', 'YYYY-MM-DD') AS day
          FROM "AttendanceRecord"
          GROUP BY "employeeId", day
          HAVING COUNT(*) > 1
        ) collisions
      `,
      db.$queryRaw<CountRow[]>`
        SELECT COUNT(*)::bigint AS count
        FROM "AttendanceRecord"
        WHERE "localDate" IS NOT NULL
          AND "localDate" <> TO_CHAR(
            (date AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kabul',
            'YYYY-MM-DD'
          )
      `
    ]);
  }

  const metrics: IntegrityMetrics = {
    unbalancedJournals: toNumber(unbalancedRows[0]?.count),
    salesMissingCogs: toNumber(missingCogsRows[0]?.count),
    negativeStockBalances: toNumber(negativeBalanceRows[0]?.count),
    negativeStockLots: toNumber(negativeLotRows[0]?.count),
    stockBalanceMismatches: toNumber(mismatchRows[0]?.count),
    salesMissingBaseSnapshot: toNumber(saleBaseRows[0]?.count),
    moneyTransactionsMissingBaseSnapshot: toNumber(moneyBaseRows[0]?.count),
    journalLinesMissingBaseSnapshot: toNumber(journalBaseRows[0]?.count),
    activeBaseCurrencies: toNumber(baseCurrencyRows[0]?.count),
    activeAfnBaseCurrencies: toNumber(afnBaseCurrencyRows[0]?.count),
    duplicateJournalSources: toNumber(duplicateJournalRows[0]?.count),
    duplicateNormalizedBarcodeGroups: toNumber(duplicateBarcodeRows[0]?.count),
    barcodesMissingNormalizedValue: toNumber(missingNormalizedRows[0]?.count),
    stockLotsAboveInitial: toNumber(stockAuditResults[0]?.[0]?.count),
    stockMovementLedgerMismatches: toNumber(stockAuditResults[1]?.[0]?.count),
    inactiveStockLocations: toNumber(stockAuditResults[2]?.[0]?.count),
    incompleteStockMovementSnapshots: toNumber(stockAuditResults[3]?.[0]?.count),
    stockMovementsMissingOperation: toNumber(missingOperationRows[0]?.count),
    stockMovementsMissingOccurredAt: toNumber(missingOccurredAtRows[0]?.count),
    partialInventoryOperations: toNumber(operationRows[0]?.count),
    attendanceLocalDateCollisions: toNumber(attendanceCollisionRows[0]?.count),
    attendanceLocalDateMismatches: toNumber(attendanceMismatchRows[0]?.count)
  };
  const samples = await loadIntegritySamples(db, schema);
  const evaluation = evaluateIntegrityMetrics(metrics, samples);
  const identity = identityRows[0];
  const migration = migrationRows[0];
  const snapshot = snapshotRows[0];

  if (!identity || !snapshot) {
    throw new Error("Integrity audit could not read database identity or business snapshot.");
  }

  return {
    formatVersion: 1,
    label: options.label?.trim() || "manual",
    generatedAt: new Date().toISOString(),
    database: {
      name: identity.databaseName,
      serverVersion: identity.serverVersion,
      latestMigration: migration?.migrationName ?? null,
      latestMigrationFinishedAt: migration?.finishedAt
        ? new Date(migration.finishedAt).toISOString()
        : null
    },
    metrics,
    ...evaluation,
    businessSnapshot: buildBusinessSnapshot(snapshot)
  };
}
