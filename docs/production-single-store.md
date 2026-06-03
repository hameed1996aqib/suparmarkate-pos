# Belal POS Production Setup - Single Store

## Server PC

Use one Windows PC inside the shop as the server.

1. Install PostgreSQL and Redis, or start the included Docker services.
2. Copy `apps/api/.env.example` to `apps/api/.env`.
3. Change `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGINS`, `BACKUP_DIR`, `REDIS_URL`, and the seed admin password.
4. Run:

```powershell
npm install
npm run prisma:generate
npm run prisma:deploy
npm run seed:admin
npm run build:api
npm --workspace @supermarket/api run start
```

For a server installation, the equivalent helper scripts are:

```powershell
npm run server:install
npm run server:firewall
npm run server:startup
```

Run the firewall and startup commands from an Administrator PowerShell window.

For LAN clients, set `CORS_ORIGINS` to the desktop/web origins used in the shop, for example:

```env
CORS_ORIGINS="http://localhost:5173,http://192.168.1.10:5173"
```

Open Windows Firewall for:

- API: `4000`
- POS WebSocket: `4001`
- System health WebSocket: `4002`
- Web frontend if served on LAN: `5173` or the production web server port

## First Login

The seed creates the first Admin user from:

```env
SEED_ADMIN_USERNAME="admin"
SEED_ADMIN_PASSWORD="change-me-now"
```

Change this password before using the system with real data.

## Clients

Desktop computers use the Electron app or LAN web URL. Mobile devices use the browser/PWA URL from the same network.

Each seller must have a separate user account. Do not share the Admin account for sales.

## Store Profile And Currency

AFN is the permanent base currency. Other currencies can be used for transactions
with their rate history, but they cannot replace AFN as the base currency after
installation. This protects historical base snapshots and accounting reports.

Admin can upload the store logo from `Data > Settings > Store Profile`. The logo
is reused in sales receipts, customer/supplier payment receipts, POS receipts and
official Desktop report printing.

Transactional tables open with the latest 30 days by default. Use the visible
date pickers to load an older sales, purchase, return, treasury or income/expense
period when required.

The Desktop installer is not tied to a customer IP during build. On first launch,
open `تنظیم سرور` on the login screen and enter the store-server API URL, for
example:

```text
http://192.168.1.10:4000
```

The URL is stored locally on that workstation. Admin can change it later from
`دیتای پایه > سرور و بکاپ`. Each installed workstation keeps its own connection
URL, so moving the server to a new IP requires updating each client once.

## Backup

Set:

```env
BACKUP_DIR="D:\\BelalBackups"
BACKUP_SCHEDULE_ENABLED="true"
BACKUP_INTERVAL_HOURS="24"
BACKUP_RETENTION_COUNT="7"
BACKUP_UPLOADS_ENABLED="true"
PG_DUMP_PATH="pg_dump"
PG_RESTORE_PATH="pg_restore"
PG_DOCKER_FALLBACK="true"
PG_DOCKER_CONTAINER="muhaseb_postgres"
```

Only Admin users should run backup or restore. Before a real restore, take a fresh backup of the current database and test restore on a copy first.

After installation, Admin can change the backup path and retention count from
`دیتای پایه > سرور و بکاپ`. The recommended retention is the latest `7` backups.
Reducing the count removes extra older backups immediately. Changing the path
does not move old backup files automatically; keep or archive the old folder
until it is no longer needed. Backup path and retention changes apply without an
API restart and are stored in `apps/api/data/server-config.json`.

The application uses PostgreSQL custom-format backups through `pg_dump` and
`pg_restore`. Backup requests are persisted as PostgreSQL jobs and processed by
the background worker, so an API restart does not lose queued work. Uploaded files
are stored beside each `.dump` file unless `BACKUP_UPLOADS_ENABLED` is disabled.
Unchanged upload files are hard-linked from the previous snapshot when the
filesystem supports it; otherwise they are copied. Restore first creates a safety
backup of the current database.

