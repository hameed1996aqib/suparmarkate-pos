import type { Prisma } from "../generated/prisma/client";
import { createOperationReference } from "./operation-id";

import { getBaseCurrency, roundMoney } from "./currency-rates";
import { createPostedJournal } from "./journal";

type SaleCogsTx = Prisma.TransactionClient;

export type SaleCogsDetail = {
  productId: string;
  warehouseId: string;
  lotId: string | null;
  quantity: number;
  avgCost: number;
  lineCost: number;
};

export type SaleCogsResult = {
  journalEntry: Awaited<ReturnType<typeof createPostedJournal>>;
  cogs: {
    total: number;
    details: SaleCogsDetail[];
  };
  idempotentReplay: boolean;
  zeroCost: boolean;
};

const journalInclude = {
  lines: {
    include: {
      account: true,
      party: true
    }
  }
} as const;

function calculateSaleCogs(
  items: Array<{
    productId: string;
    warehouseId: string;
    lotId: string | null;
    quantityBase: unknown;
    baseTotalCost: unknown;
    totalCost: unknown;
  }>
) {
  const details = items.map((item) => {
    const quantity = Number(item.quantityBase || 0);
    const lineCost = roundMoney(
      Number(item.baseTotalCost ?? item.totalCost ?? 0)
    );

    return {
      productId: item.productId,
      warehouseId: item.warehouseId,
      lotId: item.lotId,
      quantity,
      avgCost: quantity > 0 ? roundMoney(lineCost / quantity) : 0,
      lineCost
    };
  });

  return {
    total: roundMoney(details.reduce((sum, item) => sum + item.lineCost, 0)),
    details
  };
}

async function createZeroCostMarker(
  tx: SaleCogsTx,
  input: {
    saleId: string;
    invoiceNo: string | null;
    createdByUserId?: string | null;
  }
) {
  return tx.journalEntry.create({
    data: {
      entryNo: createOperationReference("JE-COGS-ZERO"),
      date: new Date(),
      description: `COGS checked with zero cost for POS Sale ${input.invoiceNo || input.saleId}`,
      sourceType: "POS_SALE_COGS",
      sourceId: input.saleId,
      createdByUserId: input.createdByUserId || null
    },
    include: journalInclude
  });
}

export async function ensureSaleCogsJournal(
  tx: SaleCogsTx,
  input: {
    saleId: string;
    invoiceNo?: string | null;
    createdByUserId?: string | null;
  }
): Promise<SaleCogsResult> {
  const existing = await tx.journalEntry.findFirst({
    where: {
      sourceType: "POS_SALE_COGS",
      sourceId: input.saleId
    },
    include: journalInclude
  });

  const sale = await tx.sale.findUnique({
    where: { id: input.saleId },
    select: {
      id: true,
      invoiceNo: true,
      items: {
        select: {
          productId: true,
          warehouseId: true,
          lotId: true,
          quantityBase: true,
          baseTotalCost: true,
          totalCost: true
        }
      }
    }
  });

  if (!sale) {
    throw new Error("Sale not found");
  }

  const cogs = calculateSaleCogs(sale.items);

  if (existing) {
    return {
      journalEntry: existing,
      cogs,
      idempotentReplay: true,
      zeroCost: cogs.total <= 0
    };
  }

  if (cogs.total <= 0) {
    const journalEntry = await createZeroCostMarker(tx, {
      saleId: sale.id,
      invoiceNo: input.invoiceNo ?? sale.invoiceNo,
      createdByUserId: input.createdByUserId
    });

    return {
      journalEntry,
      cogs,
      idempotentReplay: false,
      zeroCost: true
    };
  }

  const baseCurrencyId = (await getBaseCurrency(tx))?.id || null;
  const journalEntry = await createPostedJournal(tx, {
    entryNoPrefix: "JE-COGS",
    sourceType: "POS_SALE_COGS",
    sourceId: sale.id,
    description: `COGS for POS Sale ${input.invoiceNo ?? sale.invoiceNo ?? sale.id}`,
    createdByUserId: input.createdByUserId,
    lines: [
      {
        accountCode: "5000",
        debit: cogs.total,
        exchangeRate: 1,
        baseCurrencyId,
        note: "Cost of goods sold for POS sale"
      },
      {
        accountCode: "1300",
        credit: cogs.total,
        exchangeRate: 1,
        baseCurrencyId,
        note: "Inventory reduced by POS sale cost"
      }
    ]
  });

  return {
    journalEntry,
    cogs,
    idempotentReplay: false,
    zeroCost: false
  };
}

export function isUniqueConstraintError(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2002"
  );
}
