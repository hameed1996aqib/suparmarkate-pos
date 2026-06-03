import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  DatabaseBackup,
  HardDrive,
  HeartPulse,
  MemoryStick,
  RefreshCcw,
  ServerCog,
  Cpu,
} from "lucide-react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MetricCard } from "@/features/admin/components/metric-card";
import {
  API_BASE_URL,
  getSystemHealthWebSocketUrl,
} from "@/lib/api-config";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

type Severity = "critical" | "warning" | "info";

type HealthIssue = {
  id: string;
  severity: Severity;
  title: string;
  description: string;
  action: string;
  checklist: string;
};

type HealthData = {
  status: "healthy" | "warning" | "critical";
  counts: { total: number; critical: number; warning: number; info: number };
  issues: HealthIssue[];
  disk: { path: string; totalBytes: number; freeBytes: number; freePercent: number; status: string };
  resources: {
    cpu: { cores: number; usedPercent: number; warningPercent: number; criticalPercent: number };
    memory: {
      totalBytes: number;
      freeBytes: number;
      usedBytes: number;
      freePercent: number;
      warningFreePercent: number;
      criticalFreePercent: number;
    };
    uptimeSeconds: number;
  };
  database: {
    connected: boolean;
    sizeBytes: number;
    tables: Array<{ name: string; rows: number; sizeBytes: number; partitionReviewRecommended: boolean }>;
  };
  backup: {
    count: number;
    lastSuccessfulAt: string | null;
    lastSuccessfulAgeHours: number | null;
  };
  worker: {
    enabled: boolean;
    running: boolean;
    busy: boolean;
    startedAt: string | null;
    lastPollAt: string | null;
  };
  jobs: {
    pending: number;
    failed: Array<{ id: string; type: string; error?: string | null; completedAt?: string | null }>;
  };
  reconciliation?: { status: string; completedAt?: string | null; error?: string | null; result?: unknown } | null;
  retention?: { status: string; completedAt?: string | null; error?: string | null } | null;
  checkedAt: string;
};

type ResourceSnapshot = HealthData["resources"];

type ResourceSample = {
  time: string;
  cpu: number;
  memory: number;
};

const resourceChartConfig = {
  cpu: { label: "CPU", color: "var(--chart-1)" },
  memory: { label: "RAM", color: "var(--chart-3)" },
} satisfies ChartConfig;

