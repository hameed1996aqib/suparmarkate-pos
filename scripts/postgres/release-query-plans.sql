\set ON_ERROR_STOP on

-- Run only against a copied/sanitized customer database. The script is read-only.
BEGIN TRANSACTION READ ONLY;

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, name, barcode, "barcodeNormalized"
FROM "Product"
WHERE "deletedAt" IS NULL
  AND "barcodeNormalized" = '6263981802863'
LIMIT 2;

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, date, "sourceType", "sourceId"
FROM "JournalEntry"
WHERE date >= CURRENT_DATE - INTERVAL '30 days'
  AND date < CURRENT_DATE + INTERVAL '1 day'
ORDER BY date DESC
LIMIT 50;

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, "saleDate", "baseTotal", status
FROM "Sale"
WHERE "saleDate" >= CURRENT_DATE - INTERVAL '30 days'
  AND "saleDate" < CURRENT_DATE + INTERVAL '1 day'
ORDER BY "saleDate" DESC
LIMIT 50;

ROLLBACK;
