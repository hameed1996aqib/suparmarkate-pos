import type { Prisma } from "../generated/prisma/client";

export async function acquireTransactionLock(
  tx: Prisma.TransactionClient,
  scope: string,
  id: string
) {
  const key = `${scope}:${id}`;
  await tx.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0)) IS NULL AS locked
  `;
}
