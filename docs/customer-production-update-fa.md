# راهنمای مرحله وار آپدیت پرودکشن Muhaseb

این راهنما برای آپدیت سرور، Desktop، Web و Mobile مشتری موجود است. هدف اصلی این است که دیتابیس، uploads، رمزها و Docker volumeهای مشتری بدون تغییر ناخواسته باقی بمانند.

## قواعد غیرقابل استثنا

- آپدیت را فقط در زمانی انجام دهید که هیچ کاربری فروش، خرید، پرداخت، حاضری یا عملیات گدام ثبت نمی‌کند.
- قبل از آپدیت، بک‌آپ کامل دیتابیس و uploads را بسازید و Restore Preview آن را تأیید کنید.
- فایل‌های Server، Windows Installer و APK باید از یک release tag باشند.
- فایل `.env` نصب فعلی و نام Docker volumeها باید حفظ شوند.
- هرگز دستورهای زیر را روی سیستم مشتری اجرا نکنید:

```powershell
docker compose down -v
docker volume prune
docker system prune --volumes
npm run prisma:migrate
prisma migrate reset
```

- `start-docker-server.ps1` migrationهای پرودکشن را داخل container و با `prisma migrate deploy` خودکار اجرا می‌کند؛ migration دستی لازم نیست.
- اگر یک مرحله شکست خورد، کاربران را دوباره وارد سیستم نکنید تا علت مشخص شود.

## اطلاعاتی که قبل از شروع نیاز دارید

- مسیر نصب فعلی Server، برای مثال:

```text
D:\Muhaseb-Server-Docker\Muhaseb-Server-Docker
```

- مسیر نسخه جدید استخراج‌شده Server.
- مسیر بک‌آپ روی دیسک دوم، برای مثال:

```text
E:\MuhasebBackups
```

- IP ثابت یا رزروشده سرور.
- Windows Installer و APK همان release tag.
- دسترسی Administrator ویندوز و حساب Admin برنامه.

در ادامه، PowerShell را با گزینه **Run as Administrator** باز کنید و متغیرها را مطابق سیستم مشتری تنظیم نمایید:

```powershell
$OldServerDir = "D:\Muhaseb-Server-Docker\Muhaseb-Server-Docker"
$NewServerDir = "D:\Muhaseb-Releases\vNEXT\Muhaseb-Server-Docker"
$BackupDir = "E:\MuhasebBackups"
$LanIp = "192.168.1.10"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$GateDir = Join-Path $BackupDir "release-gates\$Stamp"
New-Item -ItemType Directory -Force -Path $GateDir | Out-Null
```

## مرحله ۱: تأیید وضعیت فعلی

به مسیر نصب فعلی بروید:

```powershell
Set-Location $OldServerDir
docker compose ps
docker inspect muhaseb_postgres --format '{{range .Mounts}}{{println .Name "->" .Destination}}{{end}}'
docker inspect muhaseb_api --format '{{.Config.Image}}'
```

انتظار می‌رود PostgreSQL، Redis و API در حالت `healthy` باشند. خروجی volumeها را ذخیره کنید:

```powershell
docker inspect muhaseb_postgres --format '{{range .Mounts}}{{println .Name "->" .Destination}}{{end}}' | Set-Content (Join-Path $GateDir "postgres-volumes-before.txt")
docker inspect muhaseb_api --format '{{range .Mounts}}{{println .Name "->" .Destination}}{{end}}' | Set-Content (Join-Path $GateDir "api-volumes-before.txt")
docker compose ps | Set-Content (Join-Path $GateDir "containers-before.txt")
```

اگر containerهای `muhaseb_postgres`، `muhaseb_redis` و `muhaseb_api` وجود ندارند، آپدیت را متوقف کنید؛ ممکن است در مسیر یا Docker context اشتباه باشید.

## مرحله ۲: حفظ تنظیمات و نسخه قبلی

فایل `.env` فعلی شامل رمزها و نام Compose project است. آن را امن نگهداری کنید:

```powershell
Copy-Item ".env" (Join-Path $GateDir "server.env.before") -Force
Copy-Item "docker-compose.yml" (Join-Path $GateDir "docker-compose.before.yml") -Force
docker image inspect muhaseb-api:local --format '{{.Id}}' | Set-Content (Join-Path $GateDir "api-image-before.txt")
docker image tag muhaseb-api:local "muhaseb-api:rollback-$Stamp"
```

فایل `server.env.before` دارای اطلاعات محرمانه است؛ آن را برای کسی ارسال نکنید.

نسخه قبلی Server ZIP، Windows Installer و APK را تا پایان یک چرخه کامل کاری حذف نکنید.

## مرحله ۳: توقف معاملات

