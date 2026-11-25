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
import { jobStatusTone, type StatusTone } from "@/lib/ui/status";
import { cn } from "@/lib/utils";

interface JobStatusBadgeProps {
  status: JobStatus;
  errorMessage?: string | null;
  className?: string;
}

const TONE_VARIANT: Record<
  StatusTone,
  "secondary" | "info" | "success" | "warning" | "destructive"
> = {
  neutral: "secondary",
  info: "info",
  success: "success",
  warning: "warning",
  destructive: "destructive",
};

const STATUS_CONFIG: Record<
  JobStatus,
  {
    label: string;
    icon: typeof Clock;
    spin?: boolean;
    pulse?: boolean;
  }
> = {
  QUEUED: {
    label: "Queued",
    icon: Clock,
  },
  PENDING: {
    label: "Pending",
    icon: Clock,
  },
  RUNNING: {
    label: "Running",
    icon: Loader2,
    spin: true,
  },
  DOWNLOADING: {
    label: "Downloading",
    icon: Download,
    pulse: true,
  },
  READY: {
    label: "Ready",
    icon: CheckCircle2,
  },
  FAILED: {
    label: "Failed",
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
  const variant = TONE_VARIANT[jobStatusTone(status)] ?? "secondary";

  const badge = (
    <Badge
      variant={variant}
      className={cn("gap-1.5 font-medium", className)}
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
