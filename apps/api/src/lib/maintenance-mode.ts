import type { MiddlewareHandler } from "hono";

let reason: string | null = null;

export function setMaintenanceMode(nextReason: string | null) {
  reason = nextReason;
}

export function getMaintenanceMode() {
  return reason;
}

export const maintenanceModeMiddleware: MiddlewareHandler = async (c, next) => {
  if (
    reason &&
    !["GET", "HEAD", "OPTIONS"].includes(c.req.method) &&
    !new URL(c.req.url).pathname.startsWith("/api/backups/")
  ) {
    return c.json({ message: `Server is in maintenance mode: ${reason}` }, 503);
  }

  await next();
};
