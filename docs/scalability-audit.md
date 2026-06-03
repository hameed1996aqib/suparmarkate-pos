# Muhaseb Scalability Audit

## Scope

This checklist reviews the current single-store architecture for long-term growth:

- One PostgreSQL database on the store server
- Several desktop and mobile POS clients over LAN
- Transaction history retained for years
- Database and uploaded documents potentially growing to hundreds of GB

The current implementation is suitable for initial production use with modest data. Before the database becomes large, the P0 and P1 items below should be completed.

## Current Strengths

- PostgreSQL is already used as the source of truth.
- Core transaction tables have basic indexes for common foreign keys and dates.
- Sales, purchases, returns, treasury lists and inventory movement lists already cap some responses.
- Financial edits are implemented as reversal plus repost, preserving auditability.
- Uploaded attachments are stored outside PostgreSQL and limited to 10 MB per file.
- POS sale posting uses server-side database transactions.

## P0: Must Fix Before Large Production Data

### 1. Replace JSON database backup with PostgreSQL-native backup

**Finding**

The original implementation loaded every table into one JSON string in memory
and copied the entire uploads directory for every backup. Phase A and Phase C
replaced that path with PostgreSQL custom-format dumps and incremental upload
snapshots handled by the durable worker.

**Risk**

- API memory exhaustion
- Long pauses during backup
- Huge duplicate upload folders
- Slow restore and long store downtime
- Inconsistent snapshot if writes continue during backup

**Checklist**

- [x] Use `pg_dump --format=custom` for manual and scheduled database backup.
- [x] Use `pg_restore` for restore.
- [x] Keep uploads backup separate from DB backup.
- [x] Use incremental file backup or deduplicated archive for uploads.
- [x] Run backup as a background process, not inside the API request lifecycle.
- [x] Store backup status, started time, completed time, size and error log.
- [x] Add restore maintenance mode and block writes during restore.
- [ ] Test restore on a separate database monthly.
- [ ] Define RPO and RTO. Suggested first target: RPO 24 hours, RTO 2 hours.
- [ ] Add optional WAL archiving later if the store needs point-in-time recovery.

**Acceptance**

- Backup does not materially increase API memory.
- POS can continue working during backup.
- A 100 GB test database can be restored successfully.

### 2. Add server-side pagination to all growing lists

**Finding**

Several endpoints return a fixed latest set such as `take: 100`, while UI tables paginate only the already downloaded rows. Other endpoints return all matching rows.

**Risk**

- Old records become unreachable from UI.
- Search only covers the first downloaded records.
- Large responses freeze the desktop app.
- Memory and network usage grow with history.

**Checklist**

- [ ] Standardize list query parameters: `cursor`, `limit`, `search`, `sort`, `from`, `to`, filters.
- [ ] Return `{ items, nextCursor, total? }`.
- [ ] Prefer cursor pagination for transaction tables.
- [x] Use bounded page size, normally 25 to 100.
- [ ] Move search and filters to API for sales, purchases, returns, treasury, inventory movements, journal lines, attachments, audit logs and payroll payments.
- [ ] Keep master-data combobox endpoints separate and lightweight.
- [x] Update reusable desktop tables to request the next page from the API.
- [ ] Avoid `count(*)` on every list request unless the UI truly needs an exact total.

**Acceptance**

- Any historical document can be reached.
- Opening a list does not load more than the configured page size.
- Search finds records older than the first 100 rows.

### 3. Move dashboard and report aggregation into PostgreSQL

**Finding**

Dashboard and management reports fetch full sets of sales, purchases, sale items, returns and money transactions for a date range, then aggregate them in Node.js. Employee performance repeatedly searches employee arrays while iterating transactions.

**Risk**

- Slow dashboard for monthly and four-month ranges
- High API memory and CPU
- Event-loop stalls affecting POS requests
- Response time grows linearly with transaction volume

**Checklist**

