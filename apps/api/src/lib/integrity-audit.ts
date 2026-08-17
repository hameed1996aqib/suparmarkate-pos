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

export function evaluateIntegrityMetrics(metrics: IntegrityMetrics) {
  const issues: IntegrityIssue[] = [];

  for (const definition of blockerDefinitions) {
    const value = metrics[definition.key];
    const invalid = isExpectedSingleBaseMetric(definition.key) ? value !== 1 : value > 0;
    if (!invalid) continue;

    issues.push({
      code: definition.code,
      severity: "blocker",
      count: value,
      description: definition.description
    });
  }

  for (const definition of warningDefinitions) {
    const value = metrics[definition.key];
    if (value <= 0) continue;

    issues.push({
      code: definition.code,
      severity: "warning",
      count: value,
      description: definition.description
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
    barcodesMissingNormalizedValue: toNumber(missingNormalizedRows[0]?.count)
  };
  const evaluation = evaluateIntegrityMetrics(metrics);
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
