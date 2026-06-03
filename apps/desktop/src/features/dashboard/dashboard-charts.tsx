import type { CSSProperties, ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import { ChartColumn, CircleDollarSign, TrendingUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

const number = new Intl.NumberFormat("fa-AF", { maximumFractionDigits: 0 });

function formatMoney(value: number, currencyCode: string) {
  return `${number.format(value || 0)} ${currencyCode}`;
}

function hasAmount(rows: Array<Record<string, unknown>>, keys: string[]) {
  return rows.some((row) => keys.some((key) => Number(row[key] || 0) > 0));
}

function EmptyChart({
  label = "داده‌ای برای نمایش وجود ندارد",
}: {
  label?: string;
}) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center">
      <div className="border border-border bg-background/95 px-4 py-3 text-center shadow-xl">
        <ChartColumn className="mx-auto mb-2 size-5 text-primary" />
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">
          بعد از ثبت معامله، چارت به صورت خودکار پر می‌شود.
        </p>
      </div>
    </div>
  );
}

function ChartBadge({ children }: { children: ReactNode }) {
  return (
    <Badge className="ms-2 gap-1 border-primary/25 bg-primary/10 text-primary">
      <TrendingUp className="size-3" />
      {children}
    </Badge>
  );
}

function ChartCard({
  title,
  description,
  badge,
  children,
}: {
  title: string;
  description: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="overflow-hidden border-border bg-card shadow-[0_18px_45px_rgba(0,0,0,0.14)]">
      <CardHeader className="border-b border-border/70 bg-muted/20">
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="grid size-9 place-items-center border border-primary/25 bg-primary/10 text-primary">
            <CircleDollarSign className="size-4" />
          </span>
          <span>{title}</span>
          {badge}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="p-4">{children}</CardContent>
    </Card>
  );
}

export function CashierSalesChart({
  rows,
  currencyCode,
}: {
  rows: Array<{ name: string; sales: number; invoices: number }>;
  currencyCode: string;
}) {
  const isEmpty = !hasAmount(rows as unknown as Array<Record<string, unknown>>, [
    "sales",
  ]);
  const data = (rows.length
    ? rows
    : [{ name: "بدون فروش", sales: 0, invoices: 0 }]
  ).map((item) => ({
    ...item,
    label: item.name.length > 12 ? `${item.name.slice(0, 12)}...` : item.name,
  }));

  const chartConfig = {
    sales: {
      label: "فروش",
      color: "var(--chart-1)",
    },
  } satisfies ChartConfig;

  return (
    <ChartCard
      title="فروش هر کارمند"
      description="میزان فروش ثبت‌شده توسط فروشنده‌ها در بازه انتخاب‌شده"
      badge={<ChartBadge>{number.format(rows.length)} نفر</ChartBadge>}
    >
      <div className="relative min-h-[310px] w-full min-w-0">
        {isEmpty ? <EmptyChart /> : null}
        <ChartContainer config={chartConfig} className="h-[310px] w-full">
          <BarChart
            accessibilityLayer
            data={data}
            margin={{ top: 20, right: 12, bottom: 12, left: 12 }}
          >
            <defs>
              <pattern
                id="cashier-sales-diagonal-stripe"
                patternUnits="userSpaceOnUse"
                width="8"
                height="8"
              >
                <rect
                  width="8"
                  height="8"
                  fill="var(--color-sales)"
                  opacity="0.1"
                />
                <path
                  d="M0,8 L8,0 M4,12 L12,4 M-4,4 L4,-4"
                  stroke="var(--color-sales)"
                  strokeWidth="1.5"
                  opacity="0.65"
                />
              </pattern>
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
            />
            <YAxis tickLine={false} axisLine={false} width={46} />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  indicator="dot"
                  className="min-w-44 gap-2.5"
                  labelFormatter={(_, payload) => (
                    <div className="mb-0.5 border-b border-border/50 pb-2">
                      <span className="text-xs font-medium">
                        {payload?.[0]?.payload?.name ?? "کارمند"}
                      </span>
                    </div>
                  )}
                  formatter={(value, name, item) => (
                    <div className="flex w-full items-center justify-between gap-3">
                      <div className="flex items-center gap-1.5">
                        <div
                          className="h-2.5 w-2.5 shrink-0 bg-(--color-bg)"
                          style={
                            {
                              "--color-bg": `var(--color-${name})`,
                            } as CSSProperties
                          }
                        />
                        <span className="text-muted-foreground">فروش</span>
                      </div>
                      <span className="font-semibold text-foreground">
                        {formatMoney(Number(value), currencyCode)}
                      </span>
                      <span className="text-muted-foreground">
                        {number.format(item.payload.invoices)} فاکتور
                      </span>
                    </div>
                  )}
                />
              }
            />
            <Bar
              dataKey="sales"
              fill="url(#cashier-sales-diagonal-stripe)"
              stroke="var(--color-sales)"
              strokeWidth={1}
            />
          </BarChart>
        </ChartContainer>
      </div>
    </ChartCard>
  );
}

