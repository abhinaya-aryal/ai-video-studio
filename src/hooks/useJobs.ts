"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Job, JobStatus } from "@/db/schema";

const TERMINAL_STATUSES = new Set<JobStatus>(["READY", "FAILED"]);

export interface UseJobsFilter {
  projectId?: string;
  status?: JobStatus[];
  enabled?: boolean;
}

export interface UseJobsResult {
  jobs: Job[];
  loading: boolean;
  error: string | null;
  hasActiveJobs: boolean;
  refresh: () => Promise<void>;
  retryJob: (jobId: string) => Promise<void>;
}

/**
 * Poll `/api/jobs` every 3 seconds while any listed job is in a non-terminal
 * state (`QUEUED`, `PENDING`, `RUNNING`, `DOWNLOADING`).
 */
export function useJobs(filter: UseJobsFilter = {}): UseJobsResult {
  const { projectId, status, enabled = true } = filter;
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const statusKey = status?.join(",") ?? "";

  const queryUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (projectId) params.set("projectId", projectId);
    if (statusKey) params.set("status", statusKey);
    const qs = params.toString();
    return qs ? `/api/jobs?${qs}` : "/api/jobs";
  }, [projectId, statusKey]);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await fetch(queryUrl, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Failed to fetch jobs");
      }
      if (mountedRef.current) {
        setJobs(Array.isArray(data.jobs) ? data.jobs : []);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "Failed to fetch jobs");
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [enabled, queryUrl]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    (async () => {
      try {
        const res = await fetch(queryUrl, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error?.message ?? "Failed to fetch jobs");
        }
        if (active && mountedRef.current) {
          setJobs(Array.isArray(data.jobs) ? data.jobs : []);
          setError(null);
        }
      } catch (err) {
        if (active && mountedRef.current) {
          setError(err instanceof Error ? err.message : "Failed to fetch jobs");
        }
      } finally {
        if (active && mountedRef.current) {
          setLoading(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [enabled, queryUrl]);

  const hasActiveJobs = useMemo(
    () => jobs.some((job) => !TERMINAL_STATUSES.has(job.status)),
    [jobs],
  );

  useEffect(() => {
    if (!enabled || !hasActiveJobs) return;
    const timer = setInterval(() => {
      void refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [enabled, hasActiveJobs, refresh]);

  const retryJob = useCallback(
    async (jobId: string) => {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry", jobId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Failed to retry job");
      }
      await refresh();
    },
    [refresh],
  );

  return {
    jobs,
    loading,
    error,
    hasActiveJobs,
    refresh,
    retryJob,
  };
}