If `pg_dump` is not installed on Windows `PATH`, the API falls back to the included
PostgreSQL Docker container. Set `PG_DOCKER_FALLBACK="false"` when PostgreSQL is
installed directly on Windows and use absolute tool paths if needed.

## Full system reset

در صفحه تنظیمات سرور، Admin می‌تواند سیستم را برای نصب تازه ریست کند. اجرای reset به رمز عبور Admin و عبارت دقیق `RESET MUHASEB` نیاز دارد.

- پیش از پاک‌سازی یک بکاپ ایمنی PostgreSQL همراه فایل‌های آپلود ساخته می‌شود.
- معاملات، master data، کاربران فرعی، تنظیمات شرکت و فایل‌های آپلود پاک می‌شوند.
- بکاپ‌ها و تنظیمات runtime سرور باقی می‌مانند.
- حساب Admin فعلی، AFN، گدام مرکزی، صندوق مرکزی، واحد عدد و حساب‌های پایه دوباره ساخته می‌شوند.
- پس از reset تمام sessionها باطل می‌شوند و Admin باید دوباره login کند.

## Monitoring

The `/health` endpoint reports database connectivity, database size, and free disk
space for the backup disk. Requests slower than `API_SLOW_REQUEST_MS` are logged.
For PostgreSQL query diagnostics, enable `pg_stat_statements` once:

```powershell
psql $env:DATABASE_URL -f scripts/postgres/enable-monitoring.sql
```

Review table growth monthly:

```powershell
npm --workspace @supermarket/api run db:metrics
psql $env:DATABASE_URL -f scripts/postgres/partition-readiness.sql
```

The API also runs retention cleanup as a persistent background job. Configure:

```env
JOB_WORKER_ENABLED="true"
JOB_WORKER_POLL_MS="2000"
RETENTION_INTERVAL_HOURS="24"
AUDIT_LOG_RETENTION_DAYS="730"
QR_TOKEN_RETENTION_DAYS="30"
SESSION_RETENTION_DAYS="30"
JOB_RETENTION_DAYS="30"
EXPORT_RETENTION_DAYS="7"
EXPORT_DIR="D:\\MuhasebExports"
```

Large ledger and stock CSV downloads use streaming endpoints:

```text
GET /api/exports/ledger.csv?accountId=...&from=...&to=...
GET /api/exports/stock.csv
```

For very large exports, queue a persistent background job and poll its status:

```text
POST /api/exports/ledger
POST /api/exports/stock
GET  /api/exports/jobs/:id
GET  /api/exports/files/:filename
```

Generated CSV files are removed after `EXPORT_RETENTION_DAYS`.

Run the release smoke load test against a staging or sanitized database:

```powershell
.\scripts\load-test\smoke-api.ps1 -BaseUrl "http://localhost:4000" -Token "<JWT>" -Requests 100
```

## System Health

After installation, Admin users can open `سلامت سیستم` from the System group in
the sidebar. The page checks backup freshness, free backup-disk space, database
size, background worker heartbeat, stock reconciliation, retention cleanup,
failed jobs, CPU usage, free RAM and tables approaching the partition-review
threshold. Each warning names the related section in `docs/scalability-audit.md`.

The header alert badge includes these operational warnings. The customer should
contact support when the page shows a critical item that remains after restarting
the API. Configure thresholds with:

```env
BACKUP_MAX_AGE_HOURS="30"
RECONCILIATION_MAX_AGE_HOURS="36"
PARTITION_WARNING_ROWS="10000000"
CPU_WARNING_PERCENT="85"
CPU_CRITICAL_PERCENT="95"
MEMORY_WARNING_FREE_PERCENT="15"
MEMORY_CRITICAL_FREE_PERCENT="5"
SYSTEM_HEALTH_WS_PORT="4002"
```

The health page receives CPU and RAM samples every two seconds over the
authenticated System Health WebSocket and charts the recent values in real time.