export function SalesPurchasesChart({
  rows,
  currencyCode,
}: {
  rows: Array<{ label: string; sales: number; purchases: number }>;
  currencyCode: string;
}) {
  const isEmpty = !hasAmount(rows as unknown as Array<Record<string, unknown>>, [
    "sales",
    "purchases",
  ]);
  const data = rows.length ? rows : [{ label: "-", sales: 0, purchases: 0 }];

  const chartConfig = {
    sales: {
      label: "فروش",
      color: "var(--chart-1)",
    },
    purchases: {
      label: "خرید",
      color: "var(--chart-3)",
    },
  } satisfies ChartConfig;

  return (
    <ChartCard
      title="مقایسه خرید و فروش"
      description="فروش و خرید بر اساس مبلغ کرنسی پایه در بازه انتخاب‌شده"
      badge={<ChartBadge>روند واقعی</ChartBadge>}
    >
      <div className="relative min-h-[310px] w-full min-w-0">
        {isEmpty ? <EmptyChart /> : null}
        <ChartContainer config={chartConfig} className="h-[310px] w-full">
          <AreaChart
            accessibilityLayer
            data={data}
            margin={{ top: 20, right: 0, bottom: 0, left: 0 }}
          >
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  indicator="dot"
                  className="min-w-44 gap-2.5"
                  labelFormatter={(value) => (
                    <div className="mb-0.5 border-b border-border/50 pb-2">
                      <span className="text-xs font-medium">{value}</span>
                    </div>
                  )}
                  formatter={(value, name) => (
                    <div className="flex w-full items-center justify-between gap-3">
                      <div className="flex items-center gap-1.5">
                        <div
                          className="h-2.5 w-2.5 shrink-0 bg-(--color-bg)"
                          style={
                            {
                              "--color-bg": `var(--color-${name})`,
                            } as CSSProperties
                          }
                        />
                        <span className="text-muted-foreground">
                          {chartConfig[name as keyof typeof chartConfig]
                            ?.label || name}
                        </span>
                      </div>
                      <span className="font-semibold text-foreground">
                        {formatMoney(Number(value), currencyCode)}
                      </span>
                    </div>
                  )}
                />
              }
            />
            <defs>
              <pattern
                id="sales-area-crosshatch"
                width="8"
                height="8"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M0,8 L8,0"
                  stroke="var(--color-sales)"
                  strokeWidth="0.8"
                  opacity="0.45"
                />
                <path
                  d="M0,0 L8,8"
                  stroke="var(--color-sales)"
                  strokeWidth="0.8"
                  opacity="0.2"
                />
              </pattern>
              <pattern
                id="purchases-area-crosshatch"
                width="8"
                height="8"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M0,8 L8,0"
                  stroke="var(--color-purchases)"
                  strokeWidth="0.8"
                  opacity="0.45"
                />
                <path
                  d="M0,0 L8,8"
                  stroke="var(--color-purchases)"
                  strokeWidth="0.8"
                  opacity="0.2"
                />
              </pattern>
            </defs>
            <Area
              dataKey="purchases"
              type="natural"
              fill="url(#purchases-area-crosshatch)"
              fillOpacity={0.55}
              stroke="var(--color-purchases)"
              stackId="a"
              strokeWidth={1}
            />
            <Area
              dataKey="sales"
              type="natural"
              fill="url(#sales-area-crosshatch)"
              fillOpacity={0.55}
              stroke="var(--color-sales)"
              stackId="a"
              strokeWidth={1}
            />
          </AreaChart>
        </ChartContainer>
      </div>
    </ChartCard>
  );
}

