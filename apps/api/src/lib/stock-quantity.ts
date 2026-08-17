import { Prisma } from "../generated/prisma/client";

export const STOCK_QUANTITY_SCALE = 4;
export const STOCK_QUANTITY_FACTOR = 10 ** STOCK_QUANTITY_SCALE;

export function roundStockQuantity(value: number) {
  if (!Number.isFinite(value)) {
    throw new Error("مقدار موجودی معتبر نیست.");
  }

  const rounded = Math.round((value + Number.EPSILON) * STOCK_QUANTITY_FACTOR) /
    STOCK_QUANTITY_FACTOR;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function stockDecimal(value: number) {
  return new Prisma.Decimal(roundStockQuantity(value).toFixed(STOCK_QUANTITY_SCALE));
}
