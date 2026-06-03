import { createWriteStream } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { prisma } from "../../lib/prisma";

type LedgerExportPayload = {
  accountId?: string;
  partyId?: string;
  from?: string;
  to?: string;
};

function csv(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function exportDir() {
  return path.resolve(process.env.EXPORT_DIR || path.join(process.cwd(), "exports"));
}

function parseDate(value: string | undefined, fallback: Date) {
  const date = value ? new Date(value) : fallback;
  if (Number.isNaN(date.getTime())) throw new Error("Invalid export date range");
  return date;
}

async function write(output: ReturnType<typeof createWriteStream>, value: string) {
  if (!output.write(value)) await once(output, "drain");
}

async function finish(output: ReturnType<typeof createWriteStream>) {
  output.end();
  await once(output, "close");
}

async function createOutput(prefix: string) {
  const directory = exportDir();
  await mkdir(directory, { recursive: true });
  const fileName = `${prefix}-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.csv`;
  const filePath = path.join(directory, fileName);
  return { fileName, filePath, output: createWriteStream(filePath, { encoding: "utf8" }) };
}

export async function createLedgerCsvExport(payload: LedgerExportPayload) {
  if (!payload.accountId && !payload.partyId) throw new Error("accountId or partyId is required");
  const from = parseDate(payload.from, new Date(0));
  const to = parseDate(payload.to, new Date());
  to.setHours(23, 59, 59, 999);
  const { fileName, filePath, output } = await createOutput("ledger");
  let cursor: string | undefined;
  let rowsWritten = 0;

  try {
    await write(output, "\uFEFFDate,Entry No,Account,Party,Description,Debit,Credit,Note\n");
    for (;;) {
      const rows = await prisma.journalLine.findMany({
        where: {
          ...(payload.accountId ? { accountId: payload.accountId } : {}),
          ...(payload.partyId ? { partyId: payload.partyId } : {}),
          journalEntry: { date: { gte: from, lte: to } }
        },
        include: { account: true, party: true, journalEntry: true },
        orderBy: { id: "asc" },
        take: 500,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
      });
      if (!rows.length) break;

      for (const row of rows) {
        await write(output, [
          row.journalEntry.date.toISOString(),
          row.journalEntry.entryNo,
          `${row.account.code} - ${row.account.name}`,
          row.party?.name || "",
          row.journalEntry.description || "",
          Number(row.baseDebit || row.debit),
          Number(row.baseCredit || row.credit),
          row.note || ""
        ].map(csv).join(",") + "\n");
        rowsWritten += 1;
      }

      cursor = rows.at(-1)!.id;
      if (rows.length < 500) break;
    }
    await finish(output);
    return { fileName, rows: rowsWritten };
  } catch (error) {
    output.destroy();
    await rm(filePath, { force: true });
    throw error;
  }
}

export async function createStockCsvExport() {
  const { fileName, filePath, output } = await createOutput("stock");
  let cursor: string | undefined;
  let rowsWritten = 0;

  try {
    await write(output, "\uFEFFProduct,Barcode,Warehouse,Quantity,Value,Nearest Expiry\n");
    for (;;) {
      const rows = await prisma.stockBalance.findMany({
        include: { product: true, warehouse: true },
        orderBy: { id: "asc" },
        take: 500,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
      });
      if (!rows.length) break;

      for (const row of rows) {
        await write(output, [
          row.product.name,
          row.product.barcode || "",
          row.warehouse.name,
          Number(row.quantityBase),
          Number(row.valueBase),
          row.earliestExpiryAt?.toISOString() || ""
        ].map(csv).join(",") + "\n");
        rowsWritten += 1;
      }

      cursor = rows.at(-1)!.id;
      if (rows.length < 500) break;
    }
    await finish(output);
    return { fileName, rows: rowsWritten };
  } catch (error) {
    output.destroy();
    await rm(filePath, { force: true });
    throw error;
  }
}

export async function cleanupExportFiles(retentionDays: number) {
  const directory = exportDir();
  const threshold = Date.now() - retentionDays * 86400000;
  const files = await readdir(directory, { withFileTypes: true }).catch(() => []);
  let removed = 0;

  for (const file of files) {
    if (!file.isFile() || !file.name.endsWith(".csv")) continue;
    const filePath = path.join(directory, file.name);
    if ((await stat(filePath)).mtimeMs < threshold) {
      await rm(filePath, { force: true });
      removed += 1;
    }
  }

  return removed;
}

export function resolveExportFile(fileName: string) {
  if (!/^[A-Za-z0-9_.-]+\.csv$/.test(fileName)) return null;
  const directory = exportDir();
  const filePath = path.resolve(directory, fileName);
  return filePath.startsWith(`${directory}${path.sep}`) ? filePath : null;
}