1. به تمام کاربران اطلاع دهید از Desktop، Web و Mobile خارج شوند.
2. هیچ فروش، خرید، پرداخت، انتقال، افزایش/کاهش، برگشتی، معاش یا حاضری ثبت نشود.
3. ساعت شروع پنجره نگهداری را یادداشت کنید.
4. از Task Manager مطمئن شوید برنامه‌های Desktop صندوق‌ها بسته شده‌اند.

API در این مرحله برای ساخت بک‌آپ و Preflight روشن می‌ماند، اما کاربران نباید به آن درخواست نوشتنی ارسال کنند.

## مرحله ۴: ساخت و اعتبارسنجی بک‌آپ

با حساب Admin وارد صفحه **بکاپ** شوید:

1. گزینه ساخت بک‌آپ کامل را اجرا کنید.
2. صبر کنید وضعیت بک‌آپ موفق شود.
3. مطمئن شوید فایل dump، metadata و manifest/uploads در `$BackupDir` ایجاد شده‌اند.
4. روی همان بک‌آپ، **Restore Preview** را اجرا کنید؛ Restore واقعی را اجرا نکنید.
5. فقط وقتی checksum، PostgreSQL archive و manifest فایل‌ها معتبر بودند ادامه دهید.

فهرست فایل‌ها را ذخیره کنید:

```powershell
Get-ChildItem $BackupDir -File | Sort-Object LastWriteTime -Descending | Select-Object -First 20 Name,Length,LastWriteTime | Format-Table | Out-String | Set-Content (Join-Path $GateDir "backup-files.txt")
```

اگر بک‌آپ کامل یا Restore Preview موفق نشد، آپدیت ممنوع است.

## مرحله ۵: اجرای Preflight

Preflight فقط دیتای مشتری را می‌خواند و تغییر نمی‌دهد:

```powershell
docker exec muhaseb_api sh -lc "mkdir -p /data/backups/release-gates/$Stamp && npm run integrity:audit -- --label preflight-$Stamp --output /data/backups/release-gates/$Stamp/preflight.json"
```

فایل زیر باید ایجاد شود:

```text
E:\MuhasebBackups\release-gates\<Stamp>\preflight.json
```

اگر audit با exit code برابر `2` تمام شد، فایل اجرا شده ولی blocker پیدا کرده است. یافته‌ها را بررسی کنید. مشکلات تاریخی شناخته‌شده باید ثبت و تأیید شوند؛ مشکل جدید یا ناشناخته مانع آپدیت است.

## مرحله ۶: آماده‌کردن پوشه نسخه جدید

نسخه جدید Server را در یک پوشه جدا استخراج کنید؛ نسخه قبلی را overwrite نکنید. سپس تنظیمات فعلی را به نسخه جدید انتقال دهید:

```powershell
Copy-Item (Join-Path $OldServerDir ".env") (Join-Path $NewServerDir ".env") -Force
```

کنترل کنید فایل image جدید کنار `docker-compose.yml` موجود باشد:

```powershell
Test-Path (Join-Path $NewServerDir "muhaseb-api-local.tar")
Test-Path (Join-Path $NewServerDir "docker-compose.yml")
Test-Path (Join-Path $NewServerDir "scripts\windows\start-docker-server.ps1")
```

هر سه خروجی باید `True` باشند. مقدارهای حساس را نمایش ندهید، ولی وجود نام project و مسیر بک‌آپ را کنترل کنید:

```powershell
Select-String -Path (Join-Path $NewServerDir ".env") -Pattern '^COMPOSE_PROJECT_NAME=','^POSTGRES_USER=','^POSTGRES_DB=','^MUHASEB_BACKUP_DIR=','^MUHASEB_SERVER_LAN_IP='
```

## مرحله ۷: نصب Server جدید

به پوشه نسخه جدید بروید و اسکریپت را بدون `-ReuseImage` اجرا کنید تا image جدید load شود:

```powershell
Set-Location $NewServerDir
powershell -ExecutionPolicy Bypass -File .\scripts\windows\start-docker-server.ps1 `
  -ProjectDir $NewServerDir `
  -BackupDir $BackupDir `
  -LanIp $LanIp `
  -ConfirmStableIp `
  -ConfirmUps `
  -ConfirmSeparateBackupDisk
```

این اسکریپت:

- image جدید را از `muhaseb-api-local.tar` بارگذاری می‌کند؛
- PostgreSQL و Redis موجود را دوباره استفاده می‌کند؛
- رمز دیتابیس و API را هماهنگ می‌کند؛
- API را اجرا می‌کند؛
- migrationهای افزایشی را با `prisma migrate deploy` اجرا می‌کند؛
- seed پایه سازگار را اجرا می‌کند؛
- منتظر health کامل API و Redis می‌ماند.

