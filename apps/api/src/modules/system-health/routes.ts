import { Hono } from "hono";
import { prisma } from "../../lib/prisma";
import { getDiskHealth, getServerResourceHealth } from "../../lib/monitoring";
import { getMaintenanceMode } from "../../lib/maintenance-mode";
import { getPersistentJobWorkerHealth } from "../../lib/persistent-jobs";
import { listBackupFiles } from "../backups/service";
import { getRuntimeServerConfig } from "../../lib/runtime-server-config";

export const systemHealthRoute = new Hono();

type Severity = "critical" | "warning" | "info";

type HealthIssue = {
  id: string;
  severity: Severity;
  title: string;
  description: string;
  action: string;
};

const checklistMap: Record<string, string> = {
  "disk-critical": "P1.8 PostgreSQL operations baseline: disk space and separate backup disk",
  "disk-warning": "P1.8 PostgreSQL operations baseline: disk space monitoring",
  "backup-missing": "P0.1 PostgreSQL-native backup and restore",
  "backup-stale": "P0.1 PostgreSQL-native backup and restore",
  "backup-failed": "P0.1 PostgreSQL-native backup and restore",
  "worker-stopped": "P2 Background Jobs And Retention",
  "reconciliation-missing": "P1.9 Materialize current stock balance",
  "reconciliation-failed": "P1.9 Materialize current stock balance",
  "reconciliation-stale": "P1.9 Materialize current stock balance",
  "jobs-failed": "P2 Background Jobs And Retention",
  "maintenance-mode": "P0.1 Restore maintenance mode",
  "partition-review": "P1.7 Partition the largest append-only tables when needed",
  "cpu-warning": "P2 Load Testing And Observability: CPU saturation",
  "cpu-critical": "P2 Load Testing And Observability: CPU saturation",
  "memory-warning": "P2 Load Testing And Observability: memory pressure",
  "memory-critical": "P2 Load Testing And Observability: memory pressure"
};

function ageHours(value: Date | string | null | undefined) {
  if (!value) return null;
  return Math.round(((Date.now() - new Date(value).getTime()) / 3600000) * 10) / 10;
}

