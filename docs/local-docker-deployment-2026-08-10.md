# Muhaseb Local Docker Deployment Report

Date: 2026-08-10 (Asia/Kabul)

## Scope

- Source bundle: `D:\Muhaseb-Server-Docker\Muhaseb-Server-Docker\Muhaseb-Server-Docker`
- Active Compose project: `supermarket-pos`
- Customer database volume: `supermarket-pos_supermarket_postgres_data`
- Deployed API image: `sha256:08d81c2723f8e5731fd0c0b48230053c9a1a6ea16f4683b3ebb1ef31071ef02f`
- Rollback image tag: `muhaseb-api:rollback-pre-update-20260810-022950`

## Safety Actions

1. Inspected Compose labels, container mounts, image IDs and all Docker volumes before deployment.
2. Detected that the downloaded bundle and the active customer stack used different Compose project names. Deployment was redirected to the existing `supermarket-pos` project to preserve its database volume.
3. Created and validated a PostgreSQL custom-format backup with `pg_dump -Fc` and `pg_restore --list`.
4. Saved the previous Compose file, API data volume, uploads volume, local uploads and previous API image.
5. Restored the backup into an isolated staging PostgreSQL volume and tested the new image there before touching the active API container.
6. Replaced only the API container. PostgreSQL and Redis containers and the customer database volume were not recreated.
7. No `docker compose down -v`, database reset, destructive migration, restore into production, or automatic data repair was executed.

## Backup Evidence

- Folder: `D:\BelalBackups\pre-update-20260810-022950`
- Database dump: `customer-pre-update-20260810-022950.dump`
- Dump size: `22,819,754` bytes
- SHA-256: `3D922EBF60A60A744B020EE9BAAAAE0ECDFA5F274C9A547C87974338F3F9D09A`
- The backup was successfully restored into staging and read by the new application image.

## Important Commands Executed

```powershell
docker inspect muhaseb_postgres
docker inspect muhaseb_api
docker volume ls
docker exec muhaseb_postgres pg_dump -U supermarket -d supermarket_db -Fc -f /tmp/customer.dump
docker exec muhaseb_postgres pg_restore --list /tmp/customer.dump
docker cp muhaseb_postgres:/tmp/customer.dump D:\BelalBackups\pre-update-20260810-022950\customer-pre-update-20260810-022950.dump
docker tag <previous-image-id> muhaseb-api:rollback-pre-update-20260810-022950
docker load -i <downloaded-server-image-tar>
docker compose -f D:\supermarket-pos\docker-compose.yml -p supermarket-pos up -d --wait --no-build postgres redis api
docker exec muhaseb_api npm run prisma -- migrate status
docker compose -f D:\supermarket-pos\docker-compose.yml -p supermarket-pos ps
```

Additional commands created isolated staging network/volumes/containers, restored the validated dump, ran seed and integrity audits, tested authenticated API routes, and stopped only those temporary staging containers afterward. Their volumes were retained.

## Validation Results

- API: healthy
- PostgreSQL: healthy and connected
- Redis: healthy and connected
- Web root: HTTP 200
- CSS asset: HTTP 200, `114,895` bytes
- POS WebSocket `ws://127.0.0.1:4001`: open
- System-health WebSocket `ws://127.0.0.1:4002`: open
- Prisma: 35 migrations found; schema is up to date
- Staging smoke test: 120 requests, zero failures
- Exact barcode lookup tested successfully in staging
- Staging P95: health 15 ms, dashboard 23 ms, POS search 151 ms, alerts 282 ms
- No new application error pattern found in recent production API logs

## Data Preservation Proof

The read-only business fingerprint before and after deployment is identical:

`0bdefdf19102e34d47847e63f0e1be7cadd34d0d7b84b2f7a69fe41a31a64c5d`

Unchanged counts:

- Products: 7,247
- Stock lots: 11,658
- Stock movements: 79,192
- Sales: 27,683
- Sale returns: 357
- Purchases: 6
- Journal entries: 50,468

Unchanged totals:

- Stock quantity: 212,922.2461
- Stock value: 13,409,505.4662
- Journal debit: 18,781,026.0901
- Journal credit: 18,781,026.0901
- Completed sale total: 10,592,421.4669
- Completed purchase total: 910

## Pre-existing Data Issues

These existed before deployment and remained exactly unchanged:

- One negative stock lot for barcode `6915567202917`, caused by two near-identical `ADJUSTMENT_OUT` movements.
- 5,088 historical sales reported as missing COGS.
- 63 duplicate normalized barcode groups.
- 131 barcodes without normalized values.

Positive controls: zero unbalanced journals, zero negative StockBalance rows, zero StockBalance mismatches, one active AFN base currency, and zero duplicate journal sources.

## Remaining Gaps

- The read-heavy PowerShell 7 test was skipped because `pwsh` is not installed.
- A real reboot/power-loss startup test was not performed because it would interrupt this machine.
- Authenticated testing against the active customer database was intentionally not performed because it would require customer credentials or creating/modifying production records. The same image passed authenticated tests against the restored staging copy.
- The backup drive has only 5.95% free space (about 20.9 GB); health correctly reports a warning.

## Rollback

Use only if the new API exhibits a real regression. This changes the API image only and does not touch the database volume:

```powershell
docker tag muhaseb-api:rollback-pre-update-20260810-022950 muhaseb-api:local
docker compose -f D:\supermarket-pos\docker-compose.yml -p supermarket-pos up -d --force-recreate --no-build api
```

## Recommendations

1. Free space or move backups before free disk falls below 10%.
2. Review the one negative lot manually before any automated repair; keep the two adjustment movement IDs as audit evidence.
3. Review historical missing COGS and duplicate barcodes through Admin workflows, not bulk destructive SQL.
4. Perform one controlled login, product search, barcode scan and receipt preview without creating a transaction.
5. Schedule a reboot test during a maintenance window and verify all three containers return healthy automatically.
6. Keep the backup folder and rollback image until at least one complete business cycle succeeds.
7. Keep staging volumes until final customer acceptance, then remove them deliberately to recover disk space.
