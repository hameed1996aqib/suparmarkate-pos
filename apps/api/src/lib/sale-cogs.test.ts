import { describe, expect, it, vi } from "vitest";

import { ensureSaleCogsJournal, isUniqueConstraintError } from "./sale-cogs";

function createTx(input?: {
  existing?: Record<string, unknown> | null;
  costs?: number[];
}) {
  const costs = input?.costs ?? [25, 15];
  const journalCreate = vi.fn(async (args: any) => ({
    id: "journal-new",
    ...args.data
  }));
  const journalLineCreate = vi.fn(async (args: any) => ({
    id: `line-${Math.random()}`,
    ...args.data
  }));

  const tx = {
    journalEntry: {
      findFirst: vi.fn(async () => input?.existing ?? null),
      create: journalCreate
    },
    journalLine: {
      create: journalLineCreate
    },
    party: {
      findMany: vi.fn(async () => [])
    },
    sale: {
      findUnique: vi.fn(async () => ({
        id: "sale-1",
        invoiceNo: "POS-1",
        items: costs.map((cost, index) => ({
          productId: `product-${index}`,
          warehouseId: "warehouse-1",
          lotId: `lot-${index}`,
          quantityBase: index + 1,
          baseTotalCost: cost,
          totalCost: cost
        }))
      }))
    },
    currency: {
      findFirst: vi.fn(async () => ({ id: "afn", isBase: true }))
    },
    accountingAccount: {
      findMany: vi.fn(async () => [
        { id: "account-cogs", code: "5000" },
        { id: "account-inventory", code: "1300" }
      ])
    }
  };

  return { tx: tx as any, journalCreate, journalLineCreate };
}

describe("sale COGS journal", () => {
  it("posts one balanced base-currency COGS journal", async () => {
    const { tx, journalCreate, journalLineCreate } = createTx({ costs: [25, 15] });

    const result = await ensureSaleCogsJournal(tx, {
      saleId: "sale-1",
      invoiceNo: "POS-1",
      createdByUserId: "user-1"
    });

    expect(result).toMatchObject({
      idempotentReplay: false,
      zeroCost: false,
      cogs: { total: 40 }
    });
    expect(journalCreate).toHaveBeenCalledTimes(1);

    const lines = journalLineCreate.mock.calls.map((call) => call[0].data);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      accountId: "account-cogs",
      debit: 40,
      credit: 0,
      baseDebit: 40,
      baseCredit: 0
    });
    expect(lines[1]).toMatchObject({
      accountId: "account-inventory",
      debit: 0,
      credit: 40,
      baseDebit: 0,
      baseCredit: 40
    });
  });

  it("replays an existing COGS journal without creating another one", async () => {
    const existing = {
      id: "journal-existing",
      sourceType: "POS_SALE_COGS",
      sourceId: "sale-1",
      lines: []
    };
    const { tx, journalCreate } = createTx({ existing, costs: [10] });

    const result = await ensureSaleCogsJournal(tx, { saleId: "sale-1" });

    expect(result.idempotentReplay).toBe(true);
    expect(result.journalEntry).toBe(existing);
    expect(journalCreate).not.toHaveBeenCalled();
  });

  it("records a zero-cost marker without inventing accounting amounts", async () => {
    const { tx, journalCreate } = createTx({ costs: [0] });

    const result = await ensureSaleCogsJournal(tx, { saleId: "sale-1" });

    expect(result).toMatchObject({
      idempotentReplay: false,
      zeroCost: true,
      cogs: { total: 0 }
    });
    expect(journalCreate).toHaveBeenCalledTimes(1);
    expect(journalCreate.mock.calls[0]?.[0].data.lines).toBeUndefined();
  });

  it("recognizes Prisma unique constraint conflicts", () => {
    expect(isUniqueConstraintError({ code: "P2002" })).toBe(true);
    expect(isUniqueConstraintError({ code: "P2025" })).toBe(false);
    expect(isUniqueConstraintError(null)).toBe(false);
  });
});
