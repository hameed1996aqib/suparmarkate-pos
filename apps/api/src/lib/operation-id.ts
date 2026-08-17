import { randomUUID } from "node:crypto";

export function createOperationReference(prefix: string) {
  const time = Date.now().toString(36).toUpperCase();
  const random = randomUUID().replaceAll("-", "").toUpperCase();
  return `${prefix}-${time}-${random}`;
}