systemHealthRoute.get("/", async (c) => {
  const worker = getPersistentJobWorkerHealth();
  const serverConfig = getRuntimeServerConfig();
  const failedSince = new Date(Date.now() - 7 * 86400000);
  const partitionRows = Math.max(1000000, Number(process.env.PARTITION_WARNING_ROWS || 10000000));

  const [disk, resources, databaseSize, backups, latestBackupJob, latestReconciliation, latestRetention, failedJobs, pendingJobs, tables] =
    await Promise.all([
      getDiskHealth(),
      getServerResourceHealth(),
      prisma.$queryRaw<Array<{ bytes: bigint }>>`SELECT pg_database_size(current_database()) AS bytes`,
      listBackupFiles(),
      prisma.persistentJob.findFirst({
        where: { type: "BACKUP_CREATE" },
        orderBy: { createdAt: "desc" }
      }),
      prisma.persistentJob.findFirst({
        where: { type: "STOCK_RECONCILE" },
        orderBy: { createdAt: "desc" }
      }),
      prisma.persistentJob.findFirst({
        where: { type: "RETENTION_CLEANUP" },
        orderBy: { createdAt: "desc" }
      }),
      prisma.persistentJob.findMany({
        where: { status: "FAILED", completedAt: { gte: failedSince } },
        orderBy: { completedAt: "desc" },
        take: 20
      }),
      prisma.persistentJob.count({ where: { status: { in: ["PENDING", "RUNNING"] } } }),
      prisma.$queryRaw<Array<{ table: string; rows: bigint; totalBytes: bigint }>>`
        SELECT relname "table", n_live_tup::bigint rows, pg_total_relation_size(relid) "totalBytes"
        FROM pg_stat_user_tables
        ORDER BY pg_total_relation_size(relid) DESC
        LIMIT 12
      `
    ]);

  const issues: HealthIssue[] = [];
  const lastBackup = backups[0] ?? null;
  const lastBackupAgeHours = ageHours(lastBackup?.date);
  const maxBackupAgeHours = Math.max(1, Number(process.env.BACKUP_MAX_AGE_HOURS || 30));
  const reconcileAgeHours = ageHours(latestReconciliation?.completedAt);
  const reconcileMaxAgeHours = Math.max(1, Number(process.env.RECONCILIATION_MAX_AGE_HOURS || 36));
  const lastPollAgeMs = worker.lastPollAt ? Date.now() - new Date(worker.lastPollAt).getTime() : null;

  if (resources.cpu.usedPercent >= resources.cpu.criticalPercent) {
    issues.push({
      id: "cpu-critical",
      severity: "critical",
      title: "مصرف CPU بسیار زیاد است",
      description: `${resources.cpu.usedPercent}% از CPU سرور در حال استفاده است.`,
      action: "اگر پس از چند دقیقه ادامه داشت، گزارش‌های سنگین را متوقف و با پشتیبانی تماس بگیرید."
    });
  } else if (resources.cpu.usedPercent >= resources.cpu.warningPercent) {
    issues.push({
      id: "cpu-warning",
      severity: "warning",
      title: "مصرف CPU زیاد است",
      description: `${resources.cpu.usedPercent}% از CPU سرور در حال استفاده است.`,
      action: "اجرای گزارش، بکاپ یا عملیات سنگین هم‌زمان را بررسی کنید."
    });
  }

  if (resources.memory.freePercent <= resources.memory.criticalFreePercent) {
    issues.push({
      id: "memory-critical",
      severity: "critical",
      title: "حافظه RAM بسیار کم است",
      description: `فقط ${resources.memory.freePercent}% از RAM سرور آزاد مانده است.`,
      action: "برنامه‌های غیرضروری سرور را ببندید و در صورت تکرار RAM سرور را ارتقا دهید."
    });
  } else if (resources.memory.freePercent <= resources.memory.warningFreePercent) {
    issues.push({
      id: "memory-warning",
      severity: "warning",
      title: "حافظه RAM رو به پایان است",
      description: `${resources.memory.freePercent}% از RAM سرور آزاد مانده است.`,
      action: "مصرف حافظه را بررسی کنید و عملیات سنگین هم‌زمان را کاهش دهید."
    });
  }

  if (disk.freePercent < 10) {
    issues.push({
      id: "disk-critical",
      severity: "critical",
      title: "فضای دیسک بسیار کم است",
      description: `فقط ${disk.freePercent}% از دیسک بکاپ خالی مانده است.`,
      action: "فایل‌های غیرضروری را پاک کنید یا مسیر بکاپ را به دیسک بزرگ‌تر انتقال دهید."
    });
  } else if (disk.status === "warning") {
    issues.push({
      id: "disk-warning",
      severity: "warning",
      title: "فضای دیسک رو به پایان است",
      description: `${disk.freePercent}% از دیسک بکاپ خالی مانده است.`,
      action: "فضای دیسک را بررسی کنید."
    });
  }

  if (!lastBackup) {
    issues.push({
      id: "backup-missing",
      severity: "critical",
      title: "هنوز بکاپ ساخته نشده است",
      description: "در صورت خرابی سرور امکان بازیابی اطلاعات وجود ندارد.",
      action: "همین حالا از صفحه بکاپ یک نسخه پشتیبان بسازید."
    });
  } else if (lastBackupAgeHours !== null && lastBackupAgeHours > maxBackupAgeHours) {
    issues.push({
      id: "backup-stale",
      severity: "critical",
      title: "بکاپ تازه نیست",
      description: `آخرین بکاپ ${lastBackupAgeHours} ساعت قبل ساخته شده است.`,
      action: "بکاپ دستی بسازید و اجرای بکاپ خودکار را بررسی کنید."
    });
  }

  if (latestBackupJob?.status === "FAILED") {
    issues.push({
      id: "backup-failed",
      severity: "critical",
      title: "آخرین job بکاپ ناکام شده است",
      description: latestBackupJob.error || "ساخت بکاپ با خطا متوقف شده است.",
      action: "فضای دیسک و تنظیمات PostgreSQL backup را بررسی کنید."
    });
  }

  if (worker.enabled && (!worker.running || lastPollAgeMs === null || lastPollAgeMs > worker.pollMs * 4)) {
    issues.push({
      id: "worker-stopped",
      severity: "critical",
      title: "worker پس‌زمینه فعال نیست",
      description: "بکاپ خودکار و پاک‌سازی دوره‌ای ممکن است اجرا نشوند.",
      action: "API فروشگاه را restart کنید و در صورت تکرار با پشتیبانی تماس بگیرید."
    });
  }

  if (!latestReconciliation) {
    issues.push({
      id: "reconciliation-missing",
      severity: "warning",
      title: "بررسی سازگاری موجودی هنوز اجرا نشده است",
      description: "پس از اولین اجرای خودکار، وضعیت موجودی در این بخش نمایش داده می‌شود.",
      action: "اگر پس از یک ساعت باقی ماند، API را restart کنید."
    });
  } else if (latestReconciliation.status === "FAILED") {
    issues.push({
      id: "reconciliation-failed",
      severity: "critical",
      title: "بررسی سازگاری موجودی ناکام شده است",
      description: latestReconciliation.error || "reconciliation موجودی با خطا متوقف شده است.",
      action: "با پشتیبانی تماس بگیرید."
    });
  } else if (reconcileAgeHours !== null && reconcileAgeHours > reconcileMaxAgeHours) {
    issues.push({
      id: "reconciliation-stale",
      severity: "warning",
      title: "بررسی موجودی به‌موقع اجرا نشده است",
      description: `آخرین بررسی ${reconcileAgeHours} ساعت قبل تکمیل شده است.`,
      action: "وضعیت worker را بررسی کنید."
    });
  }

  if (failedJobs.length > 0) {
    issues.push({
      id: "jobs-failed",
      severity: "warning",
      title: "job ناکام در هفت روز اخیر وجود دارد",
      description: `${failedJobs.length} job نیاز به بررسی دارد.`,
      action: "جزئیات jobهای ناکام را در جدول پایین بررسی کنید."
    });
  }

  if (getMaintenanceMode()) {
    issues.push({
      id: "maintenance-mode",
      severity: "warning",
      title: "سیستم در حالت maintenance است",
      description: "عملیات تغییردهنده اطلاعات فعلاً مسدود است.",
      action: "پس از تکمیل Restore وضعیت API را بررسی کنید."
    });
  }

  const tableRows = tables.map((row) => ({
    name: row.table,
    rows: Number(row.rows),
    sizeBytes: Number(row.totalBytes),
    partitionReviewRecommended: Number(row.rows) >= partitionRows
  }));
  if (tableRows.some((row) => row.partitionReviewRecommended)) {
    issues.push({
      id: "partition-review",
      severity: "info",
      title: "بررسی دوره‌ای دیتابیس پیشنهاد می‌شود",
      description: "حداقل یک جدول به آستانه بررسی partitioning رسیده است.",
      action: "برای سرویس دوره‌ای با پشتیبانی تماس بگیرید."
    });
  }

  const critical = issues.filter((issue) => issue.severity === "critical").length;
  const warning = issues.filter((issue) => issue.severity === "warning").length;

  return c.json({
    data: {
      status: critical > 0 ? "critical" : warning > 0 ? "warning" : "healthy",
      counts: { total: issues.length, critical, warning, info: issues.length - critical - warning },
      issues: issues.map((item) => ({
        ...item,
        checklist: checklistMap[item.id] || "P2 Load Testing And Observability"
      })),
      disk,
      resources,
      serverConfig,
      database: {
        connected: true,
        sizeBytes: Number(databaseSize[0]?.bytes || 0),
        tables: tableRows
      },
      backup: {
        count: backups.length,
        lastSuccessfulAt: lastBackup?.date ?? null,
        lastSuccessfulAgeHours: lastBackupAgeHours,
        latestJob: latestBackupJob
      },
      worker,
      jobs: {
        pending: pendingJobs,
        failed: failedJobs
      },
      reconciliation: latestReconciliation,
      retention: latestRetention,
      checkedAt: new Date().toISOString()
    }
  });
});
