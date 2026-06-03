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

For monthly database growth review, run:

```powershell
npm --workspace @supermarket/api run db:metrics
psql $env:DATABASE_URL -f scripts/postgres/partition-readiness.sql
```

Do not partition tables solely because they are listed as candidates. Start a
partition migration only when row count, index maintenance or measured latency
justifies it on a staging copy of production data.
