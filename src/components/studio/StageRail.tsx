"use client";

import { Film, Layers, Sparkles } from "lucide-react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";

const STAGES = [
  {
    value: "stage1",
    label: "Story & Scenes",
    hint: "Concept, elements, script",
    icon: Sparkles,
  },
  {
    value: "stage2",
    label: "Elements & Keyframes",
    hint: "Element images, first/last frames",
    icon: Layers,
  },
  {
    value: "stage3",
    label: "Video & Export",
    hint: "Clips, takes, Kdenlive",
    icon: Film,
  },
] as const;

export function StageRail() {
  return (
    <TabsList className="grid h-auto w-full grid-cols-3 gap-1.5 rounded-lg border border-border bg-surface-2/60 p-1.5 group-data-horizontal/tabs:h-auto">
      {STAGES.map((stage, index) => {
        const Icon = stage.icon;
        return (
          <TabsTrigger
            key={stage.value}
            value={stage.value}
            className="group/stage h-auto justify-start gap-3 rounded-md border border-transparent px-3.5 py-2.5 text-left whitespace-normal data-active:border-primary/35 data-active:bg-surface-3 data-active:text-foreground data-active:shadow-[inset_0_1px_0_#ffffff14,0_0_0_1px_var(--glow-1),0_12px_28px_-16px_var(--glow-1)]"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border-strong bg-surface-2 font-mono text-xs font-semibold text-muted-foreground transition-colors group-data-active/stage:flow-icon group-data-active/stage:border-transparent">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-sm font-semibold leading-tight">
                <Icon className="size-3.5 shrink-0 text-muted-foreground group-data-active/stage:text-primary" />
                <span className="truncate">{stage.label}</span>
              </span>
              <span className="mt-0.5 block truncate text-[11px] font-normal text-subtle-foreground group-data-active/stage:text-muted-foreground">
                {stage.hint}
              </span>
            </span>
          </TabsTrigger>
        );
      })}
    </TabsList>
  );
}
