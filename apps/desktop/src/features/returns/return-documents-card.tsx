import { ChevronLeft, ChevronRight, RefreshCcw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";

type ReturnDocument = {
  id: string;
  number?: string | null;
  invoice?: string | null;
  party?: string | null;
  total?: number | string | null;
  settled?: number | string | null;
  createdAt?: string | null;
  cancelledAt?: string | null;
};

type Props = {
  title: string;
  description: string;
  rows: ReturnDocument[];
  onRefresh: () => void;
  onDetails: (row: ReturnDocument) => void;
  onCancel: (row: ReturnDocument) => void;
  pagination?: { page: number; total: number; totalPages: number };
  onPageChange?: (page: number) => void;
};

export function ReturnDocumentsCard({ title, description, rows, onRefresh, onDetails, onCancel, pagination, onPageChange }: Props) {
  return (
    <Card className="border-border bg-card">
      <CardHeader className="gap-3 lg:grid-cols-[1fr_auto]">
        <div>
          <CardTitle className="flex items-center gap-2"><RotateCcw className="size-5 text-primary" />{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <Button variant="outline" onClick={onRefresh}><RefreshCcw className="size-4" />تازه‌سازی</Button>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>شماره</TableHead><TableHead>فاکتور</TableHead><TableHead>طرف معامله</TableHead>
              <TableHead>مجموع</TableHead><TableHead>تسویه</TableHead><TableHead>وضعیت</TableHead><TableHead>عملیات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">سندی ثبت نشده است</TableCell></TableRow>
            ) : rows.map((row) => (
              <TableRow key={row.id} className={row.cancelledAt ? "opacity-60" : ""}>
                <TableCell>{row.number || "-"}</TableCell><TableCell>{row.invoice || "-"}</TableCell>
                <TableCell>{row.party || "-"}</TableCell><TableCell>{String(row.total ?? "-")}</TableCell>
                <TableCell>{String(row.settled ?? "-")}</TableCell>
                <TableCell><Badge variant={row.cancelledAt ? "destructive" : "secondary"}>{row.cancelledAt ? "ابطال" : "فعال"}</Badge></TableCell>
                <TableCell><div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => onDetails(row)}>جزئیات</Button>
                  {!row.cancelledAt ? <Button size="sm" variant="destructive" onClick={() => onCancel(row)}>ابطال</Button> : null}
                </div></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {pagination && onPageChange ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>صفحه {pagination.page} از {pagination.totalPages} ({pagination.total} سند)</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={pagination.page <= 1} onClick={() => onPageChange(pagination.page - 1)}>
                <ChevronRight className="size-4" />
                قبلی
              </Button>
              <Button size="sm" variant="outline" disabled={pagination.page >= pagination.totalPages} onClick={() => onPageChange(pagination.page + 1)}>
                بعدی
                <ChevronLeft className="size-4" />
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
