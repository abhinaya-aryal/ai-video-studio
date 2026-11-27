"use client";

import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ImageIcon,
  Loader2,
  RotateCcw,
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

  const latestVoiceoverJobByScene = useMemo(() => {
    const map = new Map<string, Job>();
    for (const job of jobs) {
      if (!job.sceneId || job.role !== "voiceover") {
        continue;
      }
      const existing = map.get(job.sceneId);
      if (!existing || job.createdAt > existing.createdAt) {
        map.set(job.sceneId, job);
      }
    }
    return map;
  }, [jobs]);

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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              Element Images ({elements.length})
            </h2>
            <p className="text-xs text-muted-foreground">
              Generate or upload one clean image for each character, prop, and
              location. Omni-Reference clips pull these directly — no separate
              scene keyframes needed.
            </p>
          </div>
          {onNextStage && scenes.length > 0 && (
            <Button type="button" onClick={onNextStage}>
              Continue to Stage 3
            </Button>
          )}
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
                styleBible={project.styleBible}
                storyContext={project.refinedStory || project.roughIdea}
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

      {/* Optional Voiceover (TTS) */}
      <section className="panel overflow-hidden">
        <button
          type="button"
          onClick={() => setTtsOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-surface-2/40"
        >
          <div className="flex min-w-0 items-center gap-3">
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
                const ttsJob =
                  latestVoiceoverJobByScene.get(scene.id) ?? null;
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
                        <Badge
                          variant="outline"
                          className="shrink-0 text-[10px]"
                        >
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
    </div>
  );
}
