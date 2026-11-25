"use client";

import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface BatchPreview {
  count: number;
  totalSeconds: number;
  resolution: string;
  model: string;
}

interface BatchConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  kind: "keyframes" | "clips";
  sceneIds: string[];
  modelId?: string;
  onConfirmed?: () => void | Promise<void>;
}

export function BatchConfirmDialog({
  open,
  onOpenChange,
  projectId,
  kind,
  sceneIds,
  modelId,
  onConfirmed,
}: BatchConfirmDialogProps) {
  const [preview, setPreview] = useState<BatchPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sceneIdsKey = sceneIds.join(",");

  useEffect(() => {
    const targetSceneIds = sceneIdsKey ? sceneIdsKey.split(",") : [];
    if (!open || targetSceneIds.length === 0) {
      return;
    }

    let active = true;

    (async () => {
      await Promise.resolve();
      if (!active) return;
      setLoadingPreview(true);
      setError(null);
      setPreview(null);
      try {
        const res = await fetch("/api/generate/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            kind,
            sceneIds: targetSceneIds,
            confirm: false,
            ...(modelId ? { modelId } : {}),
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error?.message ?? "Failed to estimate batch");
        }
        if (active) {
          setPreview({
            count: Number(data.count ?? targetSceneIds.length),
            totalSeconds: Number(data.totalSeconds ?? 0),
            resolution: String(data.resolution ?? ""),
            model: String(data.model ?? ""),
          });
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error ? err.message : "Failed to load batch preview",
          );
        }
      } finally {
        if (active) {
          setLoadingPreview(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [open, projectId, kind, sceneIdsKey, modelId]);

  const handleConfirm = async () => {
    if (sceneIds.length === 0) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/generate/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          kind,
          sceneIds,
          confirm: true,
          ...(modelId ? { modelId } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data?.error?.message ?? "Failed to enqueue batch generation",
        );
      }

      const enqueuedCount = Array.isArray(data.jobs)
        ? data.jobs.length
        : (preview?.count ?? sceneIds.length);
      toast.success(
        `Queued ${enqueuedCount} ${kind === "keyframes" ? "keyframe" : "video"} job(s)`,
      );
      onOpenChange(false);
      await onConfirmed?.();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Batch generation failed",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const titleLabel =
    kind === "keyframes"
      ? "Generate All Keyframes"
      : "Generate All Video Clips";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            {titleLabel}
          </DialogTitle>
          <DialogDescription>
            Review the batch generation scope before enqueueing jobs.
          </DialogDescription>
        </DialogHeader>

        {loadingPreview ? (
          <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" />
            Calculating batch summary...
          </div>
        ) : error ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        ) : preview ? (
          <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Scenes</div>
              <div className="font-semibold">{preview.count}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">
                Total Duration
              </div>
              <div className="font-semibold">{preview.totalSeconds}s</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Resolution</div>
              <div className="font-mono text-xs font-medium">
                {preview.resolution}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Model</div>
              <div className="font-mono text-xs font-medium">
                {preview.model}
              </div>
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={loadingPreview || submitting || !preview || !!error}
          >
            {submitting && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            Confirm & Generate ({preview?.count ?? sceneIds.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
