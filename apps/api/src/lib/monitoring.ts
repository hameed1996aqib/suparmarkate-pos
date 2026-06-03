import { mkdir, statfs } from "node:fs/promises";
import os from "node:os";
import type { MiddlewareHandler } from "hono";
import { getRuntimeServerConfig } from "./runtime-server-config";

function percent(value: number) {
  return Math.round(value * 10000) / 100;
}

export async function getDiskHealth() {
  const target = getRuntimeServerConfig().backupDir;
  await mkdir(target, { recursive: true });
  const stats = await statfs(target);
  const totalBytes = Number(stats.blocks) * Number(stats.bsize);
  const freeBytes = Number(stats.bavail) * Number(stats.bsize);
  const freePercent = totalBytes > 0 ? percent(freeBytes / totalBytes) : 0;
  const warningThreshold = Number(process.env.DISK_WARNING_PERCENT || 15);

  return {
    path: target,
    totalBytes,
    freeBytes,
    freePercent,
    status: freePercent <= warningThreshold ? "warning" : "ok"
  };
}

function cpuSnapshot() {
  return os.cpus().reduce(
    (summary, cpu) => {
      const total = Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
      return {
        idle: summary.idle + cpu.times.idle,
        total: summary.total + total
      };
    },
    { idle: 0, total: 0 }
  );
}

export async function getServerResourceHealth() {
  const before = cpuSnapshot();
  await new Promise((resolve) => setTimeout(resolve, 250));
  const after = cpuSnapshot();
  const totalDelta = Math.max(1, after.total - before.total);
  const idleDelta = Math.max(0, after.idle - before.idle);
  const cpuUsedPercent = percent((totalDelta - idleDelta) / totalDelta);
  const memoryTotalBytes = os.totalmem();
  const memoryFreeBytes = os.freemem();
  const memoryFreePercent = memoryTotalBytes > 0 ? percent(memoryFreeBytes / memoryTotalBytes) : 0;

  return {
    cpu: {
      cores: os.cpus().length,
      usedPercent: cpuUsedPercent,
      warningPercent: Number(process.env.CPU_WARNING_PERCENT || 85),
      criticalPercent: Number(process.env.CPU_CRITICAL_PERCENT || 95)
    },
    memory: {
      totalBytes: memoryTotalBytes,
      freeBytes: memoryFreeBytes,
      usedBytes: memoryTotalBytes - memoryFreeBytes,
      freePercent: memoryFreePercent,
      warningFreePercent: Number(process.env.MEMORY_WARNING_FREE_PERCENT || 15),
      criticalFreePercent: Number(process.env.MEMORY_CRITICAL_FREE_PERCENT || 5)
    },
    uptimeSeconds: Math.round(os.uptime())
  };
}

export const slowRequestMiddleware: MiddlewareHandler = async (c, next) => {
  const startedAt = Date.now();
  await next();
  const elapsedMs = Date.now() - startedAt;
  const thresholdMs = Number(process.env.API_SLOW_REQUEST_MS || 750);

  if (elapsedMs >= thresholdMs) {
    console.warn(
      `[slow-request] ${c.req.method} ${new URL(c.req.url).pathname} ${elapsedMs}ms status=${c.res.status}`
    );
  }
};
