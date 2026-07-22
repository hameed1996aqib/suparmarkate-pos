import { isValidElement, useEffect, useState } from "react";
import { Eye, MoreHorizontal, Settings, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDropdownItem } from "@/components/ui/confirm-action";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DataRow } from "@/features/admin/types";

function displayValue(value: unknown) {
  if (isValidElement(value)) return value;
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "بلی" : "نخیر";
  if (typeof value === "number") return new Intl.NumberFormat("en-US").format(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function defaultBadgeClass(value: unknown) {
  const text = String(value || "");
  if (
    text.includes("مصرف") ||
    text.includes("باطل") ||
    text.includes("ابطال") ||
    text.includes("خارج") ||
    text.includes("ضرر") ||
    text.includes("زیر قیمت") ||
    text.includes("آمد بالاتر از فروش")
  ) {
    return "bg-destructive/15 text-destructive";
  }
  if (text.includes("عواید") || text.includes("وارد") || text.includes("فعال")) {
    return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
  }
  return "bg-primary/15 text-primary";
}

export function DenseTable({
  columns,
  rows,
  onEdit,
  onDelete,
  editLabel = "ویرایش",
  deleteLabel = "حذف",
  deleteTitle = "تایید حذف",
  deleteDescription = "آیا مطمئن هستید که این مورد حذف شود؟",
  pagination,
  onPageChange,
}: {
  columns: Array<{ key: string; label: string }>;
  rows: DataRow[];
  onEdit?: (row: DataRow) => void;
  onDelete?: (row: DataRow) => void;
  editLabel?: string;
  deleteLabel?: string;
  deleteTitle?: string;
  deleteDescription?: string;
  pagination?: { page: number; limit: number; total: number; totalPages: number };
  onPageChange?: (page: number) => void;
}) {
  const pageSize = 10;
  const [page, setPage] = useState(1);
  const [detailsRow, setDetailsRow] = useState<DataRow | null>(null);
  const isServerPaginated = Boolean(pagination && onPageChange);
  const totalPages = isServerPaginated
    ? pagination!.totalPages
    : Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const activePage = isServerPaginated ? pagination!.page : safePage;
  const pageRows = isServerPaginated
    ? rows
    : rows.slice((safePage - 1) * pageSize, safePage * pageSize);
  const totalRows = isServerPaginated ? pagination!.total : rows.length;
  const activeLimit = isServerPaginated ? pagination!.limit : pageSize;
  const canEditRow = (row: DataRow) => row.__canEdit !== false;
  const canDeleteRow = (row: DataRow) => row.__canDelete !== false;

  useEffect(() => {
    setPage(1);
  }, [rows]);

  return (
    <div className="space-y-3">
      <Table className="text-xs">
        <TableHeader>
          <TableRow className="border-border bg-muted/40 hover:bg-muted/40">
            {columns.map((column) => (
              <TableHead key={column.key}>{column.label}</TableHead>
            ))}
            <TableHead className="w-16 text-center">عملیات</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columns.length + 1}
                className="py-8 text-center text-muted-foreground"
              >
                موردی برای نمایش وجود ندارد
              </TableCell>
            </TableRow>
          ) : (
            pageRows.map((row, index) => (
              <TableRow key={String(row.id || index)} className="border-border">
                {columns.map((column) => {
                  const value = row[column.key];
                  return (
                    <TableCell key={column.key}>
                      {column.key === "status" || column.key === "type" ? (
                        isValidElement(value) ? (
                          value
                        ) : (
                          <Badge className={defaultBadgeClass(value)}>
                            {displayValue(value)}
                          </Badge>
                        )
                      ) : (
                        displayValue(value)
                      )}
                    </TableCell>
                  );
                })}
                <TableCell className="text-center">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon-sm" variant="outline" title="عملیات">
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" sideOffset={6} className="w-44" dir="rtl">
                      <DropdownMenuLabel>عملیات</DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => setDetailsRow(row)}>
                        <Eye className="size-4" />
                        <span>جزئیات</span>
                      </DropdownMenuItem>
                      {onEdit && canEditRow(row) && (
                        <DropdownMenuItem onClick={() => onEdit(row)}>
                          <Settings className="size-4" />
                          <span>{editLabel}</span>
                        </DropdownMenuItem>
                      )}
                      {onDelete && canDeleteRow(row) && (
                        <ConfirmDropdownItem
                          title={deleteTitle}
                          description={deleteDescription}
                          confirmLabel="تایید"
                          onConfirm={() => onDelete(row)}
                        >
                          <Trash2 className="size-4" />
                          <span>{deleteLabel}</span>
                        </ConfirmDropdownItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          نمایش {totalRows === 0 ? 0 : (activePage - 1) * activeLimit + 1} تا{" "}
          {Math.min(activePage * activeLimit, totalRows)} از {totalRows}
        </span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={activePage <= 1}
            onClick={() =>
              isServerPaginated
                ? onPageChange!(activePage - 1)
                : setPage((current) => Math.max(1, current - 1))
            }
          >
            قبلی
          </Button>
          <span>
            صفحه {activePage} / {totalPages}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={activePage >= totalPages}
            onClick={() =>
              isServerPaginated
                ? onPageChange!(activePage + 1)
                : setPage((current) => Math.min(totalPages, current + 1))
            }
          >
            بعدی
          </Button>
        </div>
      </div>

      <Dialog
        open={Boolean(detailsRow)}
        onOpenChange={(open) => {
          if (!open) setDetailsRow(null);
        }}
      >
        <DialogContent dir="rtl" className="max-w-[min(96vw,900px)]">
          <DialogHeader>
            <DialogTitle>جزئیات رکورد</DialogTitle>
            <DialogDescription>
              تمام معلومات ثبت‌شده این ردیف در همین مودال نمایش داده می‌شود.
            </DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[65vh] gap-3 overflow-y-auto pe-1 md:grid-cols-2">
            {Object.entries(detailsRow || {}).map(([key, value]) => (
              <div
                key={key}
                className="rounded-lg border border-border bg-background/70 p-3"
              >
                <p className="text-xs text-muted-foreground">{key}</p>
                <div className="mt-1 break-words text-sm">
                  {displayValue(value)}
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailsRow(null)}>
              بستن
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
