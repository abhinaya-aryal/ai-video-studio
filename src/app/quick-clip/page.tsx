"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Clapperboard,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import type { Asset, AudioMode, Project, VideoMode } from "@/db/schema";
import { AudioModeSelect } from "@/components/AudioModeSelect";
import { EmptyState } from "@/components/EmptyState";
import { JobStatusBadge } from "@/components/JobStatusBadge";
import {
  MediaModePicker,
  type UploadedMediaItem,
} from "@/components/MediaModePicker";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useJobs } from "@/hooks/useJobs";
import type { MediaType, ModelCapability } from "@/lib/providers/types";
import { mediaModeState } from "@/lib/studio/media-mode";
import { cn } from "@/lib/utils";

const DEFAULT_CAPABILITY: ModelCapability = {
  modelId: "wan3.0-video",
  modality: "video",
  family: "wan3",
  allowedMediaTypes: [
    "first_frame",
    "last_frame",
    "reference_image",
    "reference_video",
    "reference_audio",
    "file",
    "link",
  ],
  maxCounts: {
    first_frame: 1,
    last_frame: 1,
    reference_image: 10,
    reference_video: 5,
    reference_audio: 5,
    file: 1,
    link: 1,
  },
  durations: { min: 2, max: 30, smart: true },
  resolutions: ["480P", "720P", "1080P"],
  nativeAudio: true,
};

const RATIOS = ["16:9", "9:16", "1:1"] as const;

