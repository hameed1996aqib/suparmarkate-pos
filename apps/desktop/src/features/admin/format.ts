export const money = (value: number | string, currencyCode = "AFN") =>
  `${new Intl.NumberFormat("en-US").format(Number(value || 0))} ${currencyCode}`;
