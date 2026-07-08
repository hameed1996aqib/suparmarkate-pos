ALTER TABLE "Product"
ADD COLUMN IF NOT EXISTS "barcodeNormalized" TEXT;

WITH normalized AS (
  SELECT
    id,
    NULLIF(
      replace(
        replace(
          replace(
            replace(
              regexp_replace(
                translate(
                  COALESCE(barcode, ''),
                  '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩',
                  '01234567890123456789'
                ),
                '[-[:space:]]+',
                '',
                'g'
              ),
              chr(8203),
              ''
            ),
            chr(8204),
            ''
          ),
          chr(8205),
          ''
        ),
        chr(8288),
        ''
      ),
      ''
    ) AS normalized
  FROM "Product"
  WHERE barcode IS NOT NULL
),
unique_normalized AS (
  SELECT normalized
  FROM normalized
  WHERE normalized IS NOT NULL
  GROUP BY normalized
  HAVING COUNT(*) = 1
)
UPDATE "Product" p
SET "barcodeNormalized" = n.normalized
FROM normalized n
JOIN unique_normalized u ON u.normalized = n.normalized
WHERE p.id = n.id;

CREATE UNIQUE INDEX IF NOT EXISTS "Product_barcodeNormalized_unique_idx"
ON "Product"("barcodeNormalized")
WHERE "barcodeNormalized" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "Product_barcodeNormalized_idx"
ON "Product"("barcodeNormalized");

CREATE INDEX IF NOT EXISTS "Product_isActive_deletedAt_barcodeNormalized_idx"
ON "Product"("isActive", "deletedAt", "barcodeNormalized");
