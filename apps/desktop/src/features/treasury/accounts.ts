export type PaymentAccountOption = {
  id: string;
  name: string;
  type: "CASH" | "BANK";
  currencyId: string;
  balance?: number;
};

export function accountKey(account: Pick<PaymentAccountOption, "type" | "id">) {
  return `${account.type}:${account.id}`;
}

export function parseAccountKey(value: string) {
  const [type, id] = value.split(":");

  if ((type === "CASH" || type === "BANK") && id) {
    return { type, id } as const;
  }

  return null;
}

export function buildPaymentAccounts(cashData: any, bankData: any) {
  const cashAccounts: PaymentAccountOption[] = Array.isArray(cashData)
    ? cashData.flatMap((register: any) =>
        Array.isArray(register.accounts)
          ? register.accounts.map((account: any) => ({
              id: account.id,
              type: "CASH" as const,
              currencyId: account.currencyId,
              balance: Number(account.balance || 0),
              name: `${register.name} / ${account.currency?.code || ""}`,
            }))
          : [],
      )
    : [];
  const bankAccounts: PaymentAccountOption[] = Array.isArray(bankData)
    ? bankData.map((account: any) => ({
        id: account.id,
        type: "BANK" as const,
        currencyId: account.currencyId,
        balance: Number(account.balance || 0),
        name: `${account.name} / ${account.currency?.code || ""}`,
      }))
    : [];

  return [...cashAccounts, ...bankAccounts];
}
