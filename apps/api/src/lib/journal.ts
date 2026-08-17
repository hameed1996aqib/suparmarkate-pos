import type { Prisma } from "../generated/prisma/client";
import { createOperationReference } from "./operation-id";

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

async function loadJournalWithRelations(
  tx: JournalTx,
  entry: Awaited<ReturnType<JournalTx["journalEntry"]["findFirst"]>>
) {
  if (!entry) return null;

  const lines = await tx.journalLine.findMany({
    where: { journalEntryId: entry.id },
    orderBy: { createdAt: "asc" }
  });
  const accountIds = [...new Set(lines.map((line) => line.accountId))];
  const partyIds = [
    ...new Set(lines.map((line) => line.partyId).filter((id): id is string => Boolean(id)))
  ];
  const accounts = accountIds.length
    ? await tx.accountingAccount.findMany({ where: { id: { in: accountIds } } })
    : [];
  const parties = partyIds.length
    ? await tx.party.findMany({ where: { id: { in: partyIds } } })
    : [];
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const partyById = new Map(parties.map((party) => [party.id, party]));

  return {
    ...entry,
    lines: lines.map((line) => ({
      ...line,
      account: accountById.get(line.accountId)!,
      party: line.partyId ? partyById.get(line.partyId) || null : null
    }))
  };
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
    }
  });

  if (existing) {
    return (await loadJournalWithRelations(tx, existing))!;
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

  const partyIds = [
    ...new Set(input.lines.map((line) => line.partyId).filter((id): id is string => Boolean(id)))
  ];
  const parties = partyIds.length
    ? await tx.party.findMany({ where: { id: { in: partyIds } } })
    : [];
  const partyById = new Map(parties.map((party) => [party.id, party]));

  const entry = await tx.journalEntry.create({
    data: {
      entryNo: createOperationReference(input.entryNoPrefix),
      date: new Date(),
      description: input.description,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      createdByUserId: input.createdByUserId || null
    }
  });
  const createdLines = [];

  for (const line of input.lines) {
    const account = accountByCode.get(line.accountCode)!;
    const createdLine = await tx.journalLine.create({
      data: {
        journalEntryId: entry.id,
        accountId: account.id,
        partyId: line.partyId || null,
        debit: round4(Number(line.debit || 0)),
        credit: round4(Number(line.credit || 0)),
        exchangeRate: Number(line.exchangeRate || 1),
        baseCurrencyId: line.baseCurrencyId || null,
        baseDebit: baseValue(line.debit, line.exchangeRate),
        baseCredit: baseValue(line.credit, line.exchangeRate),
        note: line.note || null
      }
    });
    createdLines.push({
      ...createdLine,
      account,
      party: line.partyId ? partyById.get(line.partyId) || null : null
    });
  }

  return {
    ...entry,
    lines: createdLines
  };
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
  const originalEntry = await tx.journalEntry.findFirst({
    where: {
      sourceType: input.sourceType,
      sourceId: input.sourceId
    }
  });

  const original = await loadJournalWithRelations(tx, originalEntry);

  if (!original) {
    return null;
  }

  if (original.lines.length === 0) {
    const existingReversalEntry = await tx.journalEntry.findFirst({
      where: {
        sourceType: input.reversalSourceType,
        sourceId: input.reversalSourceId
      }
    });
    const existingReversal = await loadJournalWithRelations(tx, existingReversalEntry);

    if (existingReversal) {
      return existingReversal;
    }

    const reversal = await tx.journalEntry.create({
      data: {
        entryNo: createOperationReference(input.entryNoPrefix),
        date: new Date(),
        description: input.description,
        sourceType: input.reversalSourceType,
        sourceId: input.reversalSourceId,
        createdByUserId: input.createdByUserId || null
      }
    });

    return {
      ...reversal,
      lines: []
    };
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
