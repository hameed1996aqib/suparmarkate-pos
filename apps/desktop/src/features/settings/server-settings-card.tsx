import { useEffect, useState, type FormEvent } from "react";
import { DatabaseBackup, Network, RefreshCcw, Save, ServerCog, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  API_BASE_URL,
  saveApiBaseUrl,
  testApiBaseUrl,
} from "@/lib/api-config";

type ServerBackupSetting = {
  backupDir: string;
  backupRetentionCount: number;
};

export function ServerSettingsCard() {
  const [apiUrl, setApiUrl] = useState(API_BASE_URL);
  const [backup, setBackup] = useState<ServerBackupSetting | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isSavingBackup, setIsSavingBackup] = useState(false);
  const [isResetOpen, setIsResetOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirmation, setResetConfirmation] = useState("");

  async function loadBackupSettings() {
    const response = await fetch(`${API_BASE_URL}/api/settings/server`);
    const json = await response.json().catch(() => null);
    if (!response.ok) throw new Error(json?.message || "تنظیمات سرور خوانده نشد");
    setBackup(json.data);
  }

  useEffect(() => {
    void loadBackupSettings().catch((error) => {
      toast.error(error instanceof Error ? error.message : "تنظیمات سرور خوانده نشد");
    });
  }, []);

  async function testConnection() {
    setIsTesting(true);
    try {
      const normalized = await testApiBaseUrl(apiUrl);
      setApiUrl(normalized);
      toast.success("اتصال به سرور برقرار است");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "اتصال به سرور برقرار نشد");
    } finally {
      setIsTesting(false);
    }
  }

  async function saveConnection() {
    try {
      const normalized = await testApiBaseUrl(apiUrl);
      saveApiBaseUrl(normalized);
      toast.success("آدرس سرور ذخیره شد؛ برنامه دوباره بارگذاری می‌شود");
      window.setTimeout(() => window.location.reload(), 500);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ذخیره آدرس سرور ناکام شد");
    }
  }

  async function saveBackup(event: FormEvent) {
    event.preventDefault();
    if (!backup) return;
    setIsSavingBackup(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/settings/server`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(backup),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) throw new Error(json?.message || "ذخیره تنظیمات بکاپ ناکام شد");
      setBackup(json.data);
      toast.success("تنظیمات بکاپ ذخیره شد");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ذخیره تنظیمات بکاپ ناکام شد");
    } finally {
      setIsSavingBackup(false);
    }
  }

  async function resetSystem() {
    setIsResetting(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/settings/reset-system`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: resetPassword,
          confirmation: resetConfirmation,
        }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) throw new Error(json?.message || "ریست سیستم ناکام شد");

      toast.success("سیستم ریست شد؛ برای ورود دوباره آماده شوید");
      localStorage.removeItem("belal_auth_token");
      localStorage.removeItem("belal_auth_user");
      window.setTimeout(() => window.location.reload(), 900);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ریست سیستم ناکام شد");
    } finally {
      setIsResetting(false);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Network className="size-5 text-primary" />
            اتصال این کمپیوتر به سرور
          </CardTitle>
          <CardDescription>
            این آدرس فقط روی همین دستگاه ذخیره می‌شود و برای تغییر آن rebuild لازم نیست.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="grid gap-1.5 text-sm">
            <span className="text-muted-foreground">آدرس API سرور</span>
            <Input
              dir="ltr"
              placeholder="http://192.168.1.10:4000"
              value={apiUrl}
              onChange={(event) => setApiUrl(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
              سرور فعلی: {API_BASE_URL}
            </Badge>
            <Button type="button" variant="outline" onClick={testConnection} disabled={isTesting}>
              <RefreshCcw className={isTesting ? "size-4 animate-spin" : "size-4"} />
              تست اتصال
            </Button>
            <Button type="button" onClick={saveConnection}>
              <Save className="size-4" />
              ذخیره و بارگذاری دوباره
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DatabaseBackup className="size-5 text-primary" />
            نگهداری بکاپ روی سرور
          </CardTitle>
          <CardDescription>
            پیشنهاد مناسب برای یک فروشگاه نگهداری ۷ بکاپ آخر است. نسخه‌های قدیمی‌تر خودکار پاک می‌شوند.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveBackup} className="grid gap-3">
            <label className="grid gap-1.5 text-sm">
              <span className="text-muted-foreground">مسیر ذخیره بکاپ در کمپیوتر سرور</span>
              <Input
                dir="ltr"
                placeholder="D:\MuhasebBackups"
                value={backup?.backupDir || ""}
                onChange={(event) =>
                  setBackup((current) => ({
                    backupDir: event.target.value,
                    backupRetentionCount: current?.backupRetentionCount || 7,
                  }))
                }
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="text-muted-foreground">تعداد بکاپ‌های قابل نگهداری</span>
              <Input
                type="number"
                min="1"
                max="365"
                value={backup?.backupRetentionCount || 7}
                onChange={(event) =>
                  setBackup((current) => ({
                    backupDir: current?.backupDir || "",
                    backupRetentionCount: Number(event.target.value || 7),
                  }))
                }
              />
            </label>
            <div className="flex items-center justify-between gap-3">
              <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                مقدار پیشنهادی: ۷ نسخه
              </Badge>
              <Button type="submit" disabled={!backup || isSavingBackup}>
                <ServerCog className="size-4" />
                ذخیره تنظیمات سرور
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="border-destructive/40 bg-card xl:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="size-5" />
            ریست کامل سیستم
          </CardTitle>
          <CardDescription>
            تمام معاملات، اجناس، کارمندان، فایل‌های آپلود و تنظیمات شرکت پاک می‌شوند. قبل از ریست یک بکاپ ایمنی ساخته می‌شود و بکاپ‌های موجود باقی می‌مانند.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" variant="destructive" onClick={() => setIsResetOpen(true)}>
            <Trash2 className="size-4" />
            باز کردن تایید ریست
          </Button>
        </CardContent>
      </Card>

      <Dialog open={isResetOpen} onOpenChange={setIsResetOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-destructive">تایید ریست کامل سیستم</DialogTitle>
            <DialogDescription>
              این عملیات برگشت فوری ندارد. بکاپ ایمنی نگهداری می‌شود، اما برای استفاده دوباره باید restore انجام دهید.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <label className="grid gap-1.5 text-sm">
              <span className="text-muted-foreground">رمز عبور Admin</span>
              <Input
                type="password"
                value={resetPassword}
                onChange={(event) => setResetPassword(event.target.value)}
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="text-muted-foreground">
                برای تایید عبارت RESET MUHASEB را بنویسید
              </span>
              <Input
                dir="ltr"
                value={resetConfirmation}
                onChange={(event) => setResetConfirmation(event.target.value)}
              />
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsResetOpen(false)}>
              انصراف
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isResetting || resetConfirmation !== "RESET MUHASEB" || !resetPassword}
              onClick={resetSystem}
            >
              {isResetting ? "در حال ریست..." : "ریست کامل"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
