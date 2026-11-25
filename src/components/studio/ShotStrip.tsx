"use client";

import { Film, ImageIcon } from "lucide-react";
import type { Asset, Scene } from "@/db/schema";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ShotStripProps {
  scenes: Scene[];
  assetsById: Map<string, Asset>;
  selectedSceneId?: string | null;
  onSelectScene?: (sceneId: string) => void;
}

/**
 * Horizontal ordered strip of scene thumbnails showing active video clips
 * or fallback first-keyframe images in current scene order.
 */
export function ShotStrip({
  scenes,
  assetsById,
  selectedSceneId,
  onSelectScene,
}: ShotStripProps) {
  if (scenes.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Shot Strip ({scenes.length})
        </h3>
        <span className="text-xs text-subtle-foreground">
          Click a shot to jump to scene
        </span>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2">
        {scenes.map((scene, index) => {
          const videoAsset = scene.activeVideoAssetId
            ? assetsById.get(scene.activeVideoAssetId)
            : undefined;
          const keyframeAsset = scene.activeKeyframeFirstAssetId
            ? assetsById.get(scene.activeKeyframeFirstAssetId)
            : undefined;
          const isSelected = selectedSceneId === scene.id;

          return (
            <button
              key={scene.id}
              type="button"
              onClick={() => onSelectScene?.(scene.id)}
              className={cn(
                "panel group flex w-44 shrink-0 flex-col overflow-hidden text-left transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring hover:border-border-strong",
                isSelected &&
                  "border-primary ring-2 ring-primary/40 shadow-[0_0_24px_-8px_var(--glow-1)]",
              )}
            >
              <div className="relative aspect-video w-full bg-surface-2/60">
                {videoAsset ? (
                  <video
                    src={`/api/files/${videoAsset.filePath}`}
                    muted
                    playsInline
                    preload="metadata"
                    className="h-full w-full object-cover"
                  />
                ) : keyframeAsset ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/files/${keyframeAsset.filePath}`}
                    alt={scene.title}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-subtle-foreground">
                    <ImageIcon className="size-5 opacity-50" />
                  </div>
                )}

                <div className="absolute top-1.5 left-1.5 flex items-center gap-1">
                  <Badge
                    variant="secondary"
                    className="bg-black/70 px-1.5 py-0 font-mono text-[10px] text-white"
                  >
                    #{String(index + 1).padStart(2, "0")}
                  </Badge>
                </div>

                <div className="absolute top-1.5 right-1.5">
                  {videoAsset ? (
                    <Badge
                      variant="success"
                      className="h-5 px-1.5 py-0 text-[10px]"
                    >
                      <Film className="mr-1 size-2.5" />
                      Clip
                    </Badge>
                  ) : keyframeAsset ? (
                    <Badge
                      variant="secondary"
                      className="h-5 bg-black/70 px-1.5 py-0 text-[10px] text-white"
                    >
                      Keyframe
                    </Badge>
                  ) : null}
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                <span className="truncate text-xs font-medium text-foreground">
                  {scene.title}
                </span>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                  {scene.duration}s
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
