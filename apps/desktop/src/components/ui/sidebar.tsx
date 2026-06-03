import * as React from "react";

import { cn } from "@/lib/utils";

function Sidebar({ className, ...props }: React.ComponentProps<"aside">) {
  return (
    <aside
      data-slot="sidebar"
      className={cn(
        "flex h-[calc(100vh-2rem)] w-full flex-col rounded-xl border border-sidebar-border bg-sidebar/95 text-sidebar-foreground shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-header"
      className={cn("border-b border-sidebar-border p-3", className)}
      {...props}
    />
  );
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-content"
      className={cn("min-h-0 flex-1 overflow-y-auto px-3 py-4", className)}
      {...props}
    />
  );
}

function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-footer"
      className={cn("border-t border-sidebar-border p-3", className)}
      {...props}
    />
  );
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"nav">) {
  return (
    <nav
      data-slot="sidebar-menu"
      className={cn("grid gap-1.5", className)}
      {...props}
    />
  );
}

function SidebarMenuButton({
  className,
  isActive,
  ...props
}: React.ComponentProps<"div"> & { isActive?: boolean }) {
  return (
    <div
      data-slot="sidebar-menu-button"
      data-active={isActive ? "true" : "false"}
      className={cn(
        "flex items-center justify-start gap-3 rounded-lg border border-transparent border-s-2 px-3 py-2 text-sm font-medium text-sidebar-foreground/70 transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[active=true]:border-sidebar-primary/35 data-[active=true]:border-s-sidebar-primary data-[active=true]:border-s-4 data-[active=true]:bg-sidebar-primary/15 data-[active=true]:text-sidebar-primary [&_svg]:size-6",
        className,
      )}
      {...props}
    />
  );
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
};
