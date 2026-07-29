import { describe, expect, it } from "vitest";
import type { IntegrityAuditReport } from "./integrity-audit";
import { compareIntegrityReports } from "./integrity-compare";

function report(
  fingerprint: string,
  overrides: Partial<IntegrityAuditReport["metrics"]> = {}
): IntegrityAuditReport {
  return {
    formatVersion: 1,
    label: "test",
    generatedAt: new Date(0).toISOString(),
    database: {
      name: "muhaseb_test",
      serverVersion: "16",
      latestMigration: "migration",
      latestMigrationFinishedAt: new Date(0).toISOString()
    },
    metrics: {
      unbalancedJournals: 0,
      salesMissingCogs: 3,
      negativeStockBalances: 0,
      negativeStockLots: 0,
      stockBalanceMismatches: 0,
      salesMissingBaseSnapshot: 0,
      moneyTransactionsMissingBaseSnapshot: 0,
      journalLinesMissingBaseSnapshot: 0,
      activeBaseCurrencies: 1,
      activeAfnBaseCurrencies: 1,
      duplicateJournalSources: 0,
      duplicateNormalizedBarcodeGroups: 2,
      barcodesMissingNormalizedValue: 4,
      ...overrides
    },
    issues: [],
    summary: {
      status: "pass",
      blockers: 0,
      warnings: 3
    },
    businessSnapshot: {
      counts: {
        products: 10,
        stockLots: 10,
        stockMovements: 10,
        sales: 10,
        saleReturns: 0,
        purchases: 10,
        purchaseReturns: 0,
        journalEntries: 20
      },
      totals: {
        stockQuantityBase: "10",
        stockValueBase: "100",
        journalBaseDebit: "100",
        journalBaseCredit: "100",
        completedSaleBaseTotal: "100",
        completedPurchaseBaseTotal: "100"
      },
      fingerprint
    }
  };
}

describe("compareIntegrityReports", () => {
  it("accepts an unchanged business snapshot", () => {
    expect(compareIntegrityReports(report("same"), report("same")).passed).toBe(
      true
    );
  });

  it("rejects business data changes during maintenance", () => {
    const comparison = compareIntegrityReports(
      report("before"),
      report("after")
    );

    expect(comparison.passed).toBe(false);
    expect(comparison.errors).toContain(
      "Business data fingerprint changed during the release window."
    );
  });

  it("rejects new legacy integrity gaps", () => {
    const comparison = compareIntegrityReports(
      report("same"),
      report("same", { salesMissingCogs: 4 })
    );

    expect(comparison.passed).toBe(false);
    expect(comparison.errors).toContain(
      "salesMissingCogs increased from 3 to 4."
    );
  });
});
