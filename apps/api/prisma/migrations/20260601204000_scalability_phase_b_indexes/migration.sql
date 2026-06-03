CREATE INDEX "DocumentAttachment_entityType_entityId_deletedAt_createdAt_idx"
ON "DocumentAttachment"("entityType", "entityId", "deletedAt", "createdAt");

CREATE INDEX "PartyTransaction_partyId_createdAt_idx"
ON "PartyTransaction"("partyId", "createdAt");

CREATE INDEX "MoneyTransaction_cashRegisterAccountId_createdAt_idx"
ON "MoneyTransaction"("cashRegisterAccountId", "createdAt");

CREATE INDEX "MoneyTransaction_bankAccountId_createdAt_idx"
ON "MoneyTransaction"("bankAccountId", "createdAt");
