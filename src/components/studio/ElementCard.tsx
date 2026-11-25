"use client";

import { useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ImageIcon,
  Loader2,
  RotateCcw,
  Sparkles,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import type { Asset, ElementKind, Job, ReferenceElement } from "@/db/schema";
import { JobStatusBadge } from "@/components/JobStatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface ElementCardProps {
  projectId: string;
  element: ReferenceElement;
  assets: Asset[];
  jobs: Job[];
  onRefreshProject: () => Promise<void>;
  onRefreshJobs: () => Promise<void>;
  onRetryJob: (jobId: string) => Promise<void>;
}

const KIND_BADGE_VARIANT: Record<ElementKind, "accent" | "info" | "warning"> = {
  character: "accent",
  prop: "info",
  location: "warning",
};

export function ElementCard({
  projectId,
  element,
  assets,
  jobs,
  onRefreshProject,
  onRefreshJobs,
  onRetryJob,
}: ElementCardProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [promptOverride, setPromptOverride] = useState("");
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [settingActivePath, setSettingActivePath] = useState<string | null>(
    null,
  );

  const sheetAssets = useMemo(
    () =>
      assets
        .filter(
          (a) => a.elementId === element.id && a.role === "element_sheet",
        )
        .sort((a, b) => b.version - a.version),
    [assets, element.id],
  );

  const latestJob = useMemo(
    () =>
      jobs
        .filter(
          (j) => j.elementId === element.id && j.role === "element_sheet",
        )
        .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null,
    [jobs, element.id],
  );

  const isJobActive =
    latestJob !== null &&
    latestJob.status !== "READY" &&
    latestJob.status !== "FAILED";

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetch("/api/generate/element-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          elementId: element.id,
          ...(promptOverride.trim() ? { prompt: promptOverride.trim() } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data?.error?.message ?? "Failed to queue element sheet",
        );
      }
      toast.success(`Queued reference sheet for "${element.name}"`);
      await onRefreshJobs();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to generate sheet",
      );
    } finally {
      setGenerating(false);
    }
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("projectId", projectId);
      form.append("elementId", element.id);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Failed to upload image");
      }
      toast.success(`Uploaded sheet for "${element.name}"`);
      await onRefreshProject();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to upload image",
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleSetActive = async (filePath: string) => {
    setSettingActivePath(filePath);
    try {
      const res = await fetch(`/api/projects/${projectId}/elements`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: element.id,
          activeImagePath: filePath,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Failed to set active sheet");
      }
      toast.success(`Updated active sheet for "${element.name}"`);
      await onRefreshProject();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to set active sheet",
      );
    } finally {
      setSettingActivePath(null);
    }
  };

  return (
    <article className="panel panel-hover flex flex-col gap-3.5 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-w-0 items-center gap-2">
            <Badge
              variant={KIND_BADGE_VARIANT[element.kind] ?? "outline"}
              className="shrink-0 capitalize text-[10px]"
            >
              {element.kind}
            </Badge>
            <h3 className="truncate text-base font-semibold tracking-tight text-foreground">
              {element.name}
            </h3>
          </div>
          {element.description && (
            <p className="line-clamp-2 text-xs text-muted-foreground">
              {element.description}
            </p>
          )}
        </div>
        {latestJob && (
          <div className="flex shrink-0 items-center gap-1">
            <JobStatusBadge
              status={latestJob.status}
              errorMessage={latestJob.errorMessage}
            />
            {latestJob.status === "FAILED" && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => onRetryJob(latestJob.id)}
                title="Retry job"
              >
                <RotateCcw className="size-3.5" />
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="media-tile relative aspect-square w-full overflow-hidden">
        {element.activeImagePath ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/files/${element.activeImagePath}`}
            alt={element.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 text-xs text-subtle-foreground">
            <ImageIcon className="size-7 opacity-50" />
            <span>No active sheet</span>
          </div>
        )}
      </div>

      <Input
        value={promptOverride}
        onChange={(e) => setPromptOverride(e.target.value)}
        placeholder="Optional custom sheet prompt..."
        className="h-8 text-xs"
      />

      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          size="sm"
          onClick={handleGenerate}
          disabled={generating || isJobActive}
          className="gap-1.5"
        >
          {generating || isJobActive ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Sparkles className="size-3.5" />
          )}
          {isJobActive ? "Generating..." : "Generate Sheet"}
        </Button>

        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          className="gap-1.5"
        >
          {uploading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Upload className="size-3.5" />
          )}
          Upload
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleUpload(file);
          }}
        />
      </div>

      {sheetAssets.length > 0 && (
        <div className="mt-auto space-y-1.5 border-t border-border pt-2.5">
          <div className="text-[11px] font-medium text-muted-foreground">
            Version History ({sheetAssets.length})
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {sheetAssets.map((asset) => {
              const isActive = element.activeImagePath === asset.filePath;
              return (
                <div
                  key={asset.id}
                  className="flex shrink-0 flex-col items-center gap-1"
                >
                  <div
                    className={cn(
                      "relative size-14 overflow-hidden rounded-lg border",
                      isActive
                        ? "border-primary ring-2 ring-primary/40"
                        : "border-border",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/files/${asset.filePath}`}
                      alt={`${element.name} v${asset.version}`}
                      className="h-full w-full object-cover"
                    />
                    <span className="absolute right-0.5 bottom-0.5 rounded bg-black/70 px-1 font-mono text-[9px] text-white">
                      v{asset.version}
                    </span>
                  </div>
                  {isActive ? (
                    <span className="flex items-center gap-0.5 text-[10px] font-medium text-primary">
                      <CheckCircle2 className="size-3" /> Active
                    </span>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-5 px-1.5 text-[10px]"
                      disabled={settingActivePath === asset.filePath}
                      onClick={() => handleSetActive(asset.filePath)}
                    >
                      {settingActivePath === asset.filePath ? (
                        <Loader2 className="size-2.5 animate-spin" />
                      ) : (
                        "Set Active"
                      )}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </article>
  );
}
