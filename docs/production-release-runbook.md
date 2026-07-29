# Muhaseb Production Release Runbook

## Safety Rules

- Never run migration, seed, restore, or repair against the customer database
  outside an approved maintenance window.
- Always test the exact release on a full copy of the customer database and
  uploads first.
- Migrations must be additive and compatible with the previous application
  version.
- Historical financial records are never repaired in bulk. An administrator
  must approve each document separately.
- Keep the previous server image, desktop installer, and mobile APK until the
  new phase completes a full business cycle.

## Local Quality Gate

```powershell
npm ci
npm run test:stack:up
$env:DATABASE_URL="postgresql://supermarket_test:supermarket_test@127.0.0.1:55432/supermarket_test"
npm run prisma:deploy
npm --workspace @supermarket/api run seed
npm run test:integration
npm run quality:gate
npm run test:electron
npm run test:stack:down
```

The Electron gate opens a real GUI process and must run in a normal Windows
session, not a restricted service session.

## Maintenance Window

1. Stop all writes and enable maintenance mode.
2. Create and verify a database and uploads backup.
3. Create the preflight report:

```powershell
npm run integrity:audit -- --label preflight --output ../../artifacts/release-gates/preflight.json
```

4. Install the server image and deploy additive migrations.
5. Run API smoke checks, then install Desktop/Web and Mobile artifacts from the
   same release tag.
6. Create the postflight report:

```powershell
npm run integrity:audit -- --label postflight --output ../../artifacts/release-gates/postflight.json
npm run integrity:compare -- --before ../../artifacts/release-gates/preflight.json --after ../../artifacts/release-gates/postflight.json
npm run release:manifest -- --phase PHASE_NAME --backup BACKUP_FILE
```

7. Reopen writes only when the comparison passes and all affected workflows
   have been tested manually.

## Rollback

- Roll back the application image and installers first.
- Do not downgrade the database schema.
- Restore the full backup only when the system has not reopened for writes, or
  when an actual data corruption incident has been confirmed.
