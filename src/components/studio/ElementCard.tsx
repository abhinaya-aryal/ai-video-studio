"use client";

import { useMemo, useRef, useState } from "react";
import {
  ImageIcon,
  Loader2,
  RotateCcw,
  Sparkles,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import type { ElementKind, Job, ReferenceElement } from "@/db/schema";
import { JobStatusBadge } from "@/components/JobStatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { buildElementImagePrompt } from "@/lib/studio/element-image";

interface ElementCardProps {
  projectId: string;
  styleBible: string;
  storyContext: string;
  element: ReferenceElement;
  elements: ReferenceElement[];
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
  styleBible,
  storyContext,
  element,
  elements,
  jobs,
  onRefreshProject,
  onRefreshJobs,
  onRetryJob,
}: ElementCardProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const defaultPrompt = useMemo(
    () => buildElementImagePrompt(element, styleBible, storyContext),
    [element, styleBible, storyContext],
  );
  const [customPrompt, setCustomPrompt] = useState<string | null>(null);
  const promptValue = customPrompt ?? defaultPrompt;
  const isPromptEdited =
    customPrompt !== null && customPrompt !== defaultPrompt;
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [referenceSelection, setReferenceSelection] = useState<string | null>(
    null,
  );

  const referenceOptions = useMemo(
    () =>
      elements.filter(
        (el) =>
          el.id !== element.id &&
          Boolean(el.activeImagePath && el.activeImagePath.trim()),
      ),
    [elements, element.id],
  );

  const referenceSource =
    referenceSelection ?? (element.activeImagePath ? "self" : "none");
  const referencePath =
    referenceSource === "self"
      ? (element.activeImagePath ?? undefined)
      : referenceSource === "none"
        ? undefined
        : (elements.find((el) => el.id === referenceSource)
            ?.activeImagePath ?? undefined);

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
    const trimmedPrompt = promptValue.trim();
    if (!trimmedPrompt) {
      toast.error("Enter a generation prompt first.");
      return;
    }

    setGenerating(true);
    try {
      const res = await fetch("/api/generate/element-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          elementId: element.id,
          prompt: trimmedPrompt,
          ...(referencePath
            ? { referenceAssetPaths: [referencePath] }
            : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data?.error?.message ?? "Failed to queue element image",
        );
      }
      toast.success(`Queued image for "${element.name}"`);
      await onRefreshJobs();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to generate image",
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
      toast.success(`Uploaded image for "${element.name}"`);
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

  return (
    <article className="panel flex flex-col gap-3.5 p-4">
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
            src={`/api/files/${element.activeImagePath}?v=${element.updatedAt}`}
            alt={element.name}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 text-xs text-subtle-foreground">
            <ImageIcon className="size-7 opacity-50" />
            <span>No image yet</span>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="text-[11px] font-medium text-muted-foreground">
          Reference image
        </label>
        <Select
          value={referenceSource}
          onValueChange={(value) => setReferenceSelection(value ?? "none")}
        >
          <SelectTrigger className="h-8 w-full text-xs">
            <SelectValue>
              {referenceSource === "none"
                ? "No reference"
                : referenceSource === "self"
                  ? "This element (current image)"
                  : (referenceOptions.find((el) => el.id === referenceSource)
                      ?.name ?? "No reference")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No reference</SelectItem>
            {element.activeImagePath && (
              <SelectItem value="self">
                This element (current image)
              </SelectItem>
            )}
            {referenceOptions.map((el) => (
              <SelectItem key={el.id} value={el.id}>
                {el.name} ({el.kind})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <label
            htmlFor={`element-prompt-${element.id}`}
            className="text-[11px] font-medium text-muted-foreground"
          >
            Generation prompt
          </label>
          {isPromptEdited && (
            <button
              type="button"
              onClick={() => setCustomPrompt(null)}
              className="text-[11px] font-medium text-primary hover:underline"
            >
              Reset
            </button>
          )}
        </div>
        <Textarea
          id={`element-prompt-${element.id}`}
          value={promptValue}
          onChange={(e) => setCustomPrompt(e.target.value)}
          rows={5}
          placeholder="Describe the image to generate..."
          className="max-h-48 overflow-y-auto resize-y text-xs leading-relaxed md:text-xs"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          size="sm"
          onClick={handleGenerate}
          disabled={generating || isJobActive || !promptValue.trim()}
          className="gap-1.5"
        >
          {generating || isJobActive ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Sparkles className="size-3.5" />
          )}
          {isJobActive ? "Generating..." : "Generate Image"}
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

      </article>
  );
}