function bytes(value: number) {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(2)} MB`;
  return `${(value / 1024).toFixed(1)} KB`;
}

function dateTime(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("fa-AF", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function severityLabel(severity: Severity) {
  if (severity === "critical") return "بحرانی";
  if (severity === "warning") return "هشدار";
  return "معلومات";
}

function severityClass(severity: Severity) {
  if (severity === "critical") return "border-destructive/30 bg-destructive/10 text-destructive";
  if (severity === "warning") return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300";
}

export function SystemHealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [resourceSamples, setResourceSamples] = useState<ResourceSample[]>([]);
  const [socketStatus, setSocketStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");

  async function loadHealth() {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/system-health`);
      const json = await response.json().catch(() => null);
      if (!response.ok) throw new Error(json?.message || "خواندن سلامت سیستم ناکام شد");
      setData(json.data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "خواندن سلامت سیستم ناکام شد");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadHealth();
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("belal_auth_token");
    if (!token) {
      setSocketStatus("disconnected");
      return;
    }
    let retryTimer: number | null = null;
    let stopped = false;
    let socket: WebSocket | null = null;

    const connect = () => {
      if (stopped) return;
      setSocketStatus("connecting");
      socket = new WebSocket(getSystemHealthWebSocketUrl(token));
      socket.onopen = () => setSocketStatus("connected");
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data));
          if (message.type !== "RESOURCE_SNAPSHOT") return;
          const snapshot = message.payload as ResourceSnapshot;
          setData((current) => (current ? { ...current, resources: snapshot } : current));
          setResourceSamples((current) => [
            ...current.slice(-59),
            {
              time: new Date(message.time).toLocaleTimeString("fa-AF", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              }),
              cpu: snapshot.cpu.usedPercent,
              memory: Math.round((100 - snapshot.memory.freePercent) * 100) / 100,
            },
          ]);
        } catch {
          setSocketStatus("disconnected");
        }
      };
      socket.onclose = () => {
        if (stopped) return;
        setSocketStatus("disconnected");
        retryTimer = window.setTimeout(connect, 3000);
      };
      socket.onerror = () => socket?.close();
    };

    connect();
    return () => {
      stopped = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      socket?.close();
    };
  }, []);

  const healthy = data?.status === "healthy";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <HeartPulse className="size-6 text-primary" />
            سلامت سیستم
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            وضعیت بکاپ، دیسک، دیتابیس و سرویس‌های خودکار فروشگاه
          </p>
        </div>
        <Button variant="outline" onClick={loadHealth} disabled={isLoading}>
          <RefreshCcw className={isLoading ? "size-4 animate-spin" : "size-4"} />
          تازه‌سازی
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <MetricCard
          title="وضعیت عمومی"
          value={healthy ? "سالم" : data?.status === "critical" ? "نیاز به اقدام" : "نیاز به بررسی"}
          icon={healthy ? <CheckCircle2 /> : <AlertTriangle />}
          trend={`${data?.counts.total || 0} مورد قابل توجه`}
        />
        <MetricCard
          title="آخرین بکاپ"
          value={data?.backup.lastSuccessfulAgeHours == null ? "-" : `${data.backup.lastSuccessfulAgeHours} ساعت قبل`}
          icon={<DatabaseBackup />}
          trend={`${data?.backup.count || 0} نسخه موجود`}
        />
        <MetricCard
          title="فضای آزاد بکاپ"
          value={`${data?.disk.freePercent ?? 0}%`}
          icon={<HardDrive />}
          trend={data ? bytes(data.disk.freeBytes) : "-"}
        />
        <MetricCard
          title="حجم دیتابیس"
          value={data ? bytes(data.database.sizeBytes) : "-"}
          icon={<Database />}
          trend={data?.database.connected ? "اتصال دیتابیس برقرار است" : "اتصال دیتابیس قطع است"}
        />
        <MetricCard
          title="مصرف CPU"
          value={`${data?.resources.cpu.usedPercent ?? 0}%`}
          icon={<Cpu />}
          trend={`${data?.resources.cpu.cores ?? 0} هسته پردازشی`}
        />
        <MetricCard
          title="RAM آزاد"
          value={`${data?.resources.memory.freePercent ?? 0}%`}
          icon={<MemoryStick />}
          trend={data ? `${bytes(data.resources.memory.freeBytes)} از ${bytes(data.resources.memory.totalBytes)}` : "-"}
        />
      </div>

      <Card className="border-border bg-card">
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>مصرف لحظه‌ای منابع سرور</CardTitle>
            <CardDescription>CPU و RAM در دو دقیقه اخیر از طریق WebSocket</CardDescription>
          </div>
          <Badge
            variant="outline"
            className={
              socketStatus === "connected"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
            }
          >
            {socketStatus === "connected" ? "WebSocket وصل است" : socketStatus === "connecting" ? "در حال اتصال..." : "اتصال قطع است"}
          </Badge>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 xl:grid-cols-2">
            <ResourceChart title="مصرف CPU" data={resourceSamples} dataKey="cpu" color="var(--chart-1)" />
            <ResourceChart title="مصرف RAM" data={resourceSamples} dataKey="memory" color="var(--chart-3)" />
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle>اقدام‌های لازم</CardTitle>
          <CardDescription>موارد بحرانی را پیش از ادامه کار بررسی کنید.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table className="text-xs">
            <TableHeader>
              <TableRow className="border-border bg-muted/40 hover:bg-muted/40">
                <TableHead>وضعیت</TableHead>
                <TableHead>موضوع</TableHead>
                <TableHead>شرح</TableHead>
                <TableHead>اقدام پیشنهادی</TableHead>
                <TableHead>بخش چک‌لیست اسکیل</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    در حال بررسی سیستم...
                  </TableCell>
                </TableRow>
              ) : !data?.issues.length ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    <CheckCircle2 className="mx-auto mb-2 size-6 text-emerald-500" />
                    سیستم سالم است و اقدام فوری لازم نیست.
                  </TableCell>
                </TableRow>
              ) : (
                data.issues.map((issue) => (
                  <TableRow key={issue.id} className="border-border">
                    <TableCell>
                      <Badge variant="outline" className={severityClass(issue.severity)}>
                        {severityLabel(issue.severity)}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">{issue.title}</TableCell>
                    <TableCell className="max-w-80 text-muted-foreground">{issue.description}</TableCell>
                    <TableCell className="max-w-80">{issue.action}</TableCell>
                    <TableCell className="max-w-72 font-mono text-[11px] text-muted-foreground">
                      {issue.checklist}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ServerCog className="size-5 text-primary" />
              سرویس‌های خودکار
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
            <StatusItem label="worker پس‌زمینه" ok={Boolean(data?.worker.running)} value={data?.worker.busy ? "در حال اجرا" : "فعال"} />
            <StatusItem label="آخرین بررسی worker" ok={Boolean(data?.worker.lastPollAt)} value={dateTime(data?.worker.lastPollAt)} />
            <StatusItem label="آخرین reconciliation موجودی" ok={data?.reconciliation?.status === "COMPLETED"} value={dateTime(data?.reconciliation?.completedAt)} />
            <StatusItem label="آخرین پاک‌سازی دوره‌ای" ok={data?.retention?.status === "COMPLETED"} value={dateTime(data?.retention?.completedAt)} />
            <StatusItem label="jobهای در انتظار" ok={(data?.jobs.pending || 0) === 0} value={String(data?.jobs.pending || 0)} />
            <StatusItem label="jobهای ناکام هفته اخیر" ok={(data?.jobs.failed.length || 0) === 0} value={String(data?.jobs.failed.length || 0)} />
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle>بزرگ‌ترین جدول‌های دیتابیس</CardTitle>
            <CardDescription>برای سرویس دوره‌ای و رشد طولانی‌مدت سیستم</CardDescription>
          </CardHeader>
          <CardContent>
            <Table className="text-xs">
              <TableHeader>
                <TableRow className="border-border bg-muted/40 hover:bg-muted/40">
                  <TableHead>جدول</TableHead>
                  <TableHead>رکورد تقریبی</TableHead>
                  <TableHead>حجم</TableHead>
                  <TableHead>بررسی فنی</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.database.tables || []).map((table) => (
                  <TableRow key={table.name} className="border-border">
                    <TableCell className="font-mono text-[11px]">{table.name}</TableCell>
                    <TableCell>{new Intl.NumberFormat("en-US").format(table.rows)}</TableCell>
                    <TableCell>{bytes(table.sizeBytes)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={table.partitionReviewRecommended ? severityClass("info") : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"}>
                        {table.partitionReviewRecommended ? "نیاز به بررسی" : "عادی"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ResourceChart({
  title,
  data,
  dataKey,
  color,
}: {
  title: string;
  data: ResourceSample[];
  dataKey: "cpu" | "memory";
  color: string;
}) {
  return (
    <div className="border border-border bg-background/40 p-3">
      <p className="mb-3 text-sm font-medium">{title}</p>
      <ChartContainer config={resourceChartConfig} className="h-56 w-full">
        <AreaChart data={data}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="time" tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis domain={[0, 100]} tickLine={false} axisLine={false} width={34} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Area
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            fill={color}
            fillOpacity={0.18}
            strokeWidth={2}
            isAnimationActive={false}
          />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}

function StatusItem({ label, ok, value }: { label: string; ok: boolean; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border border-border bg-background/40 p-3">
      <div>
        <p className="font-medium">{label}</p>
        <p className="mt-1 text-xs text-muted-foreground">{value}</p>
      </div>
      <Badge variant="outline" className={ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : severityClass("warning")}>
        {ok ? "سالم" : "بررسی"}
      </Badge>
    </div>
  );
}
