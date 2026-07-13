import type { Context, Next } from "hono";
import { getAuthUser, hasPermission } from "./auth";

type RouteRule = {
  prefix: string;
  read?: string;
  write?: string;
};

const routeRules: RouteRule[] = [
  { prefix: "/api/dashboard", read: "dashboard.view" },
  { prefix: "/api/alerts", read: "alerts.view" },
  { prefix: "/api/pos", read: "pos.sell", write: "pos.sell" },
  { prefix: "/api/pos-cart", read: "pos.sell", write: "pos.sell" },
  { prefix: "/api/barcodes", read: "pos.sell", write: "products.manage" },
  { prefix: "/api/sales", read: "sales.view", write: "sales.manage" },
  { prefix: "/api/sale-returns", read: "sales.view", write: "sales.manage" },
  { prefix: "/api/purchases", read: "purchases.view", write: "purchases.manage" },
  { prefix: "/api/purchase-returns", read: "purchases.view", write: "purchases.manage" },
  { prefix: "/api/inventory", read: "inventory.view", write: "inventory.manage" },
  { prefix: "/api/products", write: "products.manage" },
  { prefix: "/api/warehouses", write: "inventory.manage" },
  { prefix: "/api/units", write: "products.manage" },
  { prefix: "/api/product-categories", write: "products.manage" },
  { prefix: "/api/parties", write: "parties.manage" },
  { prefix: "/api/cash-registers", write: "cashbank.manage" },
  { prefix: "/api/bank-accounts", write: "cashbank.manage" },
  { prefix: "/api/money-transfers", read: "cashbank.manage", write: "cashbank.manage" },
  { prefix: "/api/payments", read: "cashbank.manage", write: "cashbank.manage" },
  { prefix: "/api/income-expenses", read: "cashbank.manage", write: "cashbank.manage" },
  { prefix: "/api/financial-categories", write: "cashbank.manage" },
  { prefix: "/api/accounting", read: "accounting.view", write: "accounting.manage" },
  { prefix: "/api/reports", read: "reports.view" },
  { prefix: "/api/exports", read: "reports.view" },
  { prefix: "/api/system-health", read: "backup.manage" },
  { prefix: "/api/settings", write: "settings.manage" },
  { prefix: "/api/currencies", write: "settings.manage" },
  { prefix: "/api/currency-rates", write: "settings.manage" },
  { prefix: "/api/attachments", write: "settings.manage" }
];

function matchesPrefix(path: string, prefix: string) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function requiredPermission(path: string, method: string) {
  const rule = routeRules.find((item) => matchesPrefix(path, item.prefix));
  if (!rule) return null;

  return method === "GET" || method === "HEAD" ? rule.read ?? null : rule.write ?? null;
}

export async function permissionMiddleware(c: Context, next: Next) {
  const user = getAuthUser(c);

  // Public endpoints have already been selected by authMiddleware.
  if (!user) {
    await next();
    return;
  }

  const permission = requiredPermission(new URL(c.req.url).pathname, c.req.method);

  if (permission && !hasPermission(user, permission)) {
    return c.json({ message: `Permission required: ${permission}` }, 403);
  }

  await next();
}
