import type { JobStatus } from "@/db/schema";

export type StatusTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "destructive";

const JOB_STATUS_TONES: Record<JobStatus, StatusTone> = {
  QUEUED: "neutral",
  PENDING: "info",
  RUNNING: "info",
  DOWNLOADING: "info",
  READY: "success",
  FAILED: "destructive",
};

export function jobStatusTone(status: JobStatus): StatusTone {
  return JOB_STATUS_TONES[status];
}
