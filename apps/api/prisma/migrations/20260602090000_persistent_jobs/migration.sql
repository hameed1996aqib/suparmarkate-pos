CREATE TABLE "PersistentJob" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "payload" JSONB,
  "result" JSONB,
  "error" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "lockedBy" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PersistentJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PersistentJob_status_runAfter_idx" ON "PersistentJob"("status", "runAfter");
CREATE INDEX "PersistentJob_type_createdAt_idx" ON "PersistentJob"("type", "createdAt");
CREATE INDEX "PersistentJob_completedAt_idx" ON "PersistentJob"("completedAt");
