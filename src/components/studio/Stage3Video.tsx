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
import { EmptyState } from "@/components/EmptyState";
import { JobStatusBadge } from "@/components/JobStatusBadge";
import {
  MediaModePicker,
  type UploadedMediaItem,
} from "@/components/MediaModePicker";
import {
  BatchConfirmDialog,
  type SceneUploadsPayload,
} from "@/components/studio/BatchConfirmDialog";
import { ProjectAssetsPanel } from "@/components/studio/ProjectAssetsPanel";
import { ShotStrip } from "@/components/studio/ShotStrip";
import { TakeHistory } from "@/components/studio/TakeHistory";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { MediaType, ModelCapability } from "@/lib/providers/types";
import { mediaModeState } from "@/lib/studio/media-mode";
import { cn } from "@/lib/utils";

interface Stage3VideoProps {
  project: Project;
  elements: ReferenceElement[];
  scenes: Scene[];
  assets: Asset[];
  jobs: Job[];
  media: { dir: string; files: string[] };
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

function toSceneUploadsPayload(
  uploads: LocalSceneUploads | undefined,
): SceneUploadsPayload | undefined {
  if (!uploads) return undefined;

  const payload: SceneUploadsPayload = {};
  if (uploads.firstFrame) payload.firstFrame = uploads.firstFrame.filePath;
  if (uploads.lastFrame) payload.lastFrame = uploads.lastFrame.filePath;
  if (uploads.refImages?.length) {
    payload.refImages = uploads.refImages.map((item) => item.filePath);
  }
  if (uploads.refVideos?.length) {
    payload.refVideos = uploads.refVideos.map((item) => item.filePath);
  }
  if (uploads.refAudios?.length) {
    payload.refAudios = uploads.refAudios.map((item) => item.filePath);
  }

  return Object.keys(payload).length > 0 ? payload : undefined;
}

/**
 * Stage 3 Studio view: ShotStrip overview, per-scene video generation with
 * MediaModePicker, dropped-elements notices, TakeHistory, batch rendering,
 * and the flat project assets panel.
 */
export function Stage3Video({
  project,
  elements,
  scenes,
  assets,
  jobs,
  media,
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
  const [generatingKeyframeKey, setGeneratingKeyframeKey] = useState<
    string | null
  >(null);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [videoModels, setVideoModels] = useState<ModelCapability[]>([]);
  const [resolvedVideoModel, setResolvedVideoModel] = useState<string | null>(
    null,
  );
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
        if (active) {
          const combined: ModelCapability[] = [
            ...(Array.isArray(data.models) ? data.models : []),
            ...(Array.isArray(data.externalModels) ? data.externalModels : []),
          ];
          setVideoModels(
            combined.filter((m: ModelCapability) => m.modality === "video"),
          );
          const extVideo = data.roleProviders?.video?.modelId ?? null;
          const resolved = Array.isArray(data.resolved)
            ? data.resolved.find(
                (entry: { slot?: string }) => entry.slot === "video",
              )
            : undefined;
          setResolvedVideoModel(extVideo ?? resolved?.modelId ?? null);
        }
      } catch {
        // Fallback to DEFAULT_VIDEO_CAPABILITY
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const effectiveVideoModel =
    project.defaultVideoModel ?? resolvedVideoModel ?? null;

  const capability = useMemo(
    () =>
      videoModels.find((m) => m.modelId === effectiveVideoModel) ??
      DEFAULT_VIDEO_CAPABILITY,
    [videoModels, effectiveVideoModel],
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

  const uploadsByScene = useMemo(() => {
    const map: Record<string, SceneUploadsPayload> = {};
    for (const [sceneId, uploads] of Object.entries(localUploads)) {
      const payload = toSceneUploadsPayload(uploads);
      if (payload) map[sceneId] = payload;
    }
    return map;
  }, [localUploads]);

  const readyClipsCount = useMemo(
    () => scenes.filter((s) => Boolean(s.activeVideoAssetId)).length,
    [scenes],
  );

  const latestVideoJobByScene = useMemo(() => {
    const map = new Map<string, Job>();
    for (const job of jobs) {
      if (!job.sceneId || job.role !== "video_clip") continue;
      const existing = map.get(job.sceneId);
      if (!existing || job.createdAt > existing.createdAt) {
        map.set(job.sceneId, job);
      }
    }
    return map;
  }, [jobs]);

  const latestKeyframeJobByKey = useMemo(() => {
    const map = new Map<string, Job>();
    for (const job of jobs) {
      if (
        !job.sceneId ||
        (job.role !== "keyframe_first" && job.role !== "keyframe_last")
      ) {
        continue;
      }
      const key = `${job.sceneId}:${job.role}`;
      const existing = map.get(key);
      if (!existing || job.createdAt > existing.createdAt) {
        map.set(key, job);
      }
    }
    return map;
  }, [jobs]);

  const takesByScene = useMemo(() => {
    const map = new Map<string, Asset[]>();
    for (const asset of assets) {
      if (
        !asset.sceneId ||
        asset.type !== "video" ||
        asset.role !== "video_clip"
      ) {
        continue;
      }
      const list = map.get(asset.sceneId);
      if (list) {
        list.push(asset);
      } else {
        map.set(asset.sceneId, [asset]);
      }
    }
    return map;
  }, [assets]);

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
      const uploads = toSceneUploadsPayload(localUploads[sceneId]);
      const res = await fetch("/api/generate/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          sceneId,
          modelId: effectiveVideoModel ?? undefined,
          ...(uploads ? { uploads } : {}),
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

  const handleGenerateKeyframe = async (
    sceneId: string,
    position: "first" | "last",
  ) => {
    const key = `${sceneId}:${position}`;
    setGeneratingKeyframeKey(key);
    try {
      const res = await fetch("/api/generate/keyframe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          sceneId,
          position,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Failed to queue keyframe");
      }
      if (
        Array.isArray(data.droppedElements) &&
        data.droppedElements.length > 0
      ) {
        toast.warning(
          `Keyframe queued; dropped extra elements: ${data.droppedElements.join(", ")}`,
        );
      } else {
        toast.success(`Queued ${position} frame`);
      }
      await onRefreshJobs();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to queue keyframe",
      );
    } finally {
      setGeneratingKeyframeKey(null);
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
        try {
          const res = await fetch(`/api/projects/${project.id}/scenes`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: scene.id,
              activeKeyframeFirstAssetId: null,
            }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => null);
            throw new Error(
              data?.error?.message ?? "Failed to remove first keyframe",
            );
          }
          await onRefreshProject();
        } catch (err) {
          toast.error(
            err instanceof Error
              ? err.message
              : "Failed to remove first keyframe",
          );
        }
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
        try {
          const res = await fetch(`/api/projects/${project.id}/scenes`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: scene.id,
              activeKeyframeLastAssetId: null,
            }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => null);
            throw new Error(
              data?.error?.message ?? "Failed to remove last keyframe",
            );
          }
          await onRefreshProject();
        } catch (err) {
          toast.error(
            err instanceof Error
              ? err.message
              : "Failed to remove last keyframe",
          );
        }
      }
      return;
    }

    if (slot === "reference_image") {
      if (index < linkedRefIds.length) {
        const removeId = linkedRefIds[index];
        const allLinked = parseLinkedElementIds(scene.linkedElementIdsJson);
        const nextLinked = allLinked.filter((id) => id !== removeId);
        try {
          const res = await fetch(`/api/projects/${project.id}/scenes`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: scene.id,
              linkedElementIds: nextLinked,
            }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => null);
            throw new Error(
              data?.error?.message ?? "Failed to unlink reference element",
            );
          }
          await onRefreshProject();
        } catch (err) {
          toast.error(
            err instanceof Error
              ? err.message
              : "Failed to unlink reference element",
          );
        }
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
      <section className="panel space-y-5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-foreground">
              <Film className="size-4 text-primary" />
              Video Clips &amp; Shot Review
            </h2>
            <p className="text-sm text-muted-foreground">
              Generate per-scene video clips, switch active takes, and get every take as a
              flat file in your project folder.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-mono tabular-nums">
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
              disabled={scenes.length === 0 || !effectiveVideoModel}
              onClick={() => setBatchOpen(true)}
              className="gap-1.5"
            >
              <Sparkles className="size-3.5" />
              Generate All Clips
            </Button>
          </div>
        </div>

        {scenes.length > 0 && (
          <ShotStrip
            scenes={scenes}
            assetsById={assetsById}
            selectedSceneId={selectedSceneId}
            onSelectScene={handleSelectScene}
          />
        )}
      </section>

      {scenes.length === 0 ? (
        <EmptyState
          icon={Film}
          title="No scenes yet"
          description="Add scenes in Stage 1 to generate video clips."
          className="py-10"
        />
      ) : (
        <div className="space-y-4">
          {scenes.map((scene, index) => {
            const latestJob = latestVideoJobByScene.get(scene.id) ?? null;
            const isJobActive =
              latestJob !== null &&
              latestJob.status !== "READY" &&
              latestJob.status !== "FAILED";
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
                    url: `/api/files/${firstAsset.filePath}?v=${firstAsset.createdAt}`,
                    name: "First Keyframe",
                  }
                : null);
            const lastFrameItem: UploadedMediaItem | null =
              uploads.lastFrame ??
              (lastAsset
                ? {
                    filePath: lastAsset.filePath,
                    url: `/api/files/${lastAsset.filePath}?v=${lastAsset.createdAt}`,
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
                url: `/api/files/${el.activeImagePath!}?v=${el.updatedAt}`,
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

            const sceneTakes = takesByScene.get(scene.id) ?? [];
            const droppedElements = droppedByScene[scene.id] ?? [];
            const isGenerating = generatingSceneId === scene.id;
            const firstKfJob =
              latestKeyframeJobByKey.get(`${scene.id}:keyframe_first`) ?? null;
            const lastKfJob =
              latestKeyframeJobByKey.get(`${scene.id}:keyframe_last`) ?? null;
            const firstKfActive =
              firstKfJob !== null &&
              firstKfJob.status !== "READY" &&
              firstKfJob.status !== "FAILED";
            const lastKfActive =
              lastKfJob !== null &&
              lastKfJob.status !== "READY" &&
              lastKfJob.status !== "FAILED";

            return (
              <article
                key={scene.id}
                id={`stage3-scene-${scene.id}`}
                className={cn(
                  "panel space-y-4 p-5 transition-colors",
                  selectedSceneId === scene.id && "border-primary/70",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3.5">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant="accent"
                        className="shrink-0 font-mono text-xs tabular-nums"
                      >
                        Scene {String(index + 1).padStart(2, "0")}
                      </Badge>
                      <h3 className="truncate text-base font-semibold tracking-tight text-foreground">
                        {scene.title}
                      </h3>
                      <Badge
                        variant="secondary"
                        className="shrink-0 font-mono text-xs tabular-nums"
                      >
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
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {scene.visualPrompt}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
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
                      disabled={isGenerating || isJobActive || !modeState.canSubmit}
                      onClick={() => void handleGenerateClip(scene.id)}
                      className="gap-1.5"
                    >
                      {isGenerating || isJobActive ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Play className="size-3.5" />
                      )}
                      {isJobActive ? "Generating..." : "Generate Clip"}
                    </Button>
                  </div>
                </div>

                {droppedElements.length > 0 && (
                  <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                    <div>
                      <span className="font-medium">Dropped elements:</span>{" "}
                      {droppedElements.join(", ")} (exceeded{" "}
                      <code className="font-mono">{capability.modelId}</code>{" "}
                      reference limit).
                    </div>
                  </div>
                )}

                {activeVideo && (
                  <div className="overflow-hidden rounded-xl border border-border bg-black">
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

                {scene.videoMode === "first_last_frame" && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-2/40 px-3 py-2.5 text-xs">
                    <span className="text-muted-foreground">
                      Need generated start/end stills for this shot?
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      {firstKfJob && (
                        <div className="flex items-center gap-1">
                          <JobStatusBadge
                            status={firstKfJob.status}
                            errorMessage={firstKfJob.errorMessage}
                          />
                          {firstKfJob.status === "FAILED" && (
                            <Button
                              type="button"
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => void onRetryJob(firstKfJob.id)}
                              title="Retry first frame"
                            >
                              <RotateCcw className="size-3.5" />
                            </Button>
                          )}
                        </div>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={
                          generatingKeyframeKey === `${scene.id}:first` ||
                          firstKfActive
                        }
                        onClick={() =>
                          void handleGenerateKeyframe(scene.id, "first")
                        }
                        className="gap-1.5"
                      >
                        {generatingKeyframeKey === `${scene.id}:first` ||
                        firstKfActive ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="size-3.5" />
                        )}
                        {firstFrameItem
                          ? "Regenerate First Frame"
                          : "Generate First Frame"}
                      </Button>

                      {lastKfJob && (
                        <div className="flex items-center gap-1">
                          <JobStatusBadge
                            status={lastKfJob.status}
                            errorMessage={lastKfJob.errorMessage}
                          />
                          {lastKfJob.status === "FAILED" && (
                            <Button
                              type="button"
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => void onRetryJob(lastKfJob.id)}
                              title="Retry last frame"
                            >
                              <RotateCcw className="size-3.5" />
                            </Button>
                          )}
                        </div>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={
                          generatingKeyframeKey === `${scene.id}:last` ||
                          lastKfActive
                        }
                        onClick={() =>
                          void handleGenerateKeyframe(scene.id, "last")
                        }
                        className="gap-1.5"
                      >
                        {generatingKeyframeKey === `${scene.id}:last` ||
                        lastKfActive ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="size-3.5" />
                        )}
                        {lastFrameItem
                          ? "Regenerate Last Frame"
                          : "Generate Last Frame"}
                      </Button>
                    </div>
                  </div>
                )}

                {!modeState.canSubmit && (
                  <div className="text-xs text-warning">
                    {scene.videoMode === "first_last_frame"
                      ? "First/last frame mode requires a First Frame — upload one above, generate one here, or switch to Omni-Reference."
                      : "Current mode and attached media cannot be combined."}
                  </div>
                )}

                <TakeHistory
                  projectId={project.id}
                  scene={scene}
                  takes={sceneTakes}
                  onRefreshProject={onRefreshProject}
                />
              </article>
            );
          })}
        </div>
      )}

      <ProjectAssetsPanel project={project} media={media} />

      <BatchConfirmDialog
        open={batchOpen}
        onOpenChange={setBatchOpen}
        projectId={project.id}
        kind="clips"
        sceneIds={sceneIds}
        modelId={effectiveVideoModel ?? undefined}
        uploadsByScene={uploadsByScene}
        onDroppedElements={(dropped) =>
          setDroppedByScene((prev) => ({ ...prev, ...dropped }))
        }
        onConfirmed={onRefreshJobs}
      />
    </div>
  );
}
