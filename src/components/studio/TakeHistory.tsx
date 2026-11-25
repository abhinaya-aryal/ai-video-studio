"use client";

import { useState } from "react";
import { Check, Film, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Asset, Scene } from "@/db/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TakeHistoryProps {
  projectId: string;
  scene: Scene;
  takes: Asset[];
  onRefreshProject: () => Promise<void>;
}

/**
 * Lists generated video takes for a scene and lets the user switch the active take.
 */
export function TakeHistory({
  projectId,
  scene,
  takes,
  onRefreshProject,
}: TakeHistoryProps) {
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const sortedTakes = [...takes].sort(
    (a, b) => b.version - a.version || b.createdAt - a.createdAt,
  );

  const handleSetActive = async (assetId: string) => {
    setUpdatingId(assetId);
    try {
      const res = await fetch(`/api/projects/${projectId}/scenes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: scene.id,
          activeVideoAssetId: assetId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Failed to update active take");
      }
      toast.success("Active video take updated");
      await onRefreshProject();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update active take",
      );
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          Take History ({sortedTakes.length})
        </span>
      </div>

      {sortedTakes.length === 0 ? (
        <div className="rounded-md border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
          No video takes generated for this scene yet.
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {sortedTakes.map((take) => {
            const isActive = scene.activeVideoAssetId === take.id;
            const isUpdating = updatingId === take.id;

            return (
              <div
                key={take.id}
                className={cn(
                  "flex items-center justify-between gap-2.5 rounded-md border p-2 text-xs",
                  isActive
                    ? "border-emerald-700/60 bg-emerald-950/20"
                    : "border-border bg-background/40",
                )}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="relative h-12 w-20 shrink-0 overflow-hidden rounded bg-black/40">
                    <video
                      src={`/api/files/${take.filePath}`}
                      muted
                      playsInline
                      preload="metadata"
                      className="h-full w-full object-cover"
                    />
                  </div>

                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-1.5">
                      <Film className="size-3 shrink-0 text-muted-foreground" />
                      <span className="font-mono font-medium">
                        v{take.version}
                      </span>
                      {isActive && (
                        <Badge className="bg-emerald-950/80 px-1.5 py-0 text-[10px] text-emerald-300 border-emerald-700/60">
                          Active
                        </Badge>
                      )}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {new Date(take.createdAt).toLocaleString()}
                    </div>
                  </div>
                </div>

                {isActive ? (
                  <Button
                    type="button"
                    size="xs"
                    variant="secondary"
                    disabled
                    className="shrink-0 gap-1"
                  >
                    <Check className="size-3" />
                    Active
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    disabled={updatingId !== null}
                    onClick={() => void handleSetActive(take.id)}
                    className="shrink-0"
                  >
                    {isUpdating && (
                      <Loader2 className="mr-1 size-3 animate-spin" />
                    )}
                    Set Active
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