- [x] Replace full-row reads with SQL `SUM`, `COUNT`, `GROUP BY` and filtered aggregates.
- [x] Aggregate trend charts in SQL by day/week/month.
- [x] Aggregate cashier sales in SQL.
- [x] Aggregate category and product rankings in SQL and return only top N.
- [x] Compute cash flow using grouped money transaction queries.
- [ ] Build maps by user ID before report loops; avoid repeated `.find()`.
- [x] Add short TTL cache for dashboard summary: 15 to 60 seconds.
- [x] Cache by period and currency.
- [ ] Invalidate or expire cache after postings; do not cache document detail.
- [ ] Add summary tables or materialized views if SQL aggregates become slow.

**Acceptance**

- Dashboard P95 response time stays under 1 second for normal ranges.
- Dashboard does not load raw monthly transaction rows into Node.js.
- POS posting latency is not affected by dashboard refresh.

### 4. Fix ledger queries before journal history grows

**Finding**

Account and party ledger routes load all historical journal lines to calculate opening balances and running balances. Period views also load all pre-period rows for opening balance.

**Risk**

- Ledger pages become unusable after years of activity.
- Printing a statement can allocate very large arrays.
- Opening balance calculation becomes increasingly slow.

**Checklist**

- [x] Calculate opening debit and credit with database `SUM`.
- [x] Paginate period rows.
- [x] Add account and party statement date filters everywhere.
- [ ] Add monthly closing balance snapshots per account and party.
- [ ] Compute running balance from the nearest snapshot plus period rows.
- [ ] Generate large print/export reports asynchronously.
- [x] Stream CSV export instead of building full output in memory.
- [ ] Move very large printable PDF generation to an asynchronous streamed path.

**Acceptance**

- A ledger with millions of lines opens its first page quickly.
- Opening balance does not require reading all prior journal rows.

### 5. Replace expensive master-data usage detection

**Finding**

Product and party list endpoints query many transaction tables with `distinct` to discover whether soft-deleted rows were previously used. This runs on normal list loads, including POS product loading and party lookup.

**Risk**

- Product and customer lookup slows down as history grows.
- POS startup and search degrade over time.

**Checklist**

- [x] Do not scan historical tables during normal product and party list requests.
- [ ] Return active rows by default.
- [ ] Add `includeDeleted=true` only for administrative views.
- [ ] Maintain `hasTransactions` or `usageCount` summary fields, or use a separate lightweight usage endpoint.
- [x] Create dedicated POS product search endpoint with barcode/name query and a strict limit.
- [x] Create dedicated customer combobox endpoint returning only ID, name, code, phone and balance summary.
- [ ] Cache active categories, units, currencies and warehouses for 5 to 30 minutes.

**Acceptance**

- Barcode lookup remains fast regardless of transaction history size.
- POS does not download the full product catalog on startup.

## P1: Database Design And Indexing

### 6. Add compound and partial indexes for real query shapes

Basic single-column indexes exist, but large tables need indexes matching filters and sorting.

**Checklist**

- [x] `Sale(status, saleDate DESC)` and `Sale(currencyId, saleDate DESC)`.
- [x] `Sale(cashierId, saleDate DESC)` for cashier reports.
- [x] `Purchase(status, purchaseDate DESC)` and `Purchase(currencyId, purchaseDate DESC)`.
- [x] `MoneyTransaction(createdAt DESC, type)` and account/date variants.
- [x] `PartyTransaction(partyId, createdAt DESC)`.
- [x] `StockMovement(productId, warehouseId, createdAt DESC)`.
- [x] `StockMovement(type, createdAt DESC)`.
- [x] `StockLot(productId, warehouseId, remainingQuantity, expiryDate)`.
- [x] Partial index for stock lots where `remainingQuantity > 0`.
- [x] `JournalEntry(date DESC)` plus `JournalLine(accountId, createdAt)` and `JournalLine(partyId, createdAt)`.
- [x] `AuditLog(createdAt DESC)` retention-aware index.
- [x] `DocumentAttachment(entityType, entityId, deletedAt, createdAt DESC)`.
- [x] Use `pg_trgm` indexes for contains-search on product names and barcodes.
- [ ] Add a party-name `pg_trgm` index if measured customer search latency requires it.
- [ ] Validate indexes with `EXPLAIN (ANALYZE, BUFFERS)` using realistic data.

