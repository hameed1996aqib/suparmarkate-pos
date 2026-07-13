export type PartyBalanceKind = "CUSTOMER" | "SUPPLIER";

function toNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function accountCurrencyCode(account: any) {
  return (
    account?.currency?.code ||
    account?.currencyCode ||
    account?.currency?.symbol ||
    "AFN"
  );
}

function accountCurrencyRate(account: any) {
  if (account?.currency?.isBase) return 1;

  const rate = toNumber(
    account?.currency?.latestRate ??
      account?.latestRate ??
      account?.rateToBase ??
      1,
  );

  return rate > 0 ? rate : 1;
}

export function partyAccountExposure(account: any, kind: PartyBalanceKind) {
  const debit = toNumber(account?.debitBalance);
  const credit = toNumber(account?.creditBalance);
  const balance = kind === "CUSTOMER" ? debit - credit : credit - debit;

  return Math.max(0, balance);
}

export function partyBalanceBase(party: any, kind: PartyBalanceKind) {
  const accounts = Array.isArray(party?.accounts) ? party.accounts : [];

  return accounts.reduce(
    (sum: number, account: any) =>
      sum + partyAccountExposure(account, kind) * accountCurrencyRate(account),
    0,
  );
}

export function formatPartyBalanceByCurrency(
  party: any,
  kind: PartyBalanceKind,
  emptyValue = "-",
) {
  const accounts = Array.isArray(party?.accounts) ? party.accounts : [];
  const grouped = new Map<string, number>();

  for (const account of accounts) {
    const exposure = partyAccountExposure(account, kind);
    if (exposure <= 0) continue;

    const code = accountCurrencyCode(account);
    grouped.set(code, (grouped.get(code) || 0) + exposure);
  }

  if (grouped.size === 0) return emptyValue;

  return Array.from(grouped.entries())
    .map(
      ([code, amount]) =>
        `${new Intl.NumberFormat("en-US").format(amount)} ${code}`,
    )
    .join(" / ");
}
