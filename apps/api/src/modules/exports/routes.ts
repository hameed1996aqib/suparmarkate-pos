import { Hono } from "hono";
import { stream, streamText } from "hono/streaming";
import { access } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { prisma } from "../../lib/prisma";
import { enqueueJob, getJob } from "../../lib/persistent-jobs";
import { resolveExportFile } from "./service";

export const exportsRoute = new Hono();

function csv(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function dateRange(c: any) {
  const from = c.req.query("from") ? new Date(c.req.query("from")) : new Date(0);
  const to = c.req.query("to") ? new Date(c.req.query("to")) : new Date();
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

exportsRoute.post("/ledger", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const accountId = String(body.accountId || "").trim() || undefined;
  const partyId = String(body.partyId || "").trim() || undefined;
  if (!accountId && !partyId) return c.json({ message: "accountId or partyId is required" }, 400);
  const job = await enqueueJob("EXPORT_LEDGER_CSV", {
    accountId,
    partyId,
    from: body.from ? String(body.from) : undefined,
    to: body.to ? String(body.to) : undefined
  });
  return c.json({ data: job }, 202);
});

exportsRoute.post("/stock", async (c) => {
  const job = await enqueueJob("EXPORT_STOCK_CSV");
  return c.json({ data: job }, 202);
});

exportsRoute.get("/jobs/:id", async (c) => {
  const job = await getJob(c.req.param("id"));
  if (!job || !job.type.startsWith("EXPORT_")) return c.json({ message: "Export job not found" }, 404);
  return c.json({ data: { ...job, status: job.status.toLowerCase() } });
});

exportsRoute.get("/files/:filename", async (c) => {
  const filePath = resolveExportFile(c.req.param("filename"));
  if (!filePath) return c.json({ message: "Invalid export filename" }, 400);
  try {
    await access(filePath);
  } catch {
    return c.json({ message: "Export file not found" }, 404);
  }
  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="${c.req.param("filename")}"`);
  return stream(c, async (output) => {
    for await (const chunk of createReadStream(filePath)) await output.write(chunk);
  });
});

exportsRoute.get("/ledger.csv", async (c) => {
  const accountId = c.req.query("accountId")?.trim();
  const partyId = c.req.query("partyId")?.trim();
  const { from, to } = dateRange(c);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return c.json({ message: "Invalid date range" }, 400);
  }
  if (!accountId && !partyId) {
    return c.json({ message: "accountId or partyId is required" }, 400);
  }

  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="ledger-${new Date().toISOString().slice(0, 10)}.csv"`);

  return streamText(c, async (stream) => {
    await stream.write("\uFEFF");
    await stream.writeln("Date,Entry No,Account,Party,Description,Debit,Credit,Note");
    let cursor: string | undefined;

    for (;;) {
      const rows = await prisma.journalLine.findMany({
        where: {
          ...(accountId ? { accountId } : {}),
          ...(partyId ? { partyId } : {}),
          journalEntry: { date: { gte: from, lte: to } }
        },
        include: { account: true, party: true, journalEntry: true },
        orderBy: { id: "asc" },
        take: 500,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
      });
      if (!rows.length) break;

      for (const row of rows) {
        await stream.writeln([
          row.journalEntry.date.toISOString(),
          row.journalEntry.entryNo,
          `${row.account.code} - ${row.account.name}`,
          row.party?.name || "",
          row.journalEntry.description || "",
          Number(row.baseDebit || row.debit),
          Number(row.baseCredit || row.credit),
          row.note || ""
        ].map(csv).join(","));
      }

      cursor = rows.at(-1)!.id;
      if (rows.length < 500) break;
    }
  });
});

exportsRoute.get("/stock.csv", async (c) => {
  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="stock-${new Date().toISOString().slice(0, 10)}.csv"`);

  return streamText(c, async (stream) => {
    await stream.write("\uFEFF");
    await stream.writeln("Product,Barcode,Warehouse,Quantity,Value,Nearest Expiry");
    let cursor: string | undefined;

    for (;;) {
      const rows = await prisma.stockBalance.findMany({
        include: { product: true, warehouse: true },
        orderBy: { id: "asc" },
        take: 500,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
      });
      if (!rows.length) break;

      for (const row of rows) {
        await stream.writeln([
          row.product.name,
          row.product.barcode || "",
          row.warehouse.name,
          Number(row.quantityBase),
          Number(row.valueBase),
          row.earliestExpiryAt?.toISOString() || ""
        ].map(csv).join(","));
      }

      cursor = rows.at(-1)!.id;
      if (rows.length < 500) break;
    }
  });
});
