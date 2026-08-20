import { describe, expect, it } from "vitest";
import {
  evaluateIntegrityMetrics,
  type IntegrityMetrics
} from "./integrity-audit";

function healthyMetrics(overrides: Partial<IntegrityMetrics> = {}): IntegrityMetrics {
  return {
    unbalancedJournals: 0,
    salesMissingCogs: 0,
    negativeStockBalances: 0,
    negativeStockLots: 0,
    stockBalanceMismatches: 0,
    salesMissingBaseSnapshot: 0,
    moneyTransactionsMissingBaseSnapshot: 0,
    journalLinesMissingBaseSnapshot: 0,
    activeBaseCurrencies: 1,
    activeAfnBaseCurrencies: 1,
    duplicateJournalSources: 0,
    duplicateNormalizedBarcodeGroups: 0,
    barcodesMissingNormalizedValue: 0,
    stockLotsAboveInitial: 0,
    stockMovementLedgerMismatches: 0,
    inactiveStockLocations: 0,
    incompleteStockMovementSnapshots: 0,
    stockMovementsMissingOperation: 0,
    stockMovementsMissingOccurredAt: 0,
    partialInventoryOperations: 0,
    attendanceLocalDateCollisions: 0,
    attendanceLocalDateMismatches: 0,
    ...overrides
  };
}

describe("evaluateIntegrityMetrics", () => {
  it("passes a healthy database", () => {
    const result = evaluateIntegrityMetrics(healthyMetrics());

    expect(result.summary).toEqual({
      status: "pass",
      blockers: 0,
      warnings: 0
    });
  });

  it("blocks an invalid accounting or stock state", () => {
    const result = evaluateIntegrityMetrics(
      healthyMetrics({
        unbalancedJournals: 2,
        stockBalanceMismatches: 1,
        stockMovementLedgerMismatches: 1
      })
    );

    expect(result.summary.status).toBe("blocked");
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "UNBALANCED_JOURNALS",
        "STOCK_BALANCE_MISMATCHES",
        "STOCK_MOVEMENT_LEDGER_MISMATCHES"
      ])
    );
  });

  it("reports legacy COGS and barcode gaps as warnings", () => {
    const result = evaluateIntegrityMetrics(
      healthyMetrics({
        salesMissingCogs: 3,
        duplicateNormalizedBarcodeGroups: 4
      })
    );

    expect(result.summary).toEqual({
      status: "pass",
      blockers: 0,
      warnings: 2
    });
  });

  it("requires exactly one active AFN base currency", () => {
    const result = evaluateIntegrityMetrics(
      healthyMetrics({
        activeBaseCurrencies: 2,
        activeAfnBaseCurrencies: 0
      })
    );

    expect(result.summary.status).toBe("blocked");
    expect(result.summary.blockers).toBe(2);
  });
});
