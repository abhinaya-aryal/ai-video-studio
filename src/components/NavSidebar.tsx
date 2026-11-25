"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clapperboard, Film, FolderKanban, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Projects", icon: FolderKanban },
  { href: "/quick-clip", label: "Quick Clip", icon: Clapperboard },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function NavSidebar() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/") {
      return pathname === "/" || pathname.startsWith("/projects/");
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:w-60 md:shrink-0 md:flex-col border-r border-border bg-card/50">
        <div className="flex h-14 items-center gap-2.5 border-b border-border px-4">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Film className="size-4" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold tracking-tight">
              AI Video Studio
            </span>
            <span className="text-[11px] text-muted-foreground">
              Local-First Wan &amp; Qwen
            </span>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-1 p-3" aria-label="Main">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary/15 text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border p-3 text-xs text-muted-foreground">
          <p>Local SQLite + Disk Storage</p>
          <p className="mt-0.5 text-[11px] opacity-80">
            Keys read from .env.local
          </p>
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
