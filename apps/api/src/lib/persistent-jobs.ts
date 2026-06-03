import { randomUUID } from "node:crypto";
import { prisma } from "./prisma";
import { createAutomatedBackup } from "../modules/backups/service";
import { reconcileStockBalances } from "./stock-balance-reconciliation";
import { runRetentionCleanup } from "./retention";
import { createLedgerCsvExport, createStockCsvExport } from "../modules/exports/service";

export type JobType =
  | "BACKUP_CREATE"
  | "STOCK_RECONCILE"
  | "RETENTION_CLEANUP"
  | "EXPORT_LEDGER_CSV"
  | "EXPORT_STOCK_CSV";

const workerId = `${process.pid}-${randomUUID().slice(0, 8)}`;
let workerTimer: NodeJS.Timeout | null = null;
let retentionTimer: NodeJS.Timeout | null = null;
let isWorking = false;
let workerStartedAt: Date | null = null;
let lastPollAt: Date | null = null;

export async function enqueueJob(
  type: JobType,
  payload: Record<string, unknown> = {},
  options: { runAfter?: Date; maxAttempts?: number } = {}
) {
  return prisma.persistentJob.create({
    data: {
      type,
      payload: payload as any,
      runAfter: options.runAfter,
      maxAttempts: options.maxAttempts ?? 3
    }
  });
}

export async function getJob(id: string) {
  return prisma.persistentJob.findUnique({ where: { id } });
}

async function claimNextJob() {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH candidate AS (
      SELECT id FROM "PersistentJob"
      WHERE status = 'PENDING' AND "runAfter" <= NOW()
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE "PersistentJob" job
    SET status = 'RUNNING', "lockedAt" = NOW(), "lockedBy" = ${workerId},
      "startedAt" = COALESCE(job."startedAt", NOW()), attempts = attempts + 1,
      "updatedAt" = NOW()
    FROM candidate
    WHERE job.id = candidate.id
    RETURNING job.id
  `;

  return rows[0]?.id ? prisma.persistentJob.findUnique({ where: { id: rows[0].id } }) : null;
}

async function handleJob(type: string, payload: unknown) {
  if (type === "BACKUP_CREATE") return createAutomatedBackup();
  if (type === "STOCK_RECONCILE") return reconcileStockBalances();
  if (type === "RETENTION_CLEANUP") return runRetentionCleanup();
  if (type === "EXPORT_LEDGER_CSV") return createLedgerCsvExport((payload || {}) as any);
  if (type === "EXPORT_STOCK_CSV") return createStockCsvExport();
  throw new Error(`Unsupported job type: ${type}`);
}

async function workOnce() {
  if (isWorking) return;
  isWorking = true;
  lastPollAt = new Date();
  try {
    const job = await claimNextJob();
    if (!job) return;

    try {
      const result = await handleJob(job.type, job.payload);
      await prisma.persistentJob.update({
        where: { id: job.id },
        data: {
          status: "COMPLETED",
          result: result as any,
          error: null,
          completedAt: new Date(),
          lockedAt: null,
          lockedBy: null
        }
      });
    } catch (error) {
      const retry = job.attempts < job.maxAttempts;
      await prisma.persistentJob.update({
        where: { id: job.id },
        data: {
          status: retry ? "PENDING" : "FAILED",
          error: error instanceof Error ? error.message : "Job failed",
          runAfter: retry ? new Date(Date.now() + 60_000) : job.runAfter,
          completedAt: retry ? null : new Date(),
          lockedAt: null,
          lockedBy: null
        }
      });
    }
  } finally {
    isWorking = false;
  }
}

export async function recoverInterruptedJobs() {
  const staleBefore = new Date(Date.now() - 15 * 60_000);
  await prisma.persistentJob.updateMany({
    where: { status: "RUNNING", lockedAt: { lt: staleBefore } },
    data: {
      status: "PENDING",
      lockedAt: null,
      lockedBy: null,
      runAfter: new Date()
    }
  });
}

export async function startPersistentJobWorker() {
  if (process.env.JOB_WORKER_ENABLED === "false") return;
  await recoverInterruptedJobs();
  workerStartedAt = new Date();
  const pollMs = Math.max(500, Number(process.env.JOB_WORKER_POLL_MS || 2000));
  workerTimer = setInterval(() => void workOnce(), pollMs);
  const retentionHours = Math.max(1, Number(process.env.RETENTION_INTERVAL_HOURS || 24));
  retentionTimer = setInterval(
    () => void enqueueJob("RETENTION_CLEANUP", { source: "schedule" }),
    retentionHours * 60 * 60 * 1000
  );
  setTimeout(() => void enqueueJob("RETENTION_CLEANUP", { source: "startup" }), 45_000);
  void workOnce();
  console.log(`Persistent job worker started (${workerId})`);
}

export function stopPersistentJobWorker() {
  if (workerTimer) clearInterval(workerTimer);
  if (retentionTimer) clearInterval(retentionTimer);
  workerTimer = null;
  retentionTimer = null;
  workerStartedAt = null;
  lastPollAt = null;
}

export function getPersistentJobWorkerHealth() {
  return {
    enabled: process.env.JOB_WORKER_ENABLED !== "false",
    running: Boolean(workerTimer),
    busy: isWorking,
    startedAt: workerStartedAt?.toISOString() ?? null,
    lastPollAt: lastPollAt?.toISOString() ?? null,
    pollMs: Math.max(500, Number(process.env.JOB_WORKER_POLL_MS || 2000))
  };
}