export function CategorySalesChart({
  rows,
  currencyCode,
}: {
  rows: Array<{ name: string; sales: number }>;
  currencyCode: string;
}) {
  const isEmpty = !hasAmount(rows as unknown as Array<Record<string, unknown>>, [
    "sales",
  ]);
  const data = (rows.length
    ? rows.slice(0, 6)
    : [{ name: "بدون فروش", sales: 0 }]
  ).map((item, index) => ({
    ...item,
    source: `category${index + 1}`,
    color: `var(--chart-${(index % 5) + 1})`,
    fill: `var(--color-category${index + 1})`,
  }));
  const total = data.reduce((sum, item) => sum + item.sales, 0);
  const topCategory = data.reduce(
    (top, item) => (item.sales > top.sales ? item : top),
    data[0] || { name: "-", sales: 0 }
  );

  const chartConfig = data.reduce(
    (config, item, index) => ({
      ...config,
      [item.source]: {
        label: item.name,
        color: `var(--chart-${(index % 5) + 1})`,
      },
    }),
    {
      sales: { label: "فروش" },
    } as ChartConfig
  );

  return (
    <ChartCard
      title="فروش کتگوری‌ها"
      description="سهم هر کتگوری از فروش بازه انتخاب‌شده"
    >
      <div className="relative grid min-h-[330px] w-full min-w-0 gap-4 lg:grid-cols-[minmax(260px,0.95fr)_minmax(240px,1fr)]">
        {isEmpty ? <EmptyChart /> : null}
        <div className="relative flex min-w-0 items-center justify-center border border-border bg-muted/10 p-3">
          <ChartContainer config={chartConfig} className="h-[295px] w-full">
            <PieChart accessibilityLayer>
              <defs>
                <filter
                  id="category-sales-donut-shadow"
                  x="-20%"
                  y="-20%"
                  width="140%"
                  height="140%"
                >
                  <feDropShadow
                    dx="0"
                    dy="10"
                    stdDeviation="5"
                    floodOpacity="0.22"
                  />
                </filter>
                {data.map((entry, index) => (
                  <linearGradient
                    key={entry.source}
                    id={`gradient-${entry.source}`}
                    x1="0"
                    y1="0"
                    x2="1"
                    y2="1"
                  >
                    <stop
                      offset="0%"
                      stopColor={`var(--chart-${(index % 5) + 1})`}
                      stopOpacity={1}
                    />
                    <stop
                      offset="100%"
                      stopColor={`var(--chart-${(index % 5) + 1})`}
                      stopOpacity={0.58}
                    />
                  </linearGradient>
                ))}
              </defs>
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    className="min-w-44 gap-2.5"
                    formatter={(value, name) => (
                      <div className="flex w-full items-center justify-between gap-3">
                        <div className="flex items-center gap-1.5">
                          <div
                            className="h-2.5 w-2.5 shrink-0 bg-(--color-bg)"
                            style={
                              {
                                "--color-bg": `var(--color-${name})`,
                              } as CSSProperties
                            }
                          />
                          <span className="text-muted-foreground">
                            {chartConfig[name as keyof typeof chartConfig]
                              ?.label || name}
                          </span>
                        </div>
                        <span className="font-semibold text-foreground">
                          {formatMoney(Number(value), currencyCode)}
                        </span>
                      </div>
                    )}
                  />
                }
              />
              <Pie
                data={data}
                dataKey="sales"
                nameKey="source"
                cx="50%"
                cy="50%"
                innerRadius="62%"
                outerRadius="86%"
                paddingAngle={3}
                startAngle={90}
                endAngle={-270}
                stroke="var(--card)"
                strokeWidth={5}
                style={{ filter: "url(#category-sales-donut-shadow)" }}
              >
                {data.map((entry) => (
                  <Cell
                    key={entry.source}
                    fill={`url(#gradient-${entry.source})`}
                  />
                ))}
                <Label
                  content={({ viewBox }) => {
                    if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                      return (
                        <text
                          x={viewBox.cx}
                          y={viewBox.cy}
                          textAnchor="middle"
                          dominantBaseline="middle"
                        >
                          <tspan
                            x={viewBox.cx}
                            y={(viewBox.cy || 0) - 8}
                            className="fill-foreground text-2xl font-bold tabular-nums"
                          >
                            {number.format(total)}
                          </tspan>
                          <tspan
                            x={viewBox.cx}
                            y={(viewBox.cy || 0) + 18}
                            className="fill-muted-foreground text-xs"
                          >
                            مجموع فروش
                          </tspan>
                        </text>
                      );
                    }
                    return null;
                  }}
                />
              </Pie>
            </PieChart>
          </ChartContainer>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="border border-border bg-muted/10 p-4">
            <div className="text-xs text-muted-foreground">بیشترین سهم</div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-base font-semibold text-foreground">
                  {topCategory.name}
                </div>
                <div className="text-xs text-muted-foreground">
                  {total > 0
                    ? `${number.format((topCategory.sales / total) * 100)}٪ از فروش`
                    : "بدون فروش"}
                </div>
              </div>
              <div className="text-left text-sm font-bold text-primary">
                {formatMoney(topCategory.sales || 0, currencyCode)}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            {data.map((item) => {
              const percent = total > 0 ? (item.sales / total) * 100 : 0;

              return (
                <div
                  key={item.source}
                  className="border border-border bg-background/55 p-3"
                >
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="size-2.5 shrink-0"
                        style={{ backgroundColor: item.color }}
                      />
                      <span className="truncate text-sm font-medium text-foreground">
                        {item.name}
                      </span>
                    </div>
                    <span className="shrink-0 text-xs font-semibold text-muted-foreground">
                      {number.format(percent)}٪
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden bg-muted">
                    <div
                      className="h-full"
                      style={{
                        width: `${Math.min(100, percent)}%`,
                        backgroundColor: item.color,
                      }}
                    />
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {formatMoney(item.sales, currencyCode)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </ChartCard>
  );
}
