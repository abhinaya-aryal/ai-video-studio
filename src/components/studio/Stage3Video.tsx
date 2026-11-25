"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Film,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import type {
  Asset,
  ElementKind,
  Job,
  Project,
  ReferenceElement,
  Scene,
  VideoMode,
} from "@/db/schema";
import { JobStatusBadge } from "@/components/JobStatusBadge";
import {
  MediaModePicker,
  type UploadedMediaItem,
} from "@/components/MediaModePicker";
import { BatchConfirmDialog } from "@/components/studio/BatchConfirmDialog";
import { ExportPanel } from "@/components/studio/ExportPanel";
import { ShotStrip } from "@/components/studio/ShotStrip";
import { TakeHistory } from "@/components/studio/TakeHistory";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { MediaType, ModelCapability } from "@/lib/providers/types";
import { mediaModeState } from "@/lib/studio/media-mode";
import { cn } from "@/lib/utils";

interface Stage3VideoProps {
  project: Project;
  elements: ReferenceElement[];
  scenes: Scene[];
  assets: Asset[];
  jobs: Job[];
  onRefreshProject: () => Promise<void>;
  onRefreshJobs: () => Promise<void>;
  onRetryJob: (jobId: string) => Promise<void>;
  onBackStage?: () => void;
}

const DEFAULT_VIDEO_CAPABILITY: ModelCapability = {
  modelId: "wan3.0-video",
  modality: "video",
  family: "wan3",
  allowedMediaTypes: [
    "first_frame",
    "last_frame",
    "reference_image",
    "reference_video",
    "reference_audio",
  ],
  maxCounts: {
    first_frame: 1,
    last_frame: 1,
    reference_image: 10,
    reference_video: 5,
    reference_audio: 5,
  },
  resolutions: ["480P", "720P", "1080P"],
  durations: { min: 2, max: 30, smart: true },
  nativeAudio: true,
};

const KIND_PRIORITY: Record<ElementKind, number> = {
  character: 0,
  prop: 1,
  location: 2,
};

