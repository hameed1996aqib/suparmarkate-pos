const DEFAULT_INTERVAL_HOURS = 24;

export function startBackupScheduler(createBackup: () => Promise<unknown>) {
  const enabled = process.env.BACKUP_SCHEDULE_ENABLED === "true";
  if (!enabled) return;

  const hours = Math.max(1, Number(process.env.BACKUP_INTERVAL_HOURS || DEFAULT_INTERVAL_HOURS));
  const intervalMs = hours * 60 * 60 * 1000;

  const run = () => {
    void createBackup().catch((error) => {
      console.error("Scheduled backup failed", error);
    });
  };

  setTimeout(run, 30_000);
  setInterval(run, intervalMs);
  console.log(`Scheduled backup enabled every ${hours} hour(s)`);
}