export default function QuickClipPage() {
  const [videoModels, setVideoModels] = useState<ModelCapability[]>([]);
  const [modelId, setModelId] = useState("wan3.0-video");
  const [mode, setMode] = useState<VideoMode>("text_to_video");
  const [prompt, setPrompt] = useState("");
  const [audioMode, setAudioMode] = useState<AudioMode>("ambient_only");
  const [resolution, setResolution] = useState("720P");
  const [ratio, setRatio] = useState("16:9");
  const [duration, setDuration] = useState(5);

  const [firstFrame, setFirstFrame] = useState<UploadedMediaItem | null>(null);
  const [lastFrame, setLastFrame] = useState<UploadedMediaItem | null>(null);
  const [refImages, setRefImages] = useState<UploadedMediaItem[]>([]);
  const [refVideos, setRefVideos] = useState<UploadedMediaItem[]>([]);
  const [refAudios, setRefAudios] = useState<UploadedMediaItem[]>([]);
  const [uploadingSlot, setUploadingSlot] = useState<MediaType | null>(null);

  const [polishing, setPolishing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [quickClipProjectId, setQuickClipProjectId] = useState<string | null>(
    null,
  );
  const [assetsById, setAssetsById] = useState<Record<string, Asset>>({});
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      try {
        const [modelsRes, statusRes, projectsRes] = await Promise.all([
          fetch("/api/settings/models", { cache: "no-store" }),
          fetch("/api/settings/status", { cache: "no-store" }),
          fetch("/api/projects?includeHidden=1", { cache: "no-store" }),
        ]);

        const [modelsData, statusData, projectsData] = await Promise.all([
          modelsRes.json(),
          statusRes.json(),
          projectsRes.json(),
        ]);

        const vids: ModelCapability[] = Array.isArray(modelsData.models)
          ? modelsData.models.filter(
              (m: ModelCapability) => m.modality === "video",
            )
          : [];
        setVideoModels(vids);

        if (statusData?.qwen?.models?.video) {
          setModelId(statusData.qwen.models.video);
        }

        const quickProject = (
          Array.isArray(projectsData.projects) ? projectsData.projects : []
        ).find((p: Project) => p.slug === "_quick-clips");
        if (quickProject) {
          setQuickClipProjectId(quickProject.id);
        }
      } catch {
        toast.error("Failed to initialize Quick Clip");
      }
    }
    void init();
  }, []);

  const capability = useMemo(
    () =>
      videoModels.find((m) => m.modelId === modelId) ?? DEFAULT_CAPABILITY,
    [videoModels, modelId],
  );

  const modeState = useMemo(
    () =>
      mediaModeState(mode, capability, {
        firstFrame: Boolean(firstFrame),
        lastFrame: Boolean(lastFrame),
        refImages: refImages.length,
        refVideos: refVideos.length,
        refAudios: refAudios.length,
      }),
    [
      mode,
      capability,
      firstFrame,
      lastFrame,
      refImages.length,
      refVideos.length,
      refAudios.length,
    ],
  );

  const {
    jobs,
    loading: jobsLoading,
    refresh: refreshJobs,
    retryJob,
  } = useJobs({
    projectId: quickClipProjectId ?? undefined,
    enabled: Boolean(quickClipProjectId),
  });

  useEffect(() => {
    if (!quickClipProjectId) return;
    if (!jobs.some((j) => j.status === "READY" && j.resultAssetId)) return;
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${quickClipProjectId}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (active && Array.isArray(data.assets)) {
          const map: Record<string, Asset> = {};
          for (const asset of data.assets as Asset[]) {
            map[asset.id] = asset;
          }
          setAssetsById(map);
        }
      } catch {
        // Non-fatal; preview will retry on next poll
      }
    })();
    return () => {
      active = false;
    };
  }, [jobs, quickClipProjectId]);

  const handleModeChange = (nextMode: VideoMode) => {
    setMode(nextMode);
    if (nextMode === "text_to_video") {
      setFirstFrame(null);
      setLastFrame(null);
      setRefImages([]);
      setRefVideos([]);
      setRefAudios([]);
    } else if (nextMode === "first_last_frame") {
      setRefImages([]);
      setRefVideos([]);
      setRefAudios([]);
    } else if (nextMode === "omni_reference") {
      setFirstFrame(null);
      setLastFrame(null);
    }
  };

  const handleUpload = async (slot: MediaType, files: FileList) => {
    setUploadingSlot(slot);
    setSubmitError(null);
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);
        if (quickClipProjectId) {
          formData.append("projectId", quickClipProjectId);
        }

        const res = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error?.message ?? "Upload failed");
        }

        if (data.projectId && !quickClipProjectId) {
          setQuickClipProjectId(data.projectId);
        }

        const uploaded: UploadedMediaItem = {
          filePath: data.filePath,
          url: data.url,
          name: file.name,
        };

        if (slot === "first_frame") {
          setFirstFrame(uploaded);
        } else if (slot === "last_frame") {
          setLastFrame(uploaded);
        } else if (slot === "reference_image") {
          setRefImages((prev) => [...prev, uploaded]);
        } else if (slot === "reference_video") {
          setRefVideos((prev) => [...prev, uploaded]);
        } else if (slot === "reference_audio") {
          setRefAudios((prev) => [...prev, uploaded]);
        }
      }
      toast.success("Uploaded media");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      toast.error(msg);
      setSubmitError(msg);
    } finally {
      setUploadingSlot(null);
    }
  };

  const handleRemoveMedia = (slot: MediaType, index?: number) => {
    if (slot === "first_frame") setFirstFrame(null);
    else if (slot === "last_frame") setLastFrame(null);
    else if (slot === "reference_image" && index !== undefined) {
      setRefImages((prev) => prev.filter((_, i) => i !== index));
    } else if (slot === "reference_video" && index !== undefined) {
      setRefVideos((prev) => prev.filter((_, i) => i !== index));
    } else if (slot === "reference_audio" && index !== undefined) {
      setRefAudios((prev) => prev.filter((_, i) => i !== index));
    }
  };

  const handlePolish = async () => {
    if (!prompt.trim()) {
      toast.error("Enter a prompt before polishing");
      return;
    }
    setPolishing(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/polish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: prompt.trim(),
          context: { audioMode },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Failed to polish prompt");
      }
      setPrompt(data.polished);
      toast.success("Prompt polished");
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to polish prompt";
      toast.error(msg);
      setSubmitError(msg);
    } finally {
      setPolishing(false);
    }
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) {
      toast.error("Please enter a prompt");
      return;
    }
    if (!modeState.canSubmit) {
      toast.error("Check your selected mode and required media slots");
      return;
    }

    const media: Array<{ type: MediaType; url: string }> = [];
    if (mode === "first_last_frame") {
      if (firstFrame) media.push({ type: "first_frame", url: firstFrame.filePath });
      if (lastFrame) media.push({ type: "last_frame", url: lastFrame.filePath });
    } else if (mode === "omni_reference") {
      for (const img of refImages) {
        media.push({ type: "reference_image", url: img.filePath });
      }
      for (const vid of refVideos) {
        media.push({ type: "reference_video", url: vid.filePath });
      }
      for (const aud of refAudios) {
        media.push({ type: "reference_audio", url: aud.filePath });
      }
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/generate/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId,
          prompt: prompt.trim(),
          media,
          duration,
          resolution,
          ratio,
          audioMode,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Failed to queue video job");
      }

      if (data.job?.projectId) {
        setQuickClipProjectId(data.job.projectId);
      }
      toast.success("Video generation queued");
      await refreshJobs();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to queue video job";
      toast.error(msg);
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const durationChoices = useMemo(() => {
    const min = Math.max(2, capability.durations.min || 2);
    const max = Math.max(min, capability.durations.max || 15);
    const presets = [3, 5, 8, 10, 15, 20, 30].filter(
      (d) => d >= min && d <= max,
    );
    return presets.length > 0 ? presets : [min];
  }, [capability]);

  const videoJobs = jobs.filter((j) => j.modality === "video");
  const readyVideoJobs = videoJobs.filter((job) => job.status === "READY");
  const selectedJob =
    videoJobs.find((job) => job.id === selectedJobId) ??
    readyVideoJobs[0] ??
    videoJobs[0];

  const selectedAsset = selectedJob?.resultAssetId
    ? assetsById[selectedJob.resultAssetId]
    : undefined;
  const selectedVideoUrl = selectedAsset
    ? `/api/files/${selectedAsset.filePath}`
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workspace"
        title={
          <>
            Quick <span className="prism-text">Clip</span>
          </>
        }
        description="Direct Wan video synthesis without creating a full story project. Supports text-to-video, first/last frames, and omni-reference."
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        {/* Composer */}
        <section className="panel space-y-5 p-6">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              Generate Clip
            </h2>
            <p className="text-xs text-muted-foreground">
              Write a prompt, optionally polish it with your text model, attach
              reference media, and queue generation.
            </p>
          </div>

          <form onSubmit={handleGenerate} className="space-y-5">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-medium" htmlFor="qc-prompt">
                  Prompt
                </label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={polishing || !prompt.trim()}
                  onClick={() => void handlePolish()}
                  className="gap-1.5"
                >
                  {polishing ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Wand2 className="size-3.5" />
                  )}
                  <span>Polish Prompt</span>
                </Button>
              </div>
              <Textarea
                id="qc-prompt"
                rows={4}
                placeholder="Describe the shot, subject motion, lighting, and camera movement... (Use @Image 1, @Image 2 for omni-reference images)"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <div className="space-y-1.5 lg:col-span-2">
                <label className="text-xs font-medium">Model</label>
                <Select
                  value={modelId}
                  onValueChange={(v) => v && setModelId(v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>{modelId}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(videoModels.length > 0
                      ? videoModels
                      : [DEFAULT_CAPABILITY]
                    ).map((m) => (
                      <SelectItem key={m.modelId} value={m.modelId}>
                        {m.modelId}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium">Audio Mode</label>
                <AudioModeSelect
                  value={audioMode}
                  onChange={setAudioMode}
                  nativeAudioSupported={capability.nativeAudio}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium">Resolution</label>
                <Select
                  value={resolution}
                  onValueChange={(v) => v && setResolution(v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>{resolution}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(capability.resolutions.length > 0
                      ? capability.resolutions
                      : ["480P", "720P", "1080P"]
                    ).map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Ratio</label>
                  <Select
                    value={ratio}
                    onValueChange={(v) => v && setRatio(v)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue>{ratio}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {RATIOS.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Duration</label>
                  <Select
                    value={String(duration)}
                    onValueChange={(v) => v && setDuration(Number(v))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue>{duration}s</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {durationChoices.map((d) => (
                        <SelectItem key={d} value={String(d)}>
                          {d}s
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <MediaModePicker
              mode={mode}
              onModeChange={handleModeChange}
              capability={capability}
              firstFrame={firstFrame}
              lastFrame={lastFrame}
              refImages={refImages}
              refVideos={refVideos}
              refAudios={refAudios}
              onUpload={handleUpload}
              onRemove={handleRemoveMedia}
              uploadingSlot={uploadingSlot}
            />

            {submitError && (
              <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                <span className="min-w-0 break-words">{submitError}</span>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border pt-4">
              {!modeState.canSubmit && (
                <span className="text-xs text-warning">
                  Attach a First Frame or switch mode to submit.
                </span>
              )}
              <Button
                type="submit"
                size="lg"
                disabled={submitting || !modeState.canSubmit || !prompt.trim()}
                className="gap-2 px-5"
              >
                {submitting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                <span>Generate Clip</span>
              </Button>
            </div>
          </form>
        </section>

        {/* Output & Recent Clips */}
        <aside className="space-y-4 xl:sticky xl:top-8 xl:self-start">
          <section className="panel space-y-4 p-5">
            <div className="space-y-1">
              <h2 className="text-base font-semibold tracking-tight text-foreground">
                Recent Quick Clips
              </h2>
              <p className="text-xs text-muted-foreground">
                Jobs poll automatically every 3 seconds until complete.
              </p>
            </div>

            {jobsLoading && videoJobs.length === 0 ? (
              <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                <span>Loading jobs...</span>
              </div>
            ) : !selectedJob ? (
              <EmptyState
                icon={Clapperboard}
                title="No Quick Clip jobs yet"
                description="No Quick Clip jobs yet. Submit a prompt above to generate your first clip."
                className="border-dashed bg-surface-2/20 py-8 shadow-none"
              />
            ) : (
              <div className="space-y-4">
                {/* Main Selected Job */}
                <div className="space-y-3 rounded-xl border border-border bg-surface-2/40 p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <JobStatusBadge
                        status={selectedJob.status}
                        errorMessage={selectedJob.errorMessage}
                      />
                      <span className="truncate font-mono text-xs text-muted-foreground">
                        {selectedJob.modelId}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="font-mono text-[11px] tabular-nums text-subtle-foreground">
                        {new Date(selectedJob.createdAt).toLocaleTimeString()}
                      </span>
                      {selectedJob.status === "FAILED" && (
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          onClick={() => void retryJob(selectedJob.id)}
                          className="gap-1"
                        >
                          <RotateCcw className="size-3" />
                          <span>Retry</span>
                        </Button>
                      )}
                    </div>
                  </div>

                  {selectedJob.status === "FAILED" &&
                    selectedJob.errorMessage && (
                      <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
                        <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                        <span className="min-w-0 break-words">
                          {selectedJob.errorMessage}
                        </span>
                      </div>
                    )}

                  {selectedJob.status === "READY" && selectedVideoUrl ? (
                    <div className="overflow-hidden rounded-lg border border-border bg-black">
                      <video
                        key={selectedJob.id}
                        src={selectedVideoUrl}
                        controls
                        playsInline
                        className="max-h-[360px] w-full"
                      />
                    </div>
                  ) : selectedJob.status === "READY" ? (
                    <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                      <Play className="size-3.5" />
                      <span>Loading video preview...</span>
                    </div>
                  ) : null}
                </div>

                {/* Recent List */}
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-subtle-foreground">
                    History ({videoJobs.length})
                  </div>
                  <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
                    {videoJobs.map((job) => {
                      const isSelected = selectedJob.id === job.id;
                      return (
                        <div
                          key={job.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedJobId(job.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setSelectedJobId(job.id);
                            }
                          }}
                          className={cn(
                            "flex cursor-pointer flex-col gap-1.5 rounded-xl border p-2.5 text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            isSelected
                              ? "border-primary/50 bg-primary/5"
                              : "border-border bg-surface-2/30 hover:border-border-strong",
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <JobStatusBadge
                                status={job.status}
                                errorMessage={job.errorMessage}
                              />
                              <span className="truncate font-mono text-[11px] text-muted-foreground">
                                {job.modelId}
                              </span>
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              <span className="font-mono text-[11px] tabular-nums text-subtle-foreground">
                                {new Date(job.createdAt).toLocaleTimeString()}
                              </span>
                              {job.status === "FAILED" && (
                                <Button
                                  type="button"
                                  size="xs"
                                  variant="outline"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void retryJob(job.id);
                                  }}
                                  className="h-6 gap-1 px-2"
                                >
                                  <RotateCcw className="size-3" />
                                  <span>Retry</span>
                                </Button>
                              )}
                            </div>
                          </div>
                          {job.status === "FAILED" && job.errorMessage && (
                            <p className="line-clamp-2 text-[11px] text-destructive">
                              {job.errorMessage}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
