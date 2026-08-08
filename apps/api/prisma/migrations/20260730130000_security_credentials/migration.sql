ALTER TABLE "User"
ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "PosDevice"
ADD COLUMN "credentialHash" TEXT,
ADD COLUMN "credentialIssuedAt" TIMESTAMP(3),
ADD COLUMN "credentialRevokedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "PosDevice_credentialHash_key" ON "PosDevice"("credentialHash");
