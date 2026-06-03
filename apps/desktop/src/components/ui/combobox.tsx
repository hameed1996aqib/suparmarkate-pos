import { Check, ChevronsUpDown, Search } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type ComboboxOption = {
  value: string;
  label: string;
  description?: string | null;
  meta?: string | null;
};

type ComboboxProps = {
  options: ComboboxOption[];
  value?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  onSearchChange?: (value: string) => void;
  onValueChange: (value: string) => void;
  className?: string;
};

export function Combobox({
  options,
  value,
  placeholder = "انتخاب کنید",
  searchPlaceholder = "جستجو...",
  emptyText = "موردی پیدا نشد",
  onSearchChange,
  onValueChange,
  className,
}: ComboboxProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});

  const selected = options.find((option) => option.value === value) || null;
  const normalizedQuery = query.trim().toLowerCase();
  const filteredOptions = normalizedQuery
    ? options.filter((option) =>
        [option.label, option.description, option.meta]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery),
      )
    : options;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    if (!open) return;

    function updatePanelPosition() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;

      setPanelStyle({
        position: "fixed",
        top: rect.bottom + 6,
        left: rect.left,
        width: rect.width,
        zIndex: 1000,
      });
    }

    updatePanelPosition();
    window.addEventListener("scroll", updatePanelPosition, true);
    window.addEventListener("resize", updatePanelPosition);

    return () => {
      window.removeEventListener("scroll", updatePanelPosition, true);
      window.removeEventListener("resize", updatePanelPosition);
    };
  }, [open]);

  function updateQuery(nextQuery: string) {
    setQuery(nextQuery);
    onSearchChange?.(nextQuery);
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        className="h-10 w-full justify-between"
        onClick={() => setOpen((current) => !current)}
      >
        <span className={cn("truncate", !selected && "text-muted-foreground")}>
          {selected?.label || placeholder}
        </span>
        <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
      </Button>

      {open
        ? createPortal(
            <div
              ref={panelRef}
              style={panelStyle}
              className="rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-lg"
              dir="rtl"
            >
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => updateQuery(event.target.value)}
              placeholder={searchPlaceholder}
              className="h-9 ps-9"
            />
          </div>

          <div className="max-h-64 overflow-auto">
            {filteredOptions.length ? (
              filteredOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-start text-sm hover:bg-secondary"
                  onClick={() => {
                    onValueChange(option.value);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {option.label}
                    </span>
                    {option.description ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {option.description}
                      </span>
                    ) : null}
                  </span>

                  <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    {option.meta ? <span>{option.meta}</span> : null}
                    <Check
                      className={cn(
                        "h-4 w-4",
                        option.value === value ? "opacity-100" : "opacity-0",
                      )}
                    />
                  </span>
                </button>
              ))
            ) : (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                {emptyText}
              </div>
            )}
          </div>
        </div>,
            document.body,
          )
        : null}
    </div>
  );
}
