const MONEY_SCALE = 10_000;

type NumericValue = number | string | { toString(): string } | null | undefined;

export type SaleItemPricingInput = {
  id: string;
  totalPrice: NumericValue;
  documentDiscountAllocated?: NumericValue;
  netTotalPrice?: NumericValue;
};

export type EffectiveSaleItemPricing = {
  documentDiscountAllocated: number;
  netTotalPrice: number;
  isLegacy: boolean;
};

function finiteNumber(value: NumericValue) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function toMoneyUnits(value: NumericValue) {
  return Math.round(finiteNumber(value) * MONEY_SCALE);
}

function fromMoneyUnits(value: number) {
  return value / MONEY_SCALE;
}

export function roundMoney4(value: NumericValue) {
  return fromMoneyUnits(toMoneyUnits(value));
}

export function allocateMoneyByWeight(
  amount: NumericValue,
  weights: NumericValue[],
) {
  const amountUnits = Math.max(0, toMoneyUnits(amount));
  const weightUnits = weights.map((weight) => Math.max(0, toMoneyUnits(weight)));
  const positiveIndexes = weightUnits
    .map((weight, index) => (weight > 0 ? index : -1))
    .filter((index) => index >= 0);
  const allocations = weights.map(() => 0);

  if (amountUnits === 0 || positiveIndexes.length === 0) {
    return allocations;
  }

  const totalWeight = weightUnits.reduce((sum, weight) => sum + weight, 0);
  let remaining = amountUnits;

  positiveIndexes.forEach((index, position) => {
    const isLast = position === positiveIndexes.length - 1;
    const units = isLast
      ? remaining
      : Math.floor((amountUnits * weightUnits[index]) / totalWeight);

    allocations[index] = fromMoneyUnits(units);
    remaining -= units;
  });

  return allocations;
}

export function resolveSaleItemPricing(
  saleDiscount: NumericValue,
  items: SaleItemPricingInput[],
) {
  const result = new Map<string, EffectiveSaleItemPricing>();
  const legacyItems: SaleItemPricingInput[] = [];
  let storedDiscountUnits = 0;

  for (const item of items) {
    const hasStoredNet = item.netTotalPrice !== null && item.netTotalPrice !== undefined;
    const hasStoredAllocation =
      item.documentDiscountAllocated !== null &&
      item.documentDiscountAllocated !== undefined;

    if (!hasStoredNet && !hasStoredAllocation) {
      legacyItems.push(item);
      continue;
    }

    const totalPrice = roundMoney4(item.totalPrice);
    const allocation = hasStoredAllocation
      ? roundMoney4(item.documentDiscountAllocated)
      : roundMoney4(totalPrice - finiteNumber(item.netTotalPrice));
    const netTotal = hasStoredNet
      ? roundMoney4(item.netTotalPrice)
      : roundMoney4(totalPrice - allocation);

    storedDiscountUnits += toMoneyUnits(allocation);
    result.set(item.id, {
      documentDiscountAllocated: allocation,
      netTotalPrice: netTotal,
      isLegacy: false,
    });
  }

  const remainingDiscount = fromMoneyUnits(
    Math.max(0, toMoneyUnits(saleDiscount) - storedDiscountUnits),
  );
  const legacyAllocations = allocateMoneyByWeight(
    remainingDiscount,
    legacyItems.map((item) => item.totalPrice),
  );

  legacyItems.forEach((item, index) => {
    const allocation = legacyAllocations[index] ?? 0;
    result.set(item.id, {
      documentDiscountAllocated: allocation,
      netTotalPrice: roundMoney4(finiteNumber(item.totalPrice) - allocation),
      isLegacy: true,
    });
  });

  return result;
}

export function decorateSaleItemsWithPricing<
  T extends SaleItemPricingInput,
>(saleDiscount: NumericValue, items: T[]) {
  const pricing = resolveSaleItemPricing(saleDiscount, items);

  return items.map((item) => {
    const effective = pricing.get(item.id) ?? {
      documentDiscountAllocated: 0,
      netTotalPrice: roundMoney4(item.totalPrice),
      isLegacy: true,
    };

    return {
      ...item,
      effectiveDocumentDiscountAllocated:
        effective.documentDiscountAllocated,
      effectiveNetTotalPrice: effective.netTotalPrice,
      pricingIsLegacy: effective.isLegacy,
    };
  });
}