function parseLinkedElementIds(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

interface LocalSceneUploads {
  firstFrame?: UploadedMediaItem | null;
  lastFrame?: UploadedMediaItem | null;
  refImages?: UploadedMediaItem[];
  refVideos?: UploadedMediaItem[];
  refAudios?: UploadedMediaItem[];
}

/**
 * Stage 3 Studio view: ShotStrip overview, per-scene video generation with
 * MediaModePicker, dropped-elements notices, TakeHistory, batch rendering,
 * and Kdenlive ExportPanel.
 */
export function Stage3Video({
  project,
  elements,
  scenes,
  assets,
  jobs,
  onRefreshProject,
  onRefreshJobs,
  onRetryJob,
  onBackStage,
}: Stage3VideoProps) {
  const [batchOpen, setBatchOpen] = useState(false);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [generatingSceneId, setGeneratingSceneId] = useState<string | null>(
    null,
  );
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [videoModels, setVideoModels] = useState<ModelCapability[]>([]);
  const [droppedByScene, setDroppedByScene] = useState<
    Record<string, string[]>
  >({});
  const [localUploads, setLocalUploads] = useState<
    Record<string, LocalSceneUploads>
  >({});

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/settings/models", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (active && Array.isArray(data.models)) {
          setVideoModels(
            data.models.filter(
              (m: ModelCapability) => m.modality === "video",
            ),
          );
        }
      } catch {
        // Fallback to DEFAULT_VIDEO_CAPABILITY
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const capability = useMemo(
    () =>
      videoModels.find((m) => m.modelId === project.defaultVideoModel) ??
      DEFAULT_VIDEO_CAPABILITY,
    [videoModels, project.defaultVideoModel],
  );

  const assetsById = useMemo(
    () => new Map(assets.map((a) => [a.id, a])),
    [assets],
  );

  const elementsById = useMemo(
    () => new Map(elements.map((e) => [e.id, e])),
    [elements],
  );

  const sceneIds = useMemo(() => scenes.map((s) => s.id), [scenes]);

  const readyClipsCount = useMemo(
    () => scenes.filter((s) => Boolean(s.activeVideoAssetId)).length,
    [scenes],
  );

  const getLatestVideoJob = (sceneId: string): Job | null =>
    jobs
      .filter((j) => j.sceneId === sceneId && j.role === "video_clip")
      .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;

  const handleSelectScene = (sceneId: string) => {
    setSelectedSceneId(sceneId);
    const el = document.getElementById(`stage3-scene-${sceneId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const handleModeChange = async (sceneId: string, videoMode: VideoMode) => {
    try {
      const res = await fetch(`/api/projects/${project.id}/scenes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sceneId, videoMode }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Failed to update video mode");
      }
      await onRefreshProject();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update video mode",
      );
    }
  };

  const handleGenerateClip = async (sceneId: string) => {
    setGeneratingSceneId(sceneId);
    try {
      const res = await fetch("/api/generate/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          sceneId,
          modelId: project.defaultVideoModel,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Failed to queue video clip");
      }

      const dropped = Array.isArray(data.droppedElements)
        ? (data.droppedElements as string[])
        : [];
      setDroppedByScene((prev) => ({
        ...prev,
        [sceneId]: dropped,
      }));

      if (dropped.length > 0) {
        toast.warning(
          `Clip queued; dropped extra elements: ${dropped.join(", ")}`,
        );
      } else {
        toast.success("Video clip queued");
      }
      await onRefreshJobs();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to queue video clip",
      );
    } finally {
      setGeneratingSceneId(null);
    }
  };

  const handleUpload = async (
    sceneId: string,
    slot: MediaType,
    files: FileList,
  ) => {
    setUploadingKey(`${sceneId}:${slot}`);
    try {
      const uploaded: UploadedMediaItem[] = [];
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("projectId", project.id);
        const res = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error?.message ?? "Upload failed");
        }
        uploaded.push({
          filePath: String(data.filePath),
          url: String(data.url),
          name: file.name,
        });
      }

      setLocalUploads((prev) => {
        const cur = prev[sceneId] ?? {};
        if (slot === "first_frame") {
          return {
            ...prev,
            [sceneId]: { ...cur, firstFrame: uploaded[0] ?? null },
          };
        }
        if (slot === "last_frame") {
          return {
            ...prev,
            [sceneId]: { ...cur, lastFrame: uploaded[0] ?? null },
          };
        }
        if (slot === "reference_image") {
          return {
            ...prev,
            [sceneId]: {
              ...cur,
              refImages: [...(cur.refImages ?? []), ...uploaded],
            },
          };
        }
        if (slot === "reference_video") {
          return {
            ...prev,
            [sceneId]: {
              ...cur,
              refVideos: [...(cur.refVideos ?? []), ...uploaded],
            },
          };
        }
        if (slot === "reference_audio") {
          return {
            ...prev,
            [sceneId]: {
              ...cur,
              refAudios: [...(cur.refAudios ?? []), ...uploaded],
            },
          };
        }
        return prev;
      });
      toast.success(`Uploaded ${uploaded.length} file(s)`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingKey(null);
    }
  };

  const handleRemove = async (
    scene: Scene,
    linkedRefIds: string[],
    slot: MediaType,
    index = 0,
  ) => {
    const cur = localUploads[scene.id] ?? {};
    if (slot === "first_frame") {
      if (cur.firstFrame) {
        setLocalUploads((prev) => ({
          ...prev,
          [scene.id]: { ...cur, firstFrame: null },
        }));
        return;
      }
      if (scene.activeKeyframeFirstAssetId) {
        await fetch(`/api/projects/${project.id}/scenes`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: scene.id,
            activeKeyframeFirstAssetId: null,
          }),
        });
        await onRefreshProject();
      }
      return;
    }

    if (slot === "last_frame") {
      if (cur.lastFrame) {
        setLocalUploads((prev) => ({
          ...prev,
          [scene.id]: { ...cur, lastFrame: null },
        }));
        return;
      }
      if (scene.activeKeyframeLastAssetId) {
        await fetch(`/api/projects/${project.id}/scenes`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: scene.id,
            activeKeyframeLastAssetId: null,
          }),
        });
        await onRefreshProject();
      }
      return;
    }

    if (slot === "reference_image") {
      if (index < linkedRefIds.length) {
        const removeId = linkedRefIds[index];
        const allLinked = parseLinkedElementIds(scene.linkedElementIdsJson);
        const nextLinked = allLinked.filter((id) => id !== removeId);
        await fetch(`/api/projects/${project.id}/scenes`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: scene.id,
            linkedElementIds: nextLinked,
          }),
        });
        await onRefreshProject();
      } else {
        const localIdx = index - linkedRefIds.length;
        setLocalUploads((prev) => ({
          ...prev,
          [scene.id]: {
            ...cur,
            refImages: (cur.refImages ?? []).filter((_, i) => i !== localIdx),
          },
        }));
      }
      return;
    }

    if (slot === "reference_video") {
      setLocalUploads((prev) => ({
        ...prev,
        [scene.id]: {
          ...cur,
          refVideos: (cur.refVideos ?? []).filter((_, i) => i !== index),
        },
      }));
      return;
    }

    if (slot === "reference_audio") {
      setLocalUploads((prev) => ({
        ...prev,
        [scene.id]: {
          ...cur,
          refAudios: (cur.refAudios ?? []).filter((_, i) => i !== index),
        },
      }));
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Film className="size-4 text-primary" />
              Video Clips & Shot Review
            </CardTitle>
            <CardDescription>
              Generate per-scene video clips, switch active takes, and assemble
              your Kdenlive export.
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              {readyClipsCount} / {scenes.length} clips ready
            </Badge>
            {onBackStage && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onBackStage}
              >
                Back to Stage 2
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              disabled={scenes.length === 0}
              onClick={() => setBatchOpen(true)}
              className="gap-1.5"
            >
              <Sparkles className="size-3.5" />
              Generate All Clips
            </Button>
          </div>
        </CardHeader>

        {scenes.length > 0 && (
          <CardContent>
            <ShotStrip
              scenes={scenes}
              assetsById={assetsById}
              selectedSceneId={selectedSceneId}
              onSelectScene={handleSelectScene}
            />
          </CardContent>
        )}
      </Card>

      {scenes.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No scenes yet. Refine or add scenes in Stage 1 first.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {scenes.map((scene, index) => {
            const latestJob = getLatestVideoJob(scene.id);
            const activeVideo = scene.activeVideoAssetId
              ? assetsById.get(scene.activeVideoAssetId)
              : undefined;
            const firstAsset = scene.activeKeyframeFirstAssetId
              ? assetsById.get(scene.activeKeyframeFirstAssetId)
              : undefined;
            const lastAsset = scene.activeKeyframeLastAssetId
              ? assetsById.get(scene.activeKeyframeLastAssetId)
              : undefined;

            const uploads = localUploads[scene.id] ?? {};
            const firstFrameItem: UploadedMediaItem | null =
              uploads.firstFrame ??
              (firstAsset
                ? {
                    filePath: firstAsset.filePath,
                    url: `/api/files/${firstAsset.filePath}`,
                    name: "First Keyframe",
                  }
                : null);
            const lastFrameItem: UploadedMediaItem | null =
              uploads.lastFrame ??
              (lastAsset
                ? {
                    filePath: lastAsset.filePath,
                    url: `/api/files/${lastAsset.filePath}`,
                    name: "Last Keyframe",
                  }
                : null);

            const linkedIds = parseLinkedElementIds(scene.linkedElementIdsJson);
            const linkedElements = linkedIds
              .map((id, idx) => ({ el: elementsById.get(id), idx }))
              .filter(
                (
                  item,
                ): item is { el: ReferenceElement; idx: number } =>
                  Boolean(item.el && item.el.activeImagePath),
              )
              .sort(
                (a, b) =>
                  KIND_PRIORITY[a.el.kind] - KIND_PRIORITY[b.el.kind] ||
                  a.idx - b.idx,
              );

            const linkedRefIds = linkedElements.map((item) => item.el.id);
            const linkedRefItems: UploadedMediaItem[] = linkedElements.map(
              ({ el }) => ({
                filePath: el.activeImagePath!,
                url: `/api/files/${el.activeImagePath!}`,
                name: el.name,
              }),
            );
            const refImages = [...linkedRefItems, ...(uploads.refImages ?? [])];
            const refVideos = uploads.refVideos ?? [];
            const refAudios = uploads.refAudios ?? [];

            const modeState = mediaModeState(scene.videoMode, capability, {
              firstFrame: Boolean(firstFrameItem),
              lastFrame: Boolean(lastFrameItem),
              refImages: refImages.length,
              refVideos: refVideos.length,
              refAudios: refAudios.length,
            });

            const sceneTakes = assets.filter(
              (a) =>
                a.sceneId === scene.id &&
                a.type === "video" &&
                a.role === "video_clip",
            );
            const droppedElements = droppedByScene[scene.id] ?? [];
            const isGenerating = generatingSceneId === scene.id;

            return (
              <Card
                key={scene.id}
                id={`stage3-scene-${scene.id}`}
                className={cn(
                  "transition-colors",
                  selectedSceneId === scene.id && "border-primary/70",
                )}
              >
                <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="font-mono text-xs">
                        Scene {String(index + 1).padStart(2, "0")}
                      </Badge>
                      <CardTitle className="text-base">{scene.title}</CardTitle>
                      <Badge variant="secondary" className="text-xs">
                        {scene.duration}s
                      </Badge>
                      {latestJob && (
                        <JobStatusBadge
                          status={latestJob.status}
                          errorMessage={latestJob.errorMessage}
                        />
                      )}
                    </div>
                    {scene.visualPrompt && (
                      <CardDescription className="line-clamp-2 text-xs">
                        {scene.visualPrompt}
                      </CardDescription>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {latestJob?.status === "FAILED" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void onRetryJob(latestJob.id)}
                        className="gap-1.5"
                      >
                        <RotateCcw className="size-3.5" />
                        Retry
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      disabled={isGenerating || !modeState.canSubmit}
                      onClick={() => void handleGenerateClip(scene.id)}
                      className="gap-1.5"
                    >
                      {isGenerating ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Play className="size-3.5" />
                      )}
                      Generate Clip
                    </Button>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  {droppedElements.length > 0 && (
                    <div className="flex items-start gap-2 rounded-lg border border-amber-700/50 bg-amber-950/30 p-3 text-xs text-amber-200">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
                      <div>
                        <span className="font-medium text-amber-300">
                          Dropped elements:
                        </span>{" "}
                        {droppedElements.join(", ")} (exceeded{" "}
                        <code className="font-mono">{capability.modelId}</code>{" "}
                        reference limit).
                      </div>
                    </div>
                  )}

                  {activeVideo && (
                    <div className="overflow-hidden rounded-lg border bg-black/50">
                      <video
                        key={activeVideo.id}
                        src={`/api/files/${activeVideo.filePath}`}
                        controls
                        playsInline
                        preload="metadata"
                        className="max-h-80 w-full object-contain"
                      />
                    </div>
                  )}

                  <MediaModePicker
                    mode={scene.videoMode}
                    onModeChange={(nextMode) =>
                      void handleModeChange(scene.id, nextMode)
                    }
                    capability={capability}
                    firstFrame={firstFrameItem}
                    lastFrame={lastFrameItem}
                    refImages={refImages}
                    refVideos={refVideos}
                    refAudios={refAudios}
                    onUpload={(slot, files) =>
                      handleUpload(scene.id, slot, files)
                    }
                    onRemove={(slot, idx) =>
                      void handleRemove(scene, linkedRefIds, slot, idx)
                    }
                    uploadingSlot={
                      uploadingKey?.startsWith(`${scene.id}:`)
                        ? (uploadingKey.split(":")[1] as MediaType)
                        : null
                    }
                  />

                  {!modeState.canSubmit && (
                    <div className="text-xs text-amber-400">
                      {scene.videoMode === "first_last_frame"
                        ? "First/last frame mode requires an active First Keyframe (generate one in Stage 2 or switch mode)."
                        : "Current mode and attached media cannot be combined."}
                    </div>
                  )}

                  <TakeHistory
                    projectId={project.id}
                    scene={scene}
                    takes={sceneTakes}
                    onRefreshProject={onRefreshProject}
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ExportPanel project={project} />

      <BatchConfirmDialog
        open={batchOpen}
        onOpenChange={setBatchOpen}
        projectId={project.id}
        kind="clips"
        sceneIds={sceneIds}
        modelId={project.defaultVideoModel}
        onConfirmed={onRefreshJobs}
      />
    </div>
  );
}
