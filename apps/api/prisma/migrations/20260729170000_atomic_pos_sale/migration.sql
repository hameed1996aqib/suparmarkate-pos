ALTER TABLE "Sale"
ADD COLUMN "clientRequestId" TEXT;

CREATE UNIQUE INDEX "Sale_clientRequestId_key"
ON "Sale"("clientRequestId");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "JournalEntry"
    WHERE "sourceType" IS NOT NULL
      AND "sourceId" IS NOT NULL
    GROUP BY "sourceType", "sourceId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot add journal source uniqueness: duplicate sourceType/sourceId rows exist. Run the Muhaseb preflight audit first.';
  END IF;
END $$;

DROP INDEX IF EXISTS "JournalEntry_sourceType_sourceId_idx";

CREATE UNIQUE INDEX "JournalEntry_sourceType_sourceId_key"
ON "JournalEntry"("sourceType", "sourceId");