### 7. Partition the largest append-only tables when needed

Do not partition immediately without measurements. Prepare for it once rows reach tens of millions or vacuum/index maintenance becomes expensive.

**Candidates**

- `JournalLine`
- `StockMovement`
- `MoneyTransaction`
- `AuditLog`
- `SaleItem`
- `PurchaseItem`
- Attendance records if retained for many years

**Checklist**

- [ ] Measure table and index sizes monthly.
- [ ] Start with monthly or quarterly range partitions by `createdAt` or document date.
- [ ] Keep document headers and line partitions aligned with query patterns.
- [ ] Test Prisma compatibility and migration procedure on a copy of production data.
- [x] Define and schedule retention cleanup for old audit logs and QR tokens.

### 8. Add PostgreSQL operations baseline

**Checklist**

- [ ] Enable `pg_stat_statements`.
- [ ] Configure slow-query logging.
- [ ] Monitor DB size, table size, index size, dead tuples and vacuum status.
- [ ] Tune autovacuum for high-write tables.
- [ ] Schedule `ANALYZE`.
- [ ] Monitor connection count and query latency.
- [ ] Configure connection pool limits for the Windows server capacity.
- [ ] Put DB files and backups on separate disks where possible.
- [x] Monitor free disk space and alert before the configured threshold.
- [ ] Use UPS power protection for the store server.

## P1: Inventory, Alerts And POS

### 9. Materialize current stock balance

**Finding**

Inventory stock endpoints and alerts often read all active lots and aggregate in Node.js.

**Checklist**

- [x] Add a `StockBalance(productId, warehouseId, quantityBase, valueBase, updatedAt)` projection table.
- [x] Update it transactionally with stock movements.
- [x] Keep lots for FIFO and expiry detail, but use balance projection for list pages and alerts.
- [x] Paginate lot detail and movement history.
- [ ] Add separate expiry projection/query optimized by expiry date.
- [x] Reconciliation job: compare movement totals, lot totals and balance projection nightly.

**Acceptance**

- Inventory summary reads a compact balance table.
- Lot detail is loaded only when the user opens details.

### 10. Redesign alerts as computed summaries

**Finding**

Alerts load all active products with active stock lots, expiry lots and credit-limited parties on each request.

**Checklist**

- [x] Use stock balance projection for out-of-stock, low-stock and high-stock alerts.
- [x] Query expiry alerts directly with bounded result limits.
- [ ] Store alert summary rows or refresh them periodically.
- [ ] Return counts plus paginated alert items by category. Exact SQL counts and
  bounded items are implemented; category pagination remains.
- [x] Add 30 to 120 second TTL cache.

### 11. Make POS catalog search server-driven

**Checklist**

- [x] Barcode scan endpoint stays direct and indexed.
- [x] Product grid loads a bounded result set only.
- [x] Search API uses debounce and strict limit.
- [ ] Cache product master data and images locally on desktop where useful.
- [ ] Serve thumbnail images for POS cards; keep original images for details.
- [ ] Do not preload all customers; search customers after typing.
- [ ] Persist held carts in PostgreSQL or Redis if they must survive API restart.
- [ ] Add expiry cleanup for in-memory POS sessions, clients and carts.

## P1: Files And Attachments

### 12. Add scalable attachment storage

**Checklist**

