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
$env:BACKUP_DIR="$env:TEMP\muhaseb-backup-integration"
$env:UPLOAD_DIR="$env:TEMP\muhaseb-upload-integration"
$env:SERVER_CONFIG_PATH="$env:TEMP\muhaseb-server-config-test.json"
$env:RUN_BACKUP_INTEGRATION="true"
npm run prisma:deploy
npm --workspace @supermarket/api run seed
npm run test:integration
npm run quality:gate
Push-Location apps/mobile-scanner
npx expo export --platform android --output-dir ../../artifacts/mobile-export
Pop-Location
npm run test:electron
npm run test:stack:down
```

The Electron gate opens a real GUI process and must run in a normal Windows
session, not a restricted service session.

## Fresh Windows Server Installation

1. Install Docker Desktop and enable its start-at-login option.
2. Reserve the server IPv4 address in the router, or configure a static IP.
3. Put backups on a second physical disk and connect/test a UPS.
4. Run the installer from an elevated PowerShell window:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/windows/install-server.ps1 `
  -Mode Docker `
  -LanIp "192.168.1.10" `
  -BackupDir "E:\MuhasebBackups" `
  -ConfirmStableIp `
  -ConfirmUps `
  -ConfirmSeparateBackupDisk
```

The first installation creates random PostgreSQL, JWT, and initial Admin
credentials. The initial Admin password is displayed once. Store it securely,
log in, and change it immediately. The startup task is registered for Windows
startup and user logon, then reuses the installed image; it does not rebuild or
rotate credentials. The explicit `-LanIp` must be the address reserved for the
server and must already be assigned to one of its network adapters.

For an approved release update, place `muhaseb-api-local.tar` beside the
compose file and run `start-docker-server.ps1` without `-ReuseImage`. Existing
`.env` secrets are preserved. The scheduled startup task uses `-ReuseImage` so
rebooting never replaces the running release.

After installation, open System Health and confirm that PostgreSQL, Redis,
backup disk, stored/current server IP, DHCP reservation, and UPS are healthy.
Test one reboot and one controlled power-loss/UPS cycle before handover.

## Phase Six Security Rollout

Do not switch an existing customer directly from legacy clients to strict
enforcement. Use this sequence during the approved maintenance window:

1. Start the server with `PERMISSION_ENFORCEMENT_MODE=observe`,
   `ALLOW_LEGACY_PUBLIC_RECEIPTS=true`, and
   `ALLOW_LEGACY_PUBLIC_ATTENDANCE_SCAN=true`.
2. Deploy the server migration, then install the matching Desktop/Web and
   Mobile artifacts from the same release tag.
3. Confirm that every mobile login receives a device credential, attendance
   works through `/api/attendance/scan-auth`, and the Admin can see and revoke
   the device in Users & Roles.
4. Run a complete business cycle and review
   `PERMISSION_OBSERVE_VIOLATION` audit records. Fix every legitimate missing
   policy before enforcement.
5. Set both legacy flags to `false`, restart the API, and test signed receipt
   printing/reprinting and authenticated attendance on every client version.
6. Set `PERMISSION_ENFORCEMENT_MODE=enforce`, restart the API, and execute the
   role matrix below. System Health must no longer show the permission or
   legacy-access warnings.

Required role matrix:

- Cashier: POS sale with F9/F10, receipt print, product lookup; no accounting
  or user-management access.
- Inventory employee: inventory pages and alerts; no dashboard dependency.
- HR employee: employee, attendance, and payroll permissions exactly as
  assigned.
- Manager/Admin: users, mobile-device revocation, backup, restore preview,
  reports, and System Health.
- Direct URL/API attempts without the required permission must return 403 in
  enforce mode and must never mutate data.

Existing customer passwords are not changed automatically. Only newly created
users and accounts whose password is reset by an Admin receive
`mustChangePassword=true`. Mobile access tokens and device credentials are
stored in SecureStore; API address, user display data, and device ID are stored
in AsyncStorage.

If an unexpected permission denial appears after enforcement, return only
`PERMISSION_ENFORCEMENT_MODE` to `observe` while the policy is corrected. Do
not roll back or downgrade the additive database migration. Re-enable a legacy
flag only when a verified old client cannot be upgraded during the same window.

## Tagged Release Artifacts

Before pushing a production tag, configure these GitHub repository secrets:

- `WINDOWS_CSC_LINK`: base64 certificate or secure certificate URL supported
  by electron-builder.
- `WINDOWS_CSC_KEY_PASSWORD`: password of the Windows code-signing certificate.
- `EXPO_TOKEN`: Expo access token for the Muhaseb EAS project.

Push a semantic tag such as `v1.4.0`. The workflow then:

- runs migrations against an isolated PostgreSQL database, integration tests,
  integrity audit, permission enforcement tests, production dependency audit,
  Web smoke, Electron smoke, and Android Expo export;
- builds a signed, versioned Windows installer;
- builds and downloads an Android APK from EAS using the `preview` APK profile;
- builds the Docker server image and writes the same tag to
  `release-tag.txt` inside the server bundle.

Do not install artifacts from different tags together. Keep the previous tag's
server ZIP, installer, APK, release manifest, and verified backup until the new
release completes a full business cycle. Auto-update remains disabled until a
signed update feed and tested rollback channel are available; use manual,
versioned installers meanwhile.

## Phase Seven Performance Evidence

The integration suite includes ten distinct concurrent sales against the same
product, in addition to same-request retry/idempotency coverage. This test must
pass on the isolated CI PostgreSQL service before artifacts are built.

On the copied customer database, record read-heavy API latency and database
plans before installation:

```powershell
pwsh .\scripts\load-test\read-heavy-api.ps1 `
  -BaseUrl "http://localhost:4000" `
  -Token "<ADMIN_JWT>" `
  -RequestsPerPath 100 `
  -Concurrency 10

New-Item -ItemType Directory -Force artifacts | Out-Null
psql $env:DATABASE_URL -f scripts/postgres/release-query-plans.sql `
  | Tee-Object -FilePath artifacts/release-query-plans.txt
```

Review P95 latency and every `EXPLAIN (ANALYZE, BUFFERS)` result. A sequential
scan is not automatically a failure on a small table, but unexpected row scans,
sort spills, or material regression from the previous release block deployment
until the query/index is reviewed. These commands are read-only but still run
only on the customer copy, never during store operating hours.

## Backup Restore Guarantees

- Restore validates the PostgreSQL archive with `pg_restore --list`, verifies
  the dump checksum, and validates every uploaded file before maintenance
  starts.
- A safety backup with uploads is mandatory. Background jobs stop claiming new
  work, and the restore waits for the active job to finish.
- Uploads are copied to a staging directory and swapped atomically. A
  database-only or legacy backup never deletes current uploads.
- After restore, additive migrations and the compatible baseline seed run,
  caches are cleared, all sessions are revoked, and the integrity audit must
  pass.
- If restore, migration, seed, or integrity verification fails after database
  replacement, the safety backup is restored automatically. A critical error
  identifies the safety filename if automatic rollback also fails.

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
