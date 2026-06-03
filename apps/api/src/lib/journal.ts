import type { Prisma } from "../generated/prisma/client";

type JournalTx = Prisma.TransactionClient;

type JournalLineInput = {
  accountCode: string;
  partyId?: string | null;
  debit?: number;
  credit?: number;
  exchangeRate?: number;
  baseCurrencyId?: string | null;
  note?: string | null;
};

type CreatePostedJournalInput = {
  entryNoPrefix: string;
  sourceType: string;
  sourceId: string;
  description: string;
  createdByUserId?: string | null;
  lines: JournalLineInput[];
};

function round4(value: number) {
  return Math.round(Number(value || 0) * 10000) / 10000;
}

function baseValue(value: number | undefined, exchangeRate: number | undefined) {
  return round4(Number(value || 0) * Number(exchangeRate || 1));
}

function validateBalancedLines(lines: JournalLineInput[]) {
  const totalDebit = round4(
    lines.reduce((sum, line) => sum + Number(line.debit || 0), 0)
  );
  const totalCredit = round4(
    lines.reduce((sum, line) => sum + Number(line.credit || 0), 0)
  );

  if (totalDebit <= 0 && totalCredit <= 0) {
    throw new Error("Debit/Credit amount is required");
  }

  if (totalDebit !== totalCredit) {
    throw new Error(
      `Journal entry is not balanced. Debit=${totalDebit}, Credit=${totalCredit}`
    );
  }

  for (const line of lines) {
    if (Number(line.debit || 0) > 0 && Number(line.credit || 0) > 0) {
      throw new Error("A journal line cannot have both debit and credit");
    }
  }
}

export function treasuryAccountCode(type: "CASH" | "BANK") {
  return type === "BANK" ? "1100" : "1000";
}

export async function createPostedJournal(
  tx: JournalTx,
  input: CreatePostedJournalInput
) {
  const existing = await tx.journalEntry.findFirst({
    where: {
      sourceType: input.sourceType,
      sourceId: input.sourceId
    },
    include: {
      lines: {
        include: {
          account: true,
          party: true
        }
      }
    }
  });

  if (existing) {
    return existing;
  }

  validateBalancedLines(input.lines);

  const codes = [...new Set(input.lines.map((line) => line.accountCode))];
  const accounts = await tx.accountingAccount.findMany({
    where: {
      code: {
        in: codes
      },
      isActive: true
    }
  });
  const accountByCode = new Map(accounts.map((account) => [account.code, account]));
  const missingCode = codes.find((code) => !accountByCode.has(code));

  if (missingCode) {
    throw new Error(`Accounting account ${missingCode} not found`);
  }

  return tx.journalEntry.create({
    data: {
      entryNo: `${input.entryNoPrefix}-${Date.now()}`,
      date: new Date(),
      description: input.description,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      createdByUserId: input.createdByUserId || null,
      lines: {
        create: input.lines.map((line) => ({
          accountId: accountByCode.get(line.accountCode)!.id,
          partyId: line.partyId || null,
          debit: round4(Number(line.debit || 0)),
          credit: round4(Number(line.credit || 0)),
          exchangeRate: Number(line.exchangeRate || 1),
          baseCurrencyId: line.baseCurrencyId || null,
          baseDebit: baseValue(line.debit, line.exchangeRate),
          baseCredit: baseValue(line.credit, line.exchangeRate),
          note: line.note || null
        }))
      }
    },
    include: {
      lines: {
        include: {
          account: true,
          party: true
        }
      }
    }
  });
}

export async function createReversalJournal(
  tx: JournalTx,
  input: {
    sourceType: string;
    sourceId: string;
    reversalSourceType: string;
    reversalSourceId: string;
    entryNoPrefix: string;
    description: string;
    createdByUserId?: string | null;
  }
) {
  const original = await tx.journalEntry.findFirst({
    where: {
      sourceType: input.sourceType,
      sourceId: input.sourceId
    },
    include: {
      lines: {
        include: {
          account: true
        }
      }
    }
  });

  if (!original) {
    return null;
  }

  return createPostedJournal(tx, {
    entryNoPrefix: input.entryNoPrefix,
    sourceType: input.reversalSourceType,
    sourceId: input.reversalSourceId,
    description: input.description,
    createdByUserId: input.createdByUserId,
    lines: original.lines.map((line) => ({
      accountCode: line.account.code,
      partyId: line.partyId,
      debit: Number(line.credit || 0),
      credit: Number(line.debit || 0),
      note: `Reversal of ${original.entryNo}`,
      exchangeRate: Number(line.exchangeRate || 1),
      baseCurrencyId: line.baseCurrencyId
    }))
  });
}