- [x] Keep metadata in PostgreSQL and binary files outside the DB.
- [ ] Stream uploads to disk; avoid reading the whole file into memory.
- [x] Stream downloads with proper cache headers.
- [x] Generate thumbnails for product images.
- [ ] Use content hash or unique ID paths.
- [x] Physically delete orphaned files after soft-delete retention period.
- [ ] Add attachment storage quota and disk-space alerts.
- [ ] Consider MinIO or S3-compatible storage if files grow beyond local disk comfort.
- [ ] Separate upload retention policy from database backup retention.

## P2: Caching Strategy

Cache only derived or master data. PostgreSQL remains the source of truth.

### Recommended cache layer: Redis

Use Redis as the shared cache layer when production hardening starts. An in-process cache is acceptable only as a temporary first step during development.

Redis should improve repeated reads and absorb bursts, but it must not replace PostgreSQL indexes, pagination, SQL aggregation or stock projections.

Use the cache-aside pattern:

1. Read Redis first.
2. On cache miss, read PostgreSQL.
3. Store the result in Redis with a TTL.
4. On write, commit PostgreSQL first and then delete affected Redis keys.
5. Let the next read repopulate the cache.

For the Windows store server, deploy Redis deliberately:

- Prefer Redis Open Source in a Docker container with a persisted volume if Docker is part of the supported server setup.
- Use Memurai if a native Windows-compatible service is required.
- Keep the application functional when Redis is unavailable by falling back to PostgreSQL.
- Bind Redis to localhost or a private interface only; do not expose it to the store LAN without authentication and firewall rules.
- Configure `maxmemory` and an eviction policy suitable for disposable cache keys, normally `allkeys-lfu` or `allkeys-lru`.
- Namespace keys, for example `muhaseb:cache:dashboard:*`.
- Track hit rate, miss rate, memory usage, evictions and connection errors.

### Redis is appropriate for

**Cache candidates**

- [ ] Currencies and latest rates: 5 minutes, invalidate on rate change.
- [ ] Units, categories and warehouses: 10 to 30 minutes.
- [x] POS product search results: 30 to 120 seconds.
- [x] Dashboard summary by period/currency: 15 to 60 seconds.
- [x] Alerts counts: 30 to 120 seconds.
- [ ] Company settings: 5 minutes.
- [ ] Product search result pages: 30 to 120 seconds, invalidate affected search namespaces on product changes.
- [ ] Customer combobox search pages: short TTL where useful.
- [x] Dashboard keys include period and currency; management report keys include
  its selected period.

### Redis is also useful for background work

- [x] Queue backups, large exports and reconciliation outside API request handlers.
- [x] Use the PostgreSQL-backed durable worker with row locking and stale-lock recovery.
- [x] Add retries with a capped attempt count.
- [x] Record exhausted jobs as failed for Admin inspection.
- [x] Store job status so the desktop UI can show progress and failure reasons.

**Do not cache**

- [ ] Current stock validation during sale posting.
- [ ] Account balance validation during payment posting.
- [ ] Authentication and permission decisions without proper invalidation.
- [ ] Document detail immediately after edit/cancel unless invalidated.

### Redis should not become a hard dependency for POS correctness

- [x] PostgreSQL remains authoritative for stock, balances, journals and posted documents.
- [x] POS sale posting must still work if Redis is temporarily unavailable.
- [ ] Redis-held sessions and carts should be persisted or recoverable if survival across API restart is required.
- [ ] Use Redis persistence only for data that truly must survive restart; cache keys remain disposable.

## P2: Background Jobs And Retention

**Checklist**

- [x] Run backup, large exports and reconciliation outside request handlers.
- [ ] Move thumbnail generation outside upload requests if image volume becomes high.
- [x] Purge expired sessions and QR tokens automatically.
- [x] Archive old audit logs according to policy.
- [x] Add retry and failure logging for background jobs.
- [x] Add an Admin health page for job status, worker heartbeat and last successful backup.

## P2: Load Testing And Observability

### System Health Warning Matrix

The Admin `سلامت سیستم` page links each operational warning to the checklist
section that should be applied. The header alert badge also includes these
warnings.

