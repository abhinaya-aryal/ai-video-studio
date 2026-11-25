"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clapperboard, Film, FolderKanban, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const WORKSPACE_ITEMS = [
  { href: "/", label: "Projects", icon: FolderKanban },
  { href: "/quick-clip", label: "Quick Clip", icon: Clapperboard },
] as const;

const SYSTEM_ITEMS = [
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

const NAV_ITEMS = [...WORKSPACE_ITEMS, ...SYSTEM_ITEMS];

export function NavSidebar() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/") {
      return pathname === "/" || pathname.startsWith("/projects/");
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const renderNavLink = ({
    href,
    label,
    icon: Icon,
  }: (typeof NAV_ITEMS)[number]) => {
    const active = isActive(href);
    return (
      <Link
        key={href}
        href={href}
        className={cn(
          "relative flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active
            ? "bg-surface-2 text-foreground shadow-[inset_0_1px_0_#ffffff0a,0_8px_20px_-14px_var(--glow-1)]"
            : "text-muted-foreground hover:bg-surface-2/60 hover:text-foreground",
        )}
      >
        {active && (
          <span
            aria-hidden="true"
            className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-primary shadow-[0_0_10px_var(--primary)]"
          />
        )}
        <Icon
          className={cn(
            "size-4 shrink-0",
            active ? "text-primary" : "text-muted-foreground",
          )}
        />
        <span className="truncate">{label}</span>
      </Link>
    );
  };

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:w-[272px] md:shrink-0 md:flex-col border-r border-border bg-sidebar/90 bg-[radial-gradient(120%_45%_at_0%_0%,var(--glow-1),transparent_70%)] backdrop-blur">
        <div className="flex items-center gap-3 border-b border-border px-5 py-5">
          <div className="flow-icon flex size-9 shrink-0 items-center justify-center rounded-xl">
            <Film className="size-4" />
          </div>
          <div className="min-w-0 flex flex-col">
            <span className="truncate text-sm font-semibold tracking-tight text-foreground">
              AI Video Studio
            </span>
            <span className="text-[11px] font-medium text-subtle-foreground">
              Local-first
            </span>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-6 px-3.5 py-5" aria-label="Main">
          <div className="space-y-1.5">
            <div className="px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-subtle-foreground">
              Workspace
            </div>
            <div className="space-y-1">
              {WORKSPACE_ITEMS.map(renderNavLink)}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-subtle-foreground">
              System
            </div>
            <div className="space-y-1">
              {SYSTEM_ITEMS.map(renderNavLink)}
            </div>
          </div>
        </nav>

        <div className="p-3.5">
          <div className="panel px-3.5 py-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Local SQLite + Disk</p>
            <p className="mt-0.5 text-[11px] text-subtle-foreground">
              Keys from .env.local
            </p>
          </div>
        </div>
      </aside>

      {/* Mobile top navigation */}
      <header className="flex items-center justify-between border-b border-border bg-card/50 px-4 py-2.5 md:hidden">
        <Link href="/" className="flex items-center gap-2 font-semibold text-sm">
          <Film className="size-4 text-primary" />
          <span>AI Video Studio</span>
        </Link>
        <nav className="flex items-center gap-1" aria-label="Mobile">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? "bg-primary/15 text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
      </header>
    </>
  );
}
