import { describe, expect, it } from "vitest";

import {
  allocateMoneyByWeight,
  resolveSaleItemPricing,
  roundMoney4,
} from "./sale-pricing";

describe("sale pricing", () => {
  it("allocates four-decimal rounding remainder to the last weighted line", () => {
    const allocations = allocateMoneyByWeight(1, [1, 1, 1]);

    expect(allocations).toEqual([0.3333, 0.3333, 0.3334]);
    expect(roundMoney4(allocations.reduce((sum, value) => sum + value, 0))).toBe(1);
  });

  it("preserves an exact weighted allocation across lot splits", () => {
    const allocations = allocateMoneyByWeight(12.3456, [4, 2, 7]);

    expect(roundMoney4(allocations.reduce((sum, value) => sum + value, 0))).toBe(12.3456);
    expect(allocations.every((value) => Number(value.toFixed(4)) === value)).toBe(true);
  });

  it("resolves legacy item net totals without changing stored values", () => {
    const pricing = resolveSaleItemPricing(10, [
      { id: "line-1", totalPrice: 70 },
      { id: "line-2", totalPrice: 30 },
    ]);

    expect(pricing.get("line-1")).toEqual({
      documentDiscountAllocated: 7,
      netTotalPrice: 63,
      isLegacy: true,
    });
    expect(pricing.get("line-2")).toEqual({
      documentDiscountAllocated: 3,
      netTotalPrice: 27,
      isLegacy: true,
    });
  });

  it("uses stored snapshots and only allocates the residual discount to legacy rows", () => {
    const pricing = resolveSaleItemPricing(10, [
      {
        id: "new-line",
        totalPrice: 60,
        documentDiscountAllocated: 6,
        netTotalPrice: 54,
      },
      { id: "legacy-line", totalPrice: 40 },
    ]);

    expect(pricing.get("new-line")?.netTotalPrice).toBe(54);
    expect(pricing.get("legacy-line")).toEqual({
      documentDiscountAllocated: 4,
      netTotalPrice: 36,
      isLegacy: true,
    });
  });

  it("does not allocate a discount when all weights are zero", () => {
    expect(allocateMoneyByWeight(5, [0, 0])).toEqual([0, 0]);
  });
});
