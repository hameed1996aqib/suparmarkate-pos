UPDATE "Product"
SET "barcode" = 'PRD-' || upper("id")
WHERE "barcode" IS NULL OR trim("barcode") = '';
