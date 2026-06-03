import { prisma } from "./prisma";

type AuditRow = {
  createdByUserId?: string | null;
  updatedByUserId?: string | null;
  deletedByUserId?: string | null;
};

type AuditUser = {
  id: string;
  username: string;
  displayName: string;
};

export function auditCreateData(userId?: string | null) {
  return userId ? { createdByUserId: userId } : {};
}

export function auditUpdateData(userId?: string | null) {
  return userId ? { updatedByUserId: userId } : {};
}

export function auditDeleteData(userId?: string | null) {
  return {
    isActive: false,
    deletedAt: new Date(),
    ...(userId ? { deletedByUserId: userId, updatedByUserId: userId } : {})
  };
}

export async function attachAuditUsers<T extends AuditRow>(rows: T[]): Promise<Array<T & {
  createdByUser?: AuditUser | null;
  updatedByUser?: AuditUser | null;
  deletedByUser?: AuditUser | null;
}>>;
export async function attachAuditUsers<T extends AuditRow>(rows: T): Promise<T & {
  createdByUser?: AuditUser | null;
  updatedByUser?: AuditUser | null;
  deletedByUser?: AuditUser | null;
}>;
export async function attachAuditUsers<T extends AuditRow>(rows: T | T[]) {
  const list = Array.isArray(rows) ? rows : [rows];
  const userIds = Array.from(
    new Set(
      list
        .flatMap((row) => [row.createdByUserId, row.updatedByUserId, row.deletedByUserId])
        .filter(Boolean) as string[]
    )
  );

  if (userIds.length === 0) {
    return rows;
  }

  const users = await prisma.user.findMany({
    where: {
      id: {
        in: userIds
      }
    },
    select: {
      id: true,
      username: true,
      displayName: true
    }
  });
  const userMap = new Map<string, AuditUser>(users.map((user) => [user.id, user]));

  const enriched = list.map((row) => ({
    ...row,
    createdByUser: row.createdByUserId ? userMap.get(row.createdByUserId) ?? null : null,
    updatedByUser: row.updatedByUserId ? userMap.get(row.updatedByUserId) ?? null : null,
    deletedByUser: row.deletedByUserId ? userMap.get(row.deletedByUserId) ?? null : null
  }));

  return Array.isArray(rows) ? enriched : enriched[0];
}
