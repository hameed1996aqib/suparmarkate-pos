import { describe, expect, it } from "vitest";
import type { AuthUser } from "./auth";
import {
  resolvePermissionRequirement,
  routePolicies,
  satisfiesPermissionRequirement,
} from "./permissions";

const apiPrefixes = [
  "/api/currencies",
  "/api/currency-rates",
  "/api/auth",
  "/api/users",
  "/api/employees",
  "/api/attendance",
  "/api/payroll",
  "/api/warehouses",
  "/api/units",
  "/api/product-categories",
  "/api/products",
  "/api/inventory",
  "/api/parties",
  "/api/cash-registers",
  "/api/bank-accounts",
  "/api/money-transfers",
  "/api/purchases",
  "/api/sales",
  "/api/purchase-returns",
  "/api/sale-returns",
  "/api/settings",
  "/api/receipts",
  "/api/payments",
  "/api/alerts",
  "/api/pos",
  "/api/accounting",
  "/api/pos-receipts",
  "/api/pos-cart",
  "/api/barcodes",
  "/api/dashboard",
  "/api/reports",
  "/api/financial-categories",
  "/api/income-expenses",
  "/api/backups",
  "/api/attachments",
  "/api/exports",
  "/api/system-health",
];

function user(permissions: string[], role = "Cashier"): AuthUser {
  return {
    id: "user-1",
    username: "cashier",
    displayName: "Cashier",
    role,
    permissions,
    mustChangePassword: false,
    employee: null,
  };
}

describe("route permission policies", () => {
  it("covers every mounted API prefix for reads and writes", () => {
    expect(routePolicies.length).toBeGreaterThan(apiPrefixes.length);
    for (const prefix of apiPrefixes) {
      expect(resolvePermissionRequirement(prefix, "GET"), `${prefix} GET`).not.toBeNull();
      expect(resolvePermissionRequirement(prefix, "POST"), `${prefix} POST`).not.toBeNull();
    }
  });

  it("denies unmapped routes by returning no requirement", () => {
    expect(resolvePermissionRequirement("/api/not-registered", "GET")).toBeNull();
  });

  it("allows POS users to read product lookup data but not mutate products", () => {
    const posUser = user(["pos.sell"]);
    const read = resolvePermissionRequirement("/api/products/barcode-lookup", "GET");
    const write = resolvePermissionRequirement("/api/products", "POST");
    expect(read && satisfiesPermissionRequirement(posUser, read)).toBe(true);
    expect(write && satisfiesPermissionRequirement(posUser, write)).toBe(false);
  });

  it("keeps employee self-service and authenticated attendance scanning login-only", () => {
    const loggedInUser = user([]);
    for (const [path, method] of [
      ["/api/employees/me", "GET"],
      ["/api/attendance/scan-auth", "POST"],
    ] as const) {
      const requirement = resolvePermissionRequirement(path, method);
      expect(requirement && satisfiesPermissionRequirement(loggedInUser, requirement)).toBe(true);
    }
  });

  it("keeps the legacy COGS endpoint available to POS without accounting permission", () => {
    const requirement = resolvePermissionRequirement("/api/accounting/post-sale-cogs", "POST");
    expect(requirement && satisfiesPermissionRequirement(user(["pos.sell"]), requirement)).toBe(true);
  });

  it("allows inventory staff to read alerts without dashboard permission", () => {
    const requirement = resolvePermissionRequirement("/api/alerts", "GET");
    expect(
      requirement && satisfiesPermissionRequirement(user(["inventory.view"]), requirement),
    ).toBe(true);
    expect(
      requirement && satisfiesPermissionRequirement(user(["dashboard.view"]), requirement),
    ).toBe(false);
  });

  it("restricts mobile device administration to users.manage", () => {
    const listRequirement = resolvePermissionRequirement("/api/users/devices", "GET");
    const revokeRequirement = resolvePermissionRequirement(
      "/api/users/devices/device-1/revoke",
      "POST",
    );
    expect(
      listRequirement &&
        satisfiesPermissionRequirement(user(["users.manage"]), listRequirement),
    ).toBe(true);
    expect(
      revokeRequirement &&
        satisfiesPermissionRequirement(user(["users.manage"]), revokeRequirement),
    ).toBe(true);
    expect(
      revokeRequirement && satisfiesPermissionRequirement(user(["attendance.manage"]), revokeRequirement),
    ).toBe(false);
  });

  it("lets Admin satisfy permission policies without enumerating every permission", () => {
    const requirement = resolvePermissionRequirement("/api/backups", "POST");
    expect(requirement && satisfiesPermissionRequirement(user([], "Admin"), requirement)).toBe(true);
  });
});
