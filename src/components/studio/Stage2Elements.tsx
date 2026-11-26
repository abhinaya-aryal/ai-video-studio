"use client";

import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ImageIcon,
  Layers,
  Loader2,
  RotateCcw,
  Sparkles,
  Volume2,
} from "lucide-react";
import { toast } from "sonner";
import type {
  Asset,
  Job,
  Project,
  ReferenceElement,
  Scene,
} from "@/db/schema";
import { EmptyState } from "@/components/EmptyState";
import { JobStatusBadge } from "@/components/JobStatusBadge";
import { BatchConfirmDialog } from "@/components/studio/BatchConfirmDialog";
import { ElementCard } from "@/components/studio/ElementCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface Stage2ElementsProps {
  project: Project;
  elements: ReferenceElement[];
  scenes: Scene[];
  assets: Asset[];
  jobs: Job[];
  onRefreshProject: () => Promise<void>;
  onRefreshJobs: () => Promise<void>;
  onRetryJob: (jobId: string) => Promise<void>;
  onNextStage?: () => void;
}

export function Stage2Elements({
  project,
  elements,
  scenes,
  assets,
  jobs,
  onRefreshProject,
  onRefreshJobs,
  onRetryJob,
  onNextStage,
}: Stage2ElementsProps) {
  const [batchOpen, setBatchOpen] = useState(false);
  const [ttsOpen, setTtsOpen] = useState(false);
  const [generatingKey, setGeneratingKey] = useState<string | null>(null);
  const [ttsTextByScene, setTtsTextByScene] = useState<Record<string, string>>(
    {},
  );
  const [ttsVoiceByScene, setTtsVoiceByScene] = useState<
    Record<string, string>
  >({});

  const assetById = useMemo(
    () => new Map(assets.map((a) => [a.id, a])),
    [assets],
  );

  const sceneIds = useMemo(() => scenes.map((s) => s.id), [scenes]);

  const getLatestSceneJob = (
    sceneId: string,
    role: "keyframe_first" | "keyframe_last" | "voiceover",
  ): Job | null =>
    jobs
      .filter((j) => j.sceneId === sceneId && j.role === role)
      .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;

  const handleGenerateKeyframe = async (
    sceneId: string,
    position: "first" | "last",
  ) => {
    const key = `${sceneId}:${position}`;
    setGeneratingKey(key);
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
        toast.success(`Queued ${position} keyframe`);
      }
      await onRefreshJobs();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to queue keyframe",
      );
    } finally {
      setGeneratingKey(null);
    }
  };

  const handleGenerateTts = async (scene: Scene) => {
    const text = (ttsTextByScene[scene.id] ?? scene.audioScript).trim();
    if (!text) {
      toast.error("Enter TTS text before generating voiceover.");
      return;
    }
    const voice = (ttsVoiceByScene[scene.id] ?? "").trim();
    const key = `${scene.id}:tts`;
    setGeneratingKey(key);
    try {
      const res = await fetch("/api/generate/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          sceneId: scene.id,
          text,
          ...(voice ? { voice } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Failed to queue TTS");
      }
      toast.success(`Queued voiceover for "${scene.title}"`);
      await onRefreshJobs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to queue TTS");
    } finally {
      setGeneratingKey(null);
    }
  };

  return (
    <div className="space-y-8">
      {/* Element Images */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              Element Images ({elements.length})
            </h2>
            <p className="text-xs text-muted-foreground">
              Generate or upload one clean image for each character, prop, and
              location. The video model handles poses and expressions.
            </p>
          </div>
        </div>

        {elements.length === 0 ? (
          <EmptyState
            icon={ImageIcon}
            title="No elements in the roster yet"
            description="Add characters, props, or locations in Stage 1 to create their images."
            className="py-10"
          />
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {elements.map((element) => (
              <ElementCard
                key={element.id}
                projectId={project.id}
                element={element}
                elements={elements}
                jobs={jobs}
                onRefreshProject={onRefreshProject}
                onRefreshJobs={onRefreshJobs}
                onRetryJob={onRetryJob}
              />
            ))}
          </div>
        )}
      </section>

      {/* Per-Scene Keyframes */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              Scene Keyframes ({scenes.length})
            </h2>
            <p className="text-xs text-muted-foreground">
              Preview and generate first/last keyframes for each scene before
              video synthesis.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              onClick={() => setBatchOpen(true)}
              disabled={scenes.length === 0}
              className="gap-1.5"
            >
              <Layers className="size-4" />
              Generate All Keyframes
            </Button>
            {onNextStage && scenes.length > 0 && (
              <Button type="button" variant="outline" onClick={onNextStage}>
                Continue to Stage 3
              </Button>
            )}
          </div>
        </div>

        {scenes.length === 0 ? (
          <EmptyState
            icon={Layers}
            title="No scenes yet"
            description="Add scenes in Stage 1 to generate first and last keyframes."
            className="py-10"
          />
        ) : (
          <div className="space-y-4">
            {scenes.map((scene, index) => {
              const firstAsset = scene.activeKeyframeFirstAssetId
                ? assetById.get(scene.activeKeyframeFirstAssetId)
                : undefined;
              const lastAsset = scene.activeKeyframeLastAssetId
                ? assetById.get(scene.activeKeyframeLastAssetId)
                : undefined;
              const firstJob = getLatestSceneJob(scene.id, "keyframe_first");
              const lastJob = getLatestSceneJob(scene.id, "keyframe_last");

              const firstActive =
                firstJob !== null &&
                firstJob.status !== "READY" &&
                firstJob.status !== "FAILED";
              const lastActive =
                lastJob !== null &&
                lastJob.status !== "READY" &&
                lastJob.status !== "FAILED";

              return (
                <article key={scene.id} className="panel space-y-4 p-5">
                  <div className="space-y-1.5 border-b border-border pb-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Badge
                          variant="accent"
                          className="shrink-0 font-mono tabular-nums"
                        >
                          #{String(index + 1).padStart(2, "0")}
                        </Badge>
                        <h3 className="truncate text-base font-semibold tracking-tight text-foreground">
                          {scene.title}
                        </h3>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant="outline" className="text-[11px]">
                          {scene.videoMode}
                        </Badge>
                        <Badge
                          variant="outline"
                          className="font-mono text-[11px] tabular-nums"
                        >
                          {scene.duration}s
                        </Badge>
                      </div>
                    </div>
                    {scene.visualPrompt && (
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {scene.visualPrompt}
                      </p>
                    )}
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    {/* First Keyframe */}
                    <div className="space-y-2.5 rounded-xl border border-border bg-surface-2/30 p-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-foreground">
                          First Keyframe
                        </span>
                        {firstJob && (
                          <div className="flex items-center gap-1">
                            <JobStatusBadge
                              status={firstJob.status}
                              errorMessage={firstJob.errorMessage}
                            />
                            {firstJob.status === "FAILED" && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => onRetryJob(firstJob.id)}
                                title="Retry first keyframe"
                              >
                                <RotateCcw className="size-3.5" />
                              </Button>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="media-tile relative aspect-video w-full overflow-hidden">
                        {firstAsset ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`/api/files/${firstAsset.filePath}`}
                            alt={`${scene.title} first keyframe`}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full flex-col items-center justify-center gap-1 text-xs text-subtle-foreground">
                            <ImageIcon className="size-6 opacity-50" />
                            <span>No first keyframe</span>
                          </div>
                        )}
                      </div>

                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="w-full gap-1.5"
                        disabled={
                          generatingKey === `${scene.id}:first` || firstActive
                        }
                        onClick={() =>
                          handleGenerateKeyframe(scene.id, "first")
                        }
                      >
                        {generatingKey === `${scene.id}:first` ||
                        firstActive ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="size-3.5" />
                        )}
                        {firstActive
                          ? "Generating First Frame..."
                          : "Generate First Frame"}
                      </Button>
                    </div>

                    {/* Last Keyframe */}
                    <div className="space-y-2.5 rounded-xl border border-border bg-surface-2/30 p-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-foreground">
                          Last Keyframe
                          {scene.videoMode !== "first_last_frame" && (
                            <span className="ml-1.5 text-[11px] font-normal text-subtle-foreground">
                              (optional)
                            </span>
                          )}
                        </span>
                        {lastJob && (
                          <div className="flex items-center gap-1">
                            <JobStatusBadge
                              status={lastJob.status}
                              errorMessage={lastJob.errorMessage}
                            />
                            {lastJob.status === "FAILED" && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => onRetryJob(lastJob.id)}
                                title="Retry last keyframe"
                              >
                                <RotateCcw className="size-3.5" />
                              </Button>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="media-tile relative aspect-video w-full overflow-hidden">
                        {lastAsset ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`/api/files/${lastAsset.filePath}`}
                            alt={`${scene.title} last keyframe`}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full flex-col items-center justify-center gap-1 text-xs text-subtle-foreground">
                            <ImageIcon className="size-6 opacity-50" />
                            <span>No last keyframe</span>
                          </div>
                        )}
                      </div>

                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="w-full gap-1.5"
                        disabled={
                          generatingKey === `${scene.id}:last` || lastActive
                        }
                        onClick={() => handleGenerateKeyframe(scene.id, "last")}
                      >
                        {generatingKey === `${scene.id}:last` || lastActive ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="size-3.5" />
                        )}
                        {lastActive
                          ? "Generating Last Frame..."
                          : "Generate Last Frame"}
                      </Button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Collapsed Optional TTS Section */}
      <section className="panel overflow-hidden">
        <button
          type="button"
          onClick={() => setTtsOpen((prev) => !prev)}
          className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-surface-2/40 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            {ttsOpen ? (
              <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            )}
            <Volume2 className="size-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground">
                Optional Voiceover (TTS)
              </div>
              <div className="truncate text-xs text-muted-foreground">
                Generate standalone voiceover tracks for narration or dialogue
                scenes.
              </div>
            </div>
          </div>
          <Badge variant="outline" className="shrink-0 text-xs">
            {ttsOpen ? "Hide" : "Expand"}
          </Badge>
        </button>

        {ttsOpen && (
          <div className="space-y-4 border-t border-border p-5">
            {scenes.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No scenes available.
              </p>
            ) : (
              scenes.map((scene, index) => {
                const ttsJob = getLatestSceneJob(scene.id, "voiceover");
                const ttsAsset = scene.activeAudioAssetId
                  ? assetById.get(scene.activeAudioAssetId)
                  : undefined;
                const ttsActive =
                  ttsJob !== null &&
                  ttsJob.status !== "READY" &&
                  ttsJob.status !== "FAILED";
                const textValue = ttsTextByScene[scene.id] ?? scene.audioScript;
                const voiceValue = ttsVoiceByScene[scene.id] ?? "";

                return (
                  <div
                    key={scene.id}
                    className="space-y-2.5 rounded-xl border border-border bg-surface-2/30 p-3.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <Badge
                          variant="secondary"
                          className="shrink-0 font-mono text-xs tabular-nums"
                        >
                          #{String(index + 1).padStart(2, "0")}
                        </Badge>
                        <span className="truncate text-sm font-medium text-foreground">
                          {scene.title}
                        </span>
                        <Badge variant="outline" className="shrink-0 text-[10px]">
                          {scene.audioMode}
                        </Badge>
                      </div>
                      {ttsJob && (
                        <div className="flex items-center gap-1">
                          <JobStatusBadge
                            status={ttsJob.status}
                            errorMessage={ttsJob.errorMessage}
                          />
                          {ttsJob.status === "FAILED" && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => onRetryJob(ttsJob.id)}
                              title="Retry TTS"
                            >
                              <RotateCcw className="size-3.5" />
                            </Button>
                          )}
                        </div>
                      )}
                    </div>

                    <Textarea
                      rows={2}
                      value={textValue}
                      onChange={(e) =>
                        setTtsTextByScene((prev) => ({
                          ...prev,
                          [scene.id]: e.target.value,
                        }))
                      }
                      placeholder="Enter narration or dialogue text for TTS..."
                    />

                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        value={voiceValue}
                        onChange={(e) =>
                          setTtsVoiceByScene((prev) => ({
                            ...prev,
                            [scene.id]: e.target.value,
                          }))
                        }
                        placeholder="Voice (optional, e.g. Cherry)"
                        className="h-8 max-w-xs text-xs"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={
                          generatingKey === `${scene.id}:tts` ||
                          ttsActive ||
                          !textValue.trim()
                        }
                        onClick={() => handleGenerateTts(scene)}
                        className="gap-1.5"
                      >
                        {generatingKey === `${scene.id}:tts` || ttsActive ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Volume2 className="size-3.5" />
                        )}
                        {ttsActive ? "Generating TTS..." : "Generate TTS"}
                      </Button>
                    </div>

                    {ttsAsset && (
                      <audio
                        controls
                        src={`/api/files/${ttsAsset.filePath}`}
                        className="h-8 w-full"
                      />
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </section>

      <BatchConfirmDialog
        open={batchOpen}
        onOpenChange={setBatchOpen}
        projectId={project.id}
        kind="keyframes"
        sceneIds={sceneIds}
        onConfirmed={onRefreshJobs}
      />
    </div>
  );
}
