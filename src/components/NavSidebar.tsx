"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BookOpen,
  Boxes,
  Clapperboard,
  FolderKanban,
  HelpCircle,
  Palette,
  Settings,
} from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { GuideDialog } from "@/components/GuideDialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const WORKSPACE_ITEMS = [
  { href: "/", label: "Projects", icon: FolderKanban },
  { href: "/quick-clip", label: "Quick Clip", icon: Clapperboard },
] as const;

const SETTINGS_ITEMS = [
  { href: "/settings/providers", label: "Provider Status", icon: Activity },
  { href: "/settings/models", label: "Models", icon: Boxes },
  { href: "/settings/presets", label: "Style Presets", icon: Palette },
] as const;

type NavItem =
  | (typeof WORKSPACE_ITEMS)[number]
  | (typeof SETTINGS_ITEMS)[number];

const MOBILE_ITEMS = [
  { href: "/", label: "Projects", icon: FolderKanban },
  { href: "/quick-clip", label: "Quick Clip", icon: Clapperboard },
  { href: "/settings/providers", label: "Settings", icon: Settings },
] as const;

export function NavSidebar() {
  const pathname = usePathname();
  const [guideOpen, setGuideOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== "?" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }
      event.preventDefault();
      setGuideOpen((open) => !open);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const isActive = (href: string) => {
    if (href === "/") {
      return pathname === "/" || pathname.startsWith("/projects/");
    }
    if (href === "/settings/providers" && pathname === "/settings") {
      return true;
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const renderNavLink = ({ href, label, icon: Icon }: NavItem) => {
    const active = isActive(href);
    return (
      <Link
        key={href}
        href={href}
        className={cn(
          "relative flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
      <aside className="hidden md:sticky md:top-0 md:flex md:h-screen md:w-[272px] md:shrink-0 md:flex-col md:overflow-y-auto border-r border-border bg-sidebar/90 bg-[radial-gradient(120%_45%_at_0%_0%,var(--glow-1),transparent_70%)] backdrop-blur">
        <div className="flex items-center gap-3 border-b border-border px-5 py-5">
          <div className="size-9 shrink-0 overflow-hidden rounded-lg shadow-[0_10px_26px_-12px_var(--primary)]">
            <BrandMark className="size-full" />
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
              Settings
            </div>
            <div className="space-y-1">
              {SETTINGS_ITEMS.map(renderNavLink)}
            </div>
          </div>
        </nav>

        <div className="mt-auto space-y-2 p-3.5">
          <Button
            type="button"
            variant="outline"
            className="w-full justify-between text-xs"
            aria-haspopup="dialog"
            onClick={() => setGuideOpen(true)}
          >
            <span className="flex items-center gap-2">
              <BookOpen className="size-4" aria-hidden="true" />
              How it works
            </span>
            <kbd className="rounded-sm border border-border-strong bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-subtle-foreground">
              ?
            </kbd>
          </Button>
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
          <BrandMark className="size-6 rounded-md" />
          <span>AI Video Studio</span>
        </Link>
        <nav className="flex items-center gap-1" aria-label="Mobile">
          {MOBILE_ITEMS.map(({ href, label, icon: Icon }) => {
            const active =
              href === "/settings/providers"
                ? pathname.startsWith("/settings")
                : isActive(href);
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
          <button
            type="button"
            aria-label="Open studio guide"
            aria-haspopup="dialog"
            onClick={() => setGuideOpen(true)}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <HelpCircle className="size-4" aria-hidden="true" />
          </button>
        </nav>
      </header>

      <GuideDialog open={guideOpen} onOpenChange={setGuideOpen} />
    </>
  );
}
