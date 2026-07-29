const MONEY_SCALE = 10_000;

function units(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * MONEY_SCALE);
}

export function roundMoney4(value: number) {
  return units(value) / MONEY_SCALE;
}

export function allocateMoneyByWeight(amount: number, weights: number[]) {
  const amountUnits = Math.max(0, units(amount));
  const weightUnits = weights.map((weight) => Math.max(0, units(weight)));
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
    const allocatedUnits =
      position === positiveIndexes.length - 1
        ? remaining
        : Math.floor((amountUnits * weightUnits[index]) / totalWeight);

    allocations[index] = allocatedUnits / MONEY_SCALE;
    remaining -= allocatedUnits;
  });

  return allocations;
}
