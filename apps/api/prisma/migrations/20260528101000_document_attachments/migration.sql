CREATE TABLE "DocumentAttachment" (
  "id" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "url" TEXT NOT NULL,
  "note" TEXT,
  "createdByUserId" TEXT,
  "deletedByUserId" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DocumentAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DocumentAttachment_entityType_entityId_idx" ON "DocumentAttachment"("entityType", "entityId");
CREATE INDEX "DocumentAttachment_createdByUserId_idx" ON "DocumentAttachment"("createdByUserId");
CREATE INDEX "DocumentAttachment_deletedAt_idx" ON "DocumentAttachment"("deletedAt");
CREATE INDEX "DocumentAttachment_createdAt_idx" ON "DocumentAttachment"("createdAt");

ALTER TABLE "DocumentAttachment"
  ADD CONSTRAINT "DocumentAttachment_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