در زمان اجرای migration برنامه را نبندید و Docker Desktop یا کمپیوتر را خاموش نکنید.

## مرحله ۸: کنترل container و volume بعد از آپدیت

```powershell
docker compose ps
docker compose logs --tail=150 api
docker inspect muhaseb_postgres --format '{{range .Mounts}}{{println .Name "->" .Destination}}{{end}}' | Set-Content (Join-Path $GateDir "postgres-volumes-after.txt")
docker inspect muhaseb_api --format '{{range .Mounts}}{{println .Name "->" .Destination}}{{end}}' | Set-Content (Join-Path $GateDir "api-volumes-after.txt")
Compare-Object (Get-Content (Join-Path $GateDir "postgres-volumes-before.txt")) (Get-Content (Join-Path $GateDir "postgres-volumes-after.txt"))
```

شرایط قبولی:

- هر سه سرویس `healthy` باشند.
- log شامل خطای migration، Prisma، اتصال دیتابیس یا restart loop نباشد.
- `Compare-Object` برای volume دیتابیس خروجی نداشته باشد.
- مقصد volume دیتابیس همچنان `/var/lib/postgresql/data` باشد.
- volume uploads و مسیر bind بک‌آپ تغییر ناخواسته نکرده باشند.

اگر volume دیتابیس قبل و بعد متفاوت بود، هیچ کاربری وارد سیستم نشود. API را متوقف و علت نام Compose project یا `.env` را بررسی کنید.

## مرحله ۹: Health و Smoke Test خواندنی

```powershell
$Health = Invoke-RestMethod -Uri "http://127.0.0.1:4000/health" -TimeoutSec 15
$Health | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $GateDir "health-after.json")
$Health.status
```

مقدار status باید `ok` و Redis باید connected باشد. سپس بدون ثبت معامله:

1. Web را با `http://<SERVER-IP>:4000` باز کنید.
2. با Admin وارد شوید.
3. صفحه سلامت سیستم را باز کنید.
4. محصولات را با نام و بارکد جست‌وجو کنید.
5. موجودی فعلی یک محصول شناخته‌شده را با مقدار قبل مقایسه کنید.
6. صندوق، بانک، مشتریان، تأمین‌کنندگان، گزارش و سابقه محصول را فقط مشاهده کنید.
7. هنوز فروش یا عملیات موجودی ثبت نکنید.

## مرحله ۱۰: اجرای Postflight و مقایسه

```powershell
docker exec muhaseb_api sh -lc "npm run integrity:audit -- --label postflight-$Stamp --output /data/backups/release-gates/$Stamp/postflight.json"

docker exec muhaseb_api sh -lc "npm run integrity:compare -- --before /data/backups/release-gates/$Stamp/preflight.json --after /data/backups/release-gates/$Stamp/postflight.json --output /data/backups/release-gates/$Stamp/comparison.json"
```

فایل زیر را باز کنید:

```powershell
Get-Content (Join-Path $GateDir "comparison.json") -Raw
```

شرایط قبولی:

- مقدار `passed` برابر `true` باشد.
- مشکل موجودی، ژورنال، COGS، بارکد یا snapshot جدیدی اضافه نشده باشد.
- تعداد و مجموع دیتای تجارتی بدون دلیل تغییر نکرده باشد.

مشکلات تاریخی که عیناً در Preflight و Postflight وجود دارند، باید جداگانه ثبت و بعداً با تأیید Admin اصلاح شوند؛ خود آپدیت نباید آن‌ها را بیشتر کند.

## مرحله ۱۱: نصب کلاینت‌های همان نسخه

1. Windows Installer همان release tag را روی تمام کمپیوترهای Desktop نصب کنید.
2. APK همان tag را روی تمام موبایل‌ها نصب کنید.
3. آدرس Server را روی IP ثابت مشتری بررسی کنید.
4. Web، Desktop و Mobile نباید از نسخه‌های release متفاوت استفاده کنند.
5. Installer و APK قبلی را برای Rollback نگه دارید.

## مرحله ۱۲: تست دستی عملیات

ابتدا با اسناد آزمایشی کوچک و قابل شناسایی تست کنید:

