"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
} from "lucide-react";
import { GUIDE_STEPS } from "@/lib/guide";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface GuideDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GuideDialog({ open, onOpenChange }: GuideDialogProps) {
  const [index, setIndex] = useState(0);

  const step = GUIDE_STEPS[index];
  const isFirst = index === 0;
  const isLast = index === GUIDE_STEPS.length - 1;

  const handleOpenChange = (next: boolean) => {
    if (!next) setIndex(0);
    onOpenChange(next);
  };

  const goTo = (next: number) => {
    setIndex(Math.min(Math.max(next, 0), GUIDE_STEPS.length - 1));
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="h-[90dvh] w-[80vw] max-h-[90dvh] max-w-[80vw] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:w-[80vw] sm:max-w-[80vw]"
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") {
            event.preventDefault();
            goTo(index + 1);
          } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            goTo(index - 1);
          }
        }}
      >
        <DialogTitle className="sr-only">AI Video Studio guide</DialogTitle>
        <DialogDescription className="sr-only">
          Step-by-step recommended workflow for building and exporting a video.
        </DialogDescription>

        <header className="flex items-center gap-3 border-b border-border bg-surface-2/30 px-5 py-4 pr-14">
          <span className="flow-icon flex size-9 shrink-0 items-center justify-center rounded-lg">
            <BookOpen className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-semibold tracking-tight text-foreground">
              Studio guide
            </p>
            <p className="text-xs text-muted-foreground">
              The recommended path from rough idea to Kdenlive-ready assets
            </p>
          </div>
        </header>

        <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[264px_1fr] md:grid-rows-1">
          <nav
            aria-label="Guide steps"
            className="flex min-h-0 gap-1 overflow-x-auto border-b border-border bg-surface-2/20 p-2.5 [scrollbar-color:var(--border-strong)_transparent] [scrollbar-width:thin] md:flex-col md:overflow-x-hidden md:overflow-y-auto md:border-r md:border-b-0 md:pr-1"
          >
            {GUIDE_STEPS.map((entry, entryIndex) => {
              const active = entryIndex === index;
              const complete = entryIndex < index;
              const startsGroup =
                entryIndex === 0 ||
                GUIDE_STEPS[entryIndex - 1].group !== entry.group;
              return (
                <div
                  key={entry.id}
                  className="contents md:block md:w-full md:shrink-0"
                >
                  {startsGroup && (
                    <div className="hidden px-2.5 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-subtle-foreground md:block">
                      {entry.group}
                    </div>
                  )}
                  <button
                    type="button"
                    aria-current={active ? "step" : undefined}
                    aria-label={`Step ${entryIndex + 1}: ${entry.title}`}
                    onClick={() => goTo(entryIndex)}
                    className={cn(
                      "flex shrink-0 items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring md:mb-0.5 md:w-full",
                      active
                        ? "bg-surface-3 text-foreground"
                        : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-full border font-mono text-[10px] font-semibold",
                        active
                          ? "border-transparent bg-primary text-primary-foreground"
                          : complete
                            ? "border-primary/30 text-primary"
                            : "border-border-strong text-subtle-foreground",
                      )}
                    >
                      {complete ? (
                        <Check className="size-3" aria-hidden="true" />
                      ) : (
                        entryIndex + 1
                      )}
                    </span>
                    <span className="hidden min-w-0 md:block md:leading-snug md:whitespace-normal">
                      {entry.title}
                    </span>
                  </button>
                </div>
              );
            })}
          </nav>

          <div className="min-h-0 min-w-0 overflow-y-auto overscroll-contain p-5 md:p-6">
              <div
                key={step.id}
                className="animate-in fade-in-0 slide-in-from-right-1 duration-200 motion-reduce:animate-none"
              >
                <p className="eyebrow">
                  {step.group} · Step {index + 1} of {GUIDE_STEPS.length}
                </p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">
                  {step.title}
                </h2>
                <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
                  {step.summary}
                </p>

                <ul className="mt-4 space-y-2">
                  {step.bullets.map((bullet) => (
                    <li
                      key={bullet}
                      className="flex gap-2.5 text-sm leading-relaxed text-muted-foreground"
                    >
                      <Check
                        className="mt-1 size-3.5 shrink-0 text-primary"
                        aria-hidden="true"
                      />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>

                {step.note && (
                  <p className="mt-4 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs leading-relaxed text-warning">
                    <AlertTriangle
                      className="mt-0.5 size-3.5 shrink-0"
                      aria-hidden="true"
                    />
                    <span>{step.note}</span>
                  </p>
                )}

                <dl className="mt-5 grid gap-x-6 gap-y-3 border-t border-border pt-4 sm:grid-cols-2">
                  {step.details.map((detail) => (
                    <div key={detail.label} className="min-w-0">
                      <dt className="text-xs font-semibold text-foreground">
                        {detail.label}
                      </dt>
                      <dd className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                        {detail.text}
                      </dd>
                    </div>
                  ))}
                </dl>

                <p className="mt-5 flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-surface-2/40 px-3 py-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Where:</span>
                  {step.where}
                </p>
              </div>
            </div>
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/30 p-3">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs"
              render={
                <Link href={step.href} onClick={() => onOpenChange(false)} />
              }
              nativeButton={false}
            >
              {step.cta}
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </Button>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => goTo(index - 1)}
                disabled={isFirst}
              >
                <ArrowLeft className="size-3.5" aria-hidden="true" />
                Back
              </Button>
              <Button
                size="sm"
                onClick={() => goTo(index + 1)}
                disabled={isLast}
              >
                Next
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          </footer>
      </DialogContent>
    </Dialog>
  );
}