| Warning | Default threshold | Immediate action | Checklist section |
| --- | --- | --- | --- |
| Backup disk low | Free disk at or below `15%`; critical below `10%` | Free space or move backups to a larger disk | `P1.8 PostgreSQL operations baseline` |
| Backup missing or stale | No backup or latest backup older than `30` hours | Create a manual backup and inspect the scheduler | `P0.1 PostgreSQL-native backup and restore` |
| Backup job failed | Latest backup job failed | Check disk space and PostgreSQL backup tools | `P0.1 PostgreSQL-native backup and restore` |
| Background worker stopped | Worker heartbeat missing for four poll intervals | Restart API; contact support if repeated | `P2 Background Jobs And Retention` |
| Stock reconciliation missing, stale or failed | No successful run or older than `36` hours | Restart API or contact support | `P1.9 Materialize current stock balance` |
| Failed persistent jobs | Any failed job during the last seven days | Inspect job error and related service | `P2 Background Jobs And Retention` |
| CPU high | CPU usage at or above `85%`; critical at `95%` | Stop overlapping heavy reports/backups; investigate sustained load | `P2 Load Testing And Observability` |
| RAM low | Free RAM at or below `15%`; critical at `5%` | Close unnecessary server apps; upgrade RAM if sustained | `P2 Load Testing And Observability` |
| Partition review | Any tracked table reaches `10,000,000` estimated rows | Run readiness SQL on staging and schedule support review | `P1.7 Partition the largest append-only tables when needed` |
| Maintenance mode active | Restore or maintenance flag remains active | Verify restore completion and API state | `P0.1 Restore maintenance mode` |

Thresholds are configurable through `.env`: `DISK_WARNING_PERCENT`,
`BACKUP_MAX_AGE_HOURS`, `RECONCILIATION_MAX_AGE_HOURS`,
`CPU_WARNING_PERCENT`, `CPU_CRITICAL_PERCENT`,
`MEMORY_WARNING_FREE_PERCENT`, `MEMORY_CRITICAL_FREE_PERCENT`, and
`PARTITION_WARNING_ROWS`.

### Seed sizes

- [ ] 100,000 products only if the target business may need it; otherwise test at 20,000.
- [ ] 1,000,000 sales with multiple sale items.
- [ ] 5,000,000 journal lines.
- [ ] 5,000,000 stock movements.
- [ ] 1,000,000 money transactions.
- [ ] 100 GB upload directory simulation.

### Scenarios

- [ ] Ten simultaneous POS sales on the same product.
- [ ] Barcode scan while dashboard refreshes.
- [ ] Monthly report while POS continues posting.
- [ ] Backup while POS continues posting.
- [ ] Ledger first-page load for an account with millions of lines.
- [ ] Restore rehearsal on a separate server.
- [ ] Windows server restart and automatic API recovery.

### Targets

- [ ] POS barcode lookup P95 below 300 ms on LAN.
- [ ] POS sale posting P95 below 800 ms on LAN.
- [ ] Standard list first page P95 below 700 ms.
- [ ] Dashboard P95 below 1 second for cached response and below 3 seconds uncached.
- [ ] Error rate monitored and visible.
- [x] Server CPU usage and CPU saturation warnings visible to Admin.
- [x] Server free RAM and low-memory warnings visible to Admin.
- [x] Operational warnings identify the matching scalability checklist section.

## Suggested Delivery Order

### Phase A: Production protection

- PostgreSQL-native backup and restore
- Server-side pagination contract
- POS search endpoint
- Ledger aggregate opening balance plus pagination
- Slow-query monitoring and disk alerts

### Phase A Implementation Status - Completed 2026-06-01

