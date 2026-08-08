# API Smoke Load Test

Use a copy of the production database or a sanitized staging database. Do not
generate fake rows inside the live store database.

Start the API, create an Admin session, then run:

```powershell
.\scripts\load-test\smoke-api.ps1 `
  -BaseUrl "http://localhost:4000" `
  -Token "<JWT>" `
  -Requests 100
```

The script reports failures, P50, P95 and maximum response time for health,
dashboard, POS product search and alerts. Record the result after each release.

For concurrent read-heavy checks of dashboard, reports, ledger and product
search, use a copied or sanitized customer database:

```powershell
.\scripts\load-test\read-heavy-api.ps1 `
  -BaseUrl "http://localhost:4000" `
  -Token "<ADMIN_JWT>" `
  -RequestsPerPath 100 `
  -Concurrency 10
```

The script performs only GET requests and exits with code `1` if any request
fails. Keep its P50/P95 output with the release manifest.

For monthly database growth review, run:

```powershell
npm --workspace @supermarket/api run db:metrics
psql $env:DATABASE_URL -f scripts/postgres/partition-readiness.sql
psql $env:DATABASE_URL -f scripts/postgres/release-query-plans.sql `
  | Tee-Object -FilePath artifacts/release-query-plans.txt
```

`release-query-plans.sql` starts a read-only transaction and records actual
plans for exact barcode lookup, recent journals and recent sales. Run it only
on the copied customer database because `EXPLAIN ANALYZE` executes each query.

Do not partition tables solely because they are listed as candidates. Start a
partition migration only when row count, index maintenance or measured latency
justifies it on a staging copy of production data.
