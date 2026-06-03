import { useState, type ComponentProps, type ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ConfirmProps = {
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
};

const defaultTitle = "تایید عملیات";
const defaultDescription = "آیا مطمئن هستید که این عملیات انجام شود؟";

function ConfirmDialog({
  open,
  onOpenChange,
  title = defaultTitle,
  description = defaultDescription,
  confirmLabel = "تایید",
  cancelLabel = "لغو",
  onConfirm,
}: ConfirmProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent dir="rtl">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ConfirmDropdownItem({
  children,
  title,
  description,
  confirmLabel = "حذف",
  cancelLabel,
  onConfirm,
}: ConfirmProps & {
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        className={cn(
          "relative flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-sm text-destructive outline-hidden select-none transition-colors",
          "hover:bg-destructive/10 focus:bg-destructive/10 dark:hover:bg-destructive/20 dark:focus:bg-destructive/20",
          "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg]:text-destructive",
        )}
      >
        {children}
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={description}
        confirmLabel={confirmLabel}
        cancelLabel={cancelLabel}
        onConfirm={onConfirm}
      />
    </>
  );
}

export function ConfirmButton({
  children,
  title,
  description,
  confirmLabel = "حذف",
  cancelLabel,
  onConfirm,
  ...buttonProps
}: ConfirmProps &
  Omit<ComponentProps<typeof Button>, "onClick"> & {
    children: ReactNode;
  }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button {...buttonProps} onClick={() => setOpen(true)}>
        {children}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={description}
        confirmLabel={confirmLabel}
        cancelLabel={cancelLabel}
        onConfirm={onConfirm}
      />
    </>
  );
}