1. ورود Admin، فروشنده، مسئول گدام و HR.
2. جست‌وجوی دقیق بارکد در محصولات، POS، خرید و گدام.
3. یک فروش نقدی کوچک با `F9` و چاپ رسید.
4. یک فروش بدون چاپ با `F10` و کنترل عدم ثبت تکراری.
5. چاپ دوباره رسید و نمایش نوت/برگشتی.
6. افزایش، کاهش، ضایعات و انتقال یک محصول آزمایشی.
7. خرید، فروش، برگشتی و ابطال کنترل‌شده.
8. کنترل موجودی lot، StockBalance و سابقه محصول بعد از هر عملیات.
9. کنترل صندوق، بانک، حساب مشتری/تأمین‌کننده و ژورنال.
10. تست ارز پایه و یک ارز غیرپایه با نرخ فعال.
11. تست حاضری Mobile، اتصال POS Mobile و WebSocketها.
12. تست چاپ رسید POS و گزارش شیفت با پرنتر واقعی.
13. کنترل گزارش فروشنده، مفاد، COGS، داشبورد و گزارش‌ها.
14. کنترل permission نقش‌ها و عدم نیاز فروشنده به دسترسی حسابداری.

هر سند آزمایشی را با شماره سند ثبت کنید. اگر لازم است حذف شود، فقط از ابطال رسمی سیستم استفاده کنید؛ هیچ رکوردی را مستقیم از دیتابیس حذف نکنید.

## مرحله ۱۳: بازکردن سیستم و مانیتورینگ

سیستم را فقط بعد از موفقیت مراحل قبل برای کاربران باز کنید. در اولین چرخه کاری موارد زیر را زیر نظر بگیرید:

- خطاهای API و restart containerها؛
- سرعت جست‌وجوی بارکد و ثبت POS؛
- موجودی قبل و بعد فروش/برگشتی/انتقال؛
- فروش تکراری یا عملیات تکراری؛
- ژورنال و COGS فروش‌های جدید؛
- اتصال Redis و WebSocket؛
- اجرای بک‌آپ زمان‌بندی‌شده؛
- هشدارهای صفحه سلامت سیستم.

دستورهای مانیتورینگ:

```powershell
docker compose ps
docker compose logs --tail=200 api
docker stats --no-stream
```

پس از یک چرخه کامل کاری، یک audit جدید اجرا و نگهداری کنید:

```powershell
docker exec muhaseb_api sh -lc "npm run integrity:audit -- --label business-cycle-$Stamp --output /data/backups/release-gates/$Stamp/business-cycle.json"
```

## مرحله ۱۴: Rollback برنامه

اگر قبل از بازشدن سیستم خطای جدی دیده شد، ابتدا فقط برنامه را Rollback کنید؛ schema دیتابیس را downgrade نکنید:

```powershell
Set-Location $NewServerDir
docker compose stop api
docker image tag "muhaseb-api:rollback-$Stamp" muhaseb-api:local
docker compose up -d --wait --force-recreate api
docker compose ps
docker compose logs --tail=150 api
```

سپس Windows Installer و APK قبلی را برگردانید.

Restore کامل بک‌آپ فقط وقتی مجاز است که:

- سیستم بعد از آپدیت برای معامله باز نشده باشد؛ یا
- خرابی واقعی داده تأیید شده باشد؛ و
- safety backup و Restore Preview معتبر در دسترس باشند.

اگر بعد از آپدیت معامله واقعی ثبت شده باشد، Restore نسخه قبل می‌تواند معاملات جدید را حذف کند؛ بدون بررسی و تأیید مسئول سیستم Restore نکنید.

## چک‌لیست نهایی پذیرش

- [ ] بک‌آپ کامل و Restore Preview موفق است.
- [ ] Preflight ذخیره و بررسی شده است.
- [ ] `.env` و نام Compose project حفظ شده‌اند.
- [ ] volume دیتابیس قبل و بعد یکسان است.
- [ ] PostgreSQL، Redis و API در حالت healthy هستند.
- [ ] migration و seed بدون خطا اجرا شده‌اند.
- [ ] Postflight ساخته شده است.
- [ ] مقایسه Preflight/Postflight مقدار `passed: true` دارد.
- [ ] Desktop، Web و Mobile از یک release tag هستند.
- [ ] جست‌وجوی بارکد، POS، خرید و گدام تست شده‌اند.
- [ ] فروش، برگشتی، ابطال و عملیات موجودی آزمایش شده‌اند.
- [ ] صندوق، بانک، حساب طرف‌ها، ژورنال، COGS و مفاد درست‌اند.
- [ ] چاپ رسید و گزارش شیفت روی پرنتر واقعی درست است.
- [ ] roleها و permissionها تست شده‌اند.
- [ ] WebSocket، Redis و Mobile متصل‌اند.
- [ ] بک‌آپ زمان‌بندی‌شده پس از آپدیت اجرا می‌شود.
- [ ] image، installer، APK و بک‌آپ قبلی برای Rollback نگهداری شده‌اند.

تا زمانی که تمام موارد لازم این چک‌لیست تأیید نشده‌اند، نسخه جدید را آماده تحویل نهایی محسوب نکنید.
