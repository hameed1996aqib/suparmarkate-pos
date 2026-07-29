import type { IntegrityAuditReport } from "./integrity-audit";

export type IntegrityComparison = {
  passed: boolean;
  errors: string[];
  warnings: string[];
};

const warningMetricKeys = [
  "salesMissingCogs",
  "salesMissingBaseSnapshot",
  "moneyTransactionsMissingBaseSnapshot",
  "journalLinesMissingBaseSnapshot",
  "duplicateNormalizedBarcodeGroups",
  "barcodesMissingNormalizedValue"
] as const;

export function compareIntegrityReports(
  before: IntegrityAuditReport,
  after: IntegrityAuditReport
): IntegrityComparison {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (after.summary.status === "blocked") {
    errors.push("Postflight integrity audit contains blocking issues.");
  }

  if (before.database.name !== after.database.name) {
    errors.push(
      `Database changed from ${before.database.name} to ${after.database.name}.`
    );
  }

  if (before.businessSnapshot.fingerprint !== after.businessSnapshot.fingerprint) {
    errors.push("Business data fingerprint changed during the release window.");
  }

  for (const key of warningMetricKeys) {
    const previous = before.metrics[key];
    const current = after.metrics[key];

    if (current > previous) {
      errors.push(`${key} increased from ${previous} to ${current}.`);
    } else if (current < previous) {
      warnings.push(`${key} improved from ${previous} to ${current}.`);
    }
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings
  };
}