- [x] Replaced in-memory JSON database snapshots with PostgreSQL custom-format `pg_dump`.
- [x] Added `pg_restore` restore with an automatic safety backup and HTTP write maintenance mode.
- [x] Kept uploads beside database dumps and documented the remaining incremental-file-backup improvement.
- [x] Moved manual backup creation to an API background job with status polling in Desktop UI.
- [x] Added PostgreSQL tool fallback through the included Docker container.
- [x] Added optional Redis cache-aside support with PostgreSQL fallback.
- [x] Added Redis Docker service with persisted volume and bounded LFU memory policy.
- [x] Added a dedicated cached `/api/products/pos-search` endpoint with strict limits.
- [x] Connected POS product search to the lightweight endpoint with debounce.
- [x] Added shared server-side pagination helper and pagination metadata for sales, purchases, returns, treasury, income/expenses, stock lots and movement reports.
- [x] Changed period account and party ledgers to SQL `SUM` opening/total aggregates and paginated rows.
- [x] Kept full ledger printing available by loading report pages only when print is requested.
- [x] Added compound and partial PostgreSQL indexes for the first high-traffic query shapes.
- [x] Added `pg_trgm` product search indexes.
- [x] Added `/health` database size, backup-disk free-space status and slow HTTP request logging.
- [x] Added `pg_stat_statements` enablement script and Windows backup-tool verification.

Remaining work belongs to Phase B and Phase C: SQL dashboard aggregation, stock-balance
projection, alert summaries, lightweight customer combobox, incremental uploads backup,
durable background jobs, async streamed exports and measured load testing.

### Phase B: Query performance

- Dashboard/report SQL aggregation
- Stock balance projection
- Alert summary redesign
- Compound and partial indexes
- Lightweight master-data endpoints

### Phase B Implementation Status - Completed 2026-06-01

- [x] Added transactional `StockBalance` projection with PostgreSQL trigger and current-data backfill.
- [x] Switched inventory summary, dashboard stock metrics, management low-stock report and stock alerts to the projection.
- [x] Added a nightly stock reconciliation scheduler plus `npm --workspace @supermarket/api run stock:reconcile`.
- [x] Replaced dashboard raw transaction loading with PostgreSQL `SUM`, `COUNT`, filtered aggregates and grouped chart queries.
- [x] Added 30-second Redis cache-aside for dashboard and alerts with write-triggered invalidation.
- [x] Replaced the primary management report with SQL aggregates, bounded recent rows and projection-backed low-stock rows.
- [x] Disabled the unbounded legacy management report route.
- [x] Added lightweight lookup endpoints for parties, units and product categories.
- [x] Connected POS customer lookup to the lightweight party endpoint.
- [x] Added remaining compound indexes for treasury account history, party ledgers and attachments.
- [x] Verified stock projection trigger behavior inside a rolled-back transaction.

Remaining scale work is Phase C: durable distributed background jobs, incremental or
deduplicated upload backups, streamed exports, retention jobs, load-test datasets,
measured query plans and partitioning only after production measurements justify it.

### Phase C: Long-term growth

- Background job runner
- Attachment streaming, thumbnails and incremental file backup
- Retention jobs
- Partitioning after measurement
- Load-test dataset and performance regression checks

### Phase C Implementation Status - Completed 2026-06-02

- [x] Added PostgreSQL-backed `PersistentJob` records and an API worker using
  `FOR UPDATE SKIP LOCKED`, retries and stale-lock recovery.
- [x] Moved manual and scheduled backup creation into the durable worker.
- [x] Moved nightly stock reconciliation into the durable worker.
- [x] Added scheduled retention cleanup for old audit logs, QR tokens, expired
  sessions, completed jobs and soft-deleted attachment files.
- [x] Changed upload snapshots to incremental filesystem backups: unchanged files
  use hard links where supported and fall back to copies across volumes.
- [x] Added streamed attachment downloads and generated WebP thumbnails for image
  uploads.
- [x] Added streamed CSV exports for ledger statements and stock balances, reading
  PostgreSQL in bounded batches. Very large exports can also run as persistent
  background jobs and produce retained downloadable files.
