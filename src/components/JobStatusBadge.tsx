"use client";

import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Download,
  Loader2,
} from "lucide-react";
import type { JobStatus } from "@/db/schema";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface JobStatusBadgeProps {
  status: JobStatus;
  errorMessage?: string | null;
  className?: string;
}

const STATUS_CONFIG: Record<
  JobStatus,
  {
    label: string;
    classes: string;
    icon: typeof Clock;
    spin?: boolean;
    pulse?: boolean;
  }
> = {
  QUEUED: {
    label: "Queued",
    classes: "bg-zinc-800 text-zinc-200 border-zinc-700",
    icon: Clock,
  },
  PENDING: {
    label: "Pending",
    classes: "bg-amber-950/70 text-amber-300 border-amber-800/60",
    icon: Clock,
  },
  RUNNING: {
    label: "Running",
    classes: "bg-blue-950/70 text-blue-300 border-blue-800/60",
    icon: Loader2,
    spin: true,
  },
  DOWNLOADING: {
    label: "Downloading",
    classes: "bg-indigo-950/70 text-indigo-300 border-indigo-800/60",
    icon: Download,
    pulse: true,
  },
  READY: {
    label: "Ready",
    classes: "bg-emerald-950/70 text-emerald-300 border-emerald-800/60",
    icon: CheckCircle2,
  },
  FAILED: {
    label: "Failed",
    classes: "bg-red-950/70 text-red-300 border-red-800/60",
    icon: AlertCircle,
  },
};

export function JobStatusBadge({
  status,
  errorMessage,
  className,
}: JobStatusBadgeProps) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.QUEUED;
  const Icon = cfg.icon;

  const badge = (
    <Badge
      variant="outline"
      className={cn("gap-1.5 font-medium", cfg.classes, className)}
    >
      <Icon
        className={cn(
          "size-3",
          cfg.spin && "animate-spin",
          cfg.pulse && "animate-pulse",
        )}
      />
      <span>{cfg.label}</span>
    </Badge>
  );

  if (status === "FAILED" && errorMessage) {
    return (
      <Tooltip>
        <TooltipTrigger render={badge} />
        <TooltipContent className="max-w-xs">{errorMessage}</TooltipContent>
      </Tooltip>
    );
  }

  return badge;
}
