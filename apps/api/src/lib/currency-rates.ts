import type { Prisma } from "../generated/prisma/client";

type CurrencyRateTx = Pick<Prisma.TransactionClient, "currency" | "currencyRate">;

export type CurrencySnapshot = {
  exchangeRate: number;
  baseCurrencyId: string | null;
};

export function roundMoney(value: number) {
  return Math.round(Number(value || 0) * 10000) / 10000;
}

export function toBaseAmount(value: number, snapshot: CurrencySnapshot) {
  return roundMoney(Number(value || 0) * Number(snapshot.exchangeRate || 1));
}

export async function getBaseCurrency(tx: CurrencyRateTx) {
  return tx.currency.findFirst({
    where: {
      isBase: true,
      deletedAt: null
    },
    orderBy: {
      createdAt: "asc"
    }
  });
}

export async function resolveCurrencySnapshot(
  tx: CurrencyRateTx,
  currencyId: string
): Promise<CurrencySnapshot> {
  const [currency, baseCurrency] = await Promise.all([
    tx.currency.findUnique({ where: { id: currencyId } }),
    getBaseCurrency(tx)
  ]);

  if (!currency || currency.deletedAt || !currency.isActive) {
    throw new Error("Currency not found or inactive");
  }

  const baseCurrencyId = baseCurrency?.id ?? currency.id;

  if (currency.isBase || currency.id === baseCurrencyId) {
    return {
      exchangeRate: 1,
      baseCurrencyId
    };
  }

  const latestRate = await tx.currencyRate.findFirst({
    where: {
      currencyId,
      deletedAt: null,
      effectiveAt: { lte: new Date() }
    },
    orderBy: [
      { effectiveAt: "desc" },
      { createdAt: "desc" }
    ]
  });

  if (!latestRate) {
    throw new Error("برای این کرنسی نرخ فعال ثبت نشده است");
  }

  const exchangeRate = Number(latestRate.rateToBase);

  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
    throw new Error("نرخ فعال این کرنسی معتبر نیست");
  }

  return {
    exchangeRate,
    baseCurrencyId
  };
}

export function snapshotBaseFields(
  snapshot: CurrencySnapshot,
  values: {
    subtotal?: number;
    total?: number;
    paidAmount?: number;
    remainingAmount?: number;
    amount?: number;
    balanceAfter?: number | null;
  }
) {
  return {
    exchangeRate: snapshot.exchangeRate,
    baseCurrencyId: snapshot.baseCurrencyId,
    ...(values.subtotal === undefined
      ? {}
      : { baseSubtotal: toBaseAmount(values.subtotal, snapshot) }),
    ...(values.total === undefined
      ? {}
      : { baseTotal: toBaseAmount(values.total, snapshot) }),
    ...(values.paidAmount === undefined
      ? {}
      : { basePaidAmount: toBaseAmount(values.paidAmount, snapshot) }),
    ...(values.remainingAmount === undefined
      ? {}
      : { baseRemainingAmount: toBaseAmount(values.remainingAmount, snapshot) }),
    ...(values.amount === undefined
      ? {}
      : { baseAmount: toBaseAmount(values.amount, snapshot) }),
    ...(values.balanceAfter === undefined
      ? {}
      : {
          baseBalanceAfter:
            values.balanceAfter === null
              ? null
              : toBaseAmount(values.balanceAfter, snapshot)
        })
  };
}

export async function getCurrentCurrencyRates(tx: CurrencyRateTx) {
  const currencies = await tx.currency.findMany({
    where: {
      deletedAt: null
    },
    include: {
      rates: {
        where: {
          deletedAt: null,
          effectiveAt: { lte: new Date() }
        },
        orderBy: [
          { effectiveAt: "desc" },
          { createdAt: "desc" }
        ],
        take: 1
      }
    }
  });

  return new Map(
    currencies.map((currency) => [
      currency.id,
      currency.isBase ? 1 : Number(currency.rates[0]?.rateToBase || 1)
    ])
  );
}