- [x] Added `npm --workspace @supermarket/api run db:metrics` for monthly table-size
  review and `scripts/postgres/partition-readiness.sql` for measured partition
  readiness checks.
- [x] Added `scripts/load-test/smoke-api.ps1` for release P50/P95 regression checks.
- [x] Added an Admin `System Health` page with automatic warnings for stale
  backups, low disk space, worker heartbeat, reconciliation, failed jobs and
  measured table growth.
- [x] Added Windows-compatible CPU sampling, RAM monitoring and a warning-to-
  checklist mapping in the Admin health page.
- [x] Added authenticated real-time CPU and RAM charts over the dedicated System
  Health WebSocket. Windows Firewall setup opens its LAN port with the API ports.
- [x] Added runtime server backup settings: Admin can change the backup path and
  retained-backup count without rebuilding or restarting the API. Desktop clients
  can set their store-server URL before login and change it later from Settings.
- [x] Documented the rule that partitioning starts only after production-like
  measurements justify it on a staging copy.

Actual table partitioning is intentionally not enabled on the small live database.
It adds migration and Prisma complexity without a measurable benefit at the current
size. Revisit it when the monthly readiness report shows tens of millions of rows,
expensive vacuum/index maintenance, or degraded query latency.

### Reporting And List Hardening Update - Completed 2026-06-02

- [x] Added period-aware server summaries for sales, purchases and
  income/expenses so metric cards no longer total only the visible page.
- [x] Added server pagination to sales, purchases, returns, treasury
  transactions, inventory movement tabs, currency-rate history, product
  management and party management.
- [x] Added a default recent range to growing transaction lists and exposed
  DatePicker controls where the operator needs to change that range.
- [x] Added paginated, period-filtered party transactions inside the
  customer/supplier detail dialog.
- [x] Removed historical-table scans from ordinary product and party list
  requests. Usage checks now use relational existence predicates.
- [x] Separated period-flow labels from current-balance labels in Dashboard,
  Reports, Cash/Bank and Accounting UI.
- [x] Applied the accounting journal period filter to both summary cards and
  server-paginated journal rows.
- [x] Excluded cancelled income/expense documents from profit/loss summaries
  while preserving reversal rows in cash-flow totals.
- [x] Removed fake product and purchase fallback rows from production UI.

### Remaining Scale Work After The 2026-06-02 Audit

- [x] Redesign `/api/alerts` to return exact SQL counts plus bounded alert
  items. It is cached, uses `StockBalance`, and no longer loads the full active
  product or credit-limited party catalog into Node.js.
- [x] Replace the management report's full party-account and candidate
  low-stock reads with bounded SQL result sets plus independent summary queries.
- [ ] Move remaining admin lists such as employees, users, payroll payments and
  attachment metadata to the shared pagination contract as their data grows.
- [ ] Finish cursor pagination for very large append-only histories. Current
  page pagination is bounded and functional, but deep offsets eventually slow
  down on multi-million-row tables.
- [ ] Add monthly account and party closing snapshots. Current ledger opening
  balances use SQL aggregates and are correct, but snapshots will reduce work
  further after years of history.
- [ ] Run the documented load tests, restore rehearsal and `EXPLAIN (ANALYZE,
  BUFFERS)` review on production-like data before claiming hundreds-of-GB
  readiness.

## Production Readiness Gate For Hundreds Of GB

The system should not be declared ready for hundreds of GB until:

- [x] No primary normal transaction-list request loads an unbounded history.
- [x] No backup loads the entire database or uploads directory into API memory.
- [x] Ledger opening balances use SQL aggregates or snapshots.
- [x] POS startup does not scan historical transaction tables.
- [x] Dashboard and primary management reports aggregate in SQL or summary tables.
- [x] Large exports run asynchronously and stream output.
- [ ] Restore has been rehearsed successfully.
- [x] Monitoring, disk alerts and slow-query logging are active.
