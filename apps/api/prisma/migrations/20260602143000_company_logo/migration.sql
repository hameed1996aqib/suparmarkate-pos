ALTER TABLE "CompanySetting"
ADD COLUMN "logoImage" TEXT;

UPDATE "Currency"
SET "isBase" = CASE WHEN "code" = 'AFN' THEN TRUE ELSE FALSE END;

ALTER TABLE "Currency"
ADD CONSTRAINT "Currency_base_afn_only"
CHECK (NOT "isBase" OR "code" = 'AFN');
