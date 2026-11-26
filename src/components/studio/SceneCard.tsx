"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { AudioMode, ReferenceElement, Scene, VideoMode } from "@/db/schema";
import { AudioModeSelect } from "@/components/AudioModeSelect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface SceneCardProps {
  projectId: string;
  scene: Scene;
  index: number;
  totalScenes: number;
  styleBible: string;
  elements: ReferenceElement[];
  unknownElementNames?: string[];
  onSceneUpdated: (scene: Scene) => void;
  onMoveUp: (sceneId: string) => Promise<void>;
  onMoveDown: (sceneId: string) => Promise<void>;
  onDelete: (sceneId: string) => Promise<void>;
}

const VIDEO_MODE_LABELS: Record<VideoMode, string> = {
  omni_reference: "Omni Reference",
  first_last_frame: "First & Last Frame",
  text_to_video: "Text to Video",
};

function parseLinkedIds(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

export function SceneCard({
  projectId,
  scene,
  index,
  totalScenes,
  styleBible,
  elements,
  unknownElementNames = [],
  onSceneUpdated,
  onMoveUp,
  onMoveDown,
  onDelete,
}: SceneCardProps) {
  const [title, setTitle] = useState(scene.title);
  const [visualPrompt, setVisualPrompt] = useState(scene.visualPrompt);
  const [cameraDirection, setCameraDirection] = useState(scene.cameraDirection);
  const [audioMode, setAudioMode] = useState<AudioMode>(scene.audioMode);
  const [audioScript, setAudioScript] = useState(scene.audioScript);
  const [durationText, setDurationText] = useState<string>(
    String(scene.duration),
  );
  const [videoMode, setVideoMode] = useState<VideoMode>(scene.videoMode);
  const parsedDuration = useMemo(() => {
    const num = Number.parseInt(durationText, 10);
    if (!Number.isFinite(num)) return scene.duration;
    return Math.min(30, Math.max(2, num));
  }, [durationText, scene.duration]);
  const [linkedIds, setLinkedIds] = useState<string[]>(() =>
    parseLinkedIds(scene.linkedElementIdsJson),
  );
  const [elementToAdd, setElementToAdd] = useState<string>("");

  const [saving, setSaving] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const elementMap = useMemo(
    () => new Map(elements.map((el) => [el.id, el])),
    [elements],
  );

  const missingLinkedIds = useMemo(
    () => linkedIds.filter((id) => !elementMap.has(id)),
    [linkedIds, elementMap],
  );

  const availableToAdd = useMemo(
    () => elements.filter((el) => !linkedIds.includes(el.id)),
    [elements, linkedIds],
  );

  const isDirty = useMemo(() => {
    const initialLinked = parseLinkedIds(scene.linkedElementIdsJson);
    return (
      title !== scene.title ||
      visualPrompt !== scene.visualPrompt ||
      cameraDirection !== scene.cameraDirection ||
      audioMode !== scene.audioMode ||
      audioScript !== scene.audioScript ||
      parsedDuration !== scene.duration ||
      videoMode !== scene.videoMode ||
      JSON.stringify(linkedIds) !== JSON.stringify(initialLinked)
    );
  }, [
    scene,
    title,
    visualPrompt,
    cameraDirection,
    audioMode,
    audioScript,
    parsedDuration,
    videoMode,
    linkedIds,
  ]);

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error("Scene title cannot be empty.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/scenes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: scene.id,
          title: title.trim(),
          visualPrompt,
          cameraDirection,
          audioMode,
          audioScript,
          duration: parsedDuration,
          videoMode,
          linkedElementIds: linkedIds,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Failed to update scene");
      }
      onSceneUpdated(data.scene);
      toast.success(`Saved Scene ${index + 1}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save scene");
    } finally {
      setSaving(false);
    }
  };

  const handlePolish = async () => {
    const text = visualPrompt.trim();
    if (!text) {
      toast.error("Enter a visual prompt before polishing.");
      return;
    }
    setPolishing(true);
    try {
      const res = await fetch("/api/polish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          context: {
            styleBible,
            audioMode,
            cameraDirection,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Failed to polish prompt");
      }
      const result = data.polished;
      if (typeof result === "string" && result.trim()) {
        setVisualPrompt(result.trim());
        toast.success("Visual prompt polished");
      } else if (result?.visualPrompt) {
        setVisualPrompt(result.visualPrompt);
        if (result.cameraDirection) {
          setCameraDirection(result.cameraDirection);
        }
        if (result.audioScript) {
          setAudioScript(result.audioScript);
        }
        toast.success("Prompt, camera, and audio polished");
      } else {
        throw new Error("The text model returned an empty prompt");
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to polish prompt",
      );
    } finally {
      setPolishing(false);
    }
  };

  const handleAddElement = (id: string | null) => {
    if (!id) return;
    if (!linkedIds.includes(id)) {
      setLinkedIds((prev) => [...prev, id]);
    }
    setElementToAdd("");
  };

  const handleRemoveElement = (id: string) => {
    setLinkedIds((prev) => prev.filter((item) => item !== id));
  };

  const hasUnknownWarning =
    unknownElementNames.length > 0 || missingLinkedIds.length > 0;

  return (
    <article className="panel overflow-hidden">
      <div className="flex flex-col md:flex-row">
        {/* Left timeline index rail */}
        <div className="flex items-center justify-between gap-2 border-b border-border bg-background-2/70 px-4 py-3 md:w-20 md:shrink-0 md:flex-col md:border-r md:border-b-0 md:py-5">
          <Badge variant="accent" className="font-mono text-xs tabular-nums">
            #{String(index + 1).padStart(2, "0")}
          </Badge>

          <div className="flex items-center gap-1 md:flex-col">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={index === 0 || reordering}
              onClick={async () => {
                setReordering(true);
                try {
                  await onMoveUp(scene.id);
                } finally {
                  setReordering(false);
                }
              }}
              title="Move up"
            >
              <ArrowUp className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={index === totalScenes - 1 || reordering}
              onClick={async () => {
                setReordering(true);
                try {
                  await onMoveDown(scene.id);
                } finally {
                  setReordering(false);
                }
              }}
              title="Move down"
            >
              <ArrowDown className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-destructive"
              disabled={deleting}
              onClick={async () => {
                setDeleting(true);
                try {
                  await onDelete(scene.id);
                } finally {
                  setDeleting(false);
                }
              }}
              title="Delete scene"
            >
              {deleting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
            </Button>
          </div>
        </div>

        {/* Right content */}
        <div className="min-w-0 flex-1 space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3.5">
            <div className="min-w-0 flex-1">
              <h3 className="sr-only">{title}</h3>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Scene title"
                className="h-9 max-w-lg font-medium"
                aria-label={`Scene ${index + 1} title`}
              />
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Badge variant="outline" className="font-mono text-[11px] tabular-nums">
                {parsedDuration}s
              </Badge>
              <Badge variant="secondary" className="text-[11px]">
                {VIDEO_MODE_LABELS[videoMode] ?? videoMode}
              </Badge>
              <Badge variant={isDirty ? "warning" : "success"} className="text-[11px]">
                {isDirty ? "Unsaved" : "Saved"}
              </Badge>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-muted-foreground">
                Visual Prompt
              </label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={handlePolish}
                disabled={polishing || !visualPrompt.trim()}
              >
                {polishing ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Sparkles className="size-3.5" />
                )}
                AI Polish
              </Button>
            </div>
            <Textarea
              rows={3}
              value={visualPrompt}
              onChange={(e) => setVisualPrompt(e.target.value)}
              placeholder="Describe the shot, lighting, action, and subject..."
            />
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Camera Direction
              </label>
              <Input
                value={cameraDirection}
                onChange={(e) => setCameraDirection(e.target.value)}
                placeholder="e.g. Slow dolly in, eye-level"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Video Mode
              </label>
              <Select
                value={videoMode}
                onValueChange={(val) => {
                  if (val) setVideoMode(val as VideoMode);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {VIDEO_MODE_LABELS[videoMode] ?? videoMode}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(VIDEO_MODE_LABELS) as VideoMode[]).map(
                    (mode) => (
                      <SelectItem key={mode} value={mode}>
                        {VIDEO_MODE_LABELS[mode]}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Duration (seconds)
              </label>
              <Input
                type="number"
                min={2}
                max={30}
                value={durationText}
                onChange={(e) => setDurationText(e.target.value)}
                onBlur={() => setDurationText(String(parsedDuration))}
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Audio Mode
              </label>
              <AudioModeSelect value={audioMode} onChange={setAudioMode} />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Audio Script / Dialogue / SFX
              </label>
              <Input
                value={audioScript}
                onChange={(e) => setAudioScript(e.target.value)}
                placeholder={
                  audioMode === "silent"
                    ? "Silent scene"
                    : "Narration, dialogue line, or ambient cue..."
                }
                disabled={audioMode === "silent"}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-medium text-muted-foreground">
                Linked Elements
              </label>
              {availableToAdd.length > 0 && (
                <Select value={elementToAdd} onValueChange={handleAddElement}>
                  <SelectTrigger className="h-7 w-48 text-xs">
                    <SelectValue placeholder="Link element...">
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <Plus className="size-3" /> Link element
                      </span>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {availableToAdd.map((el) => (
                      <SelectItem key={el.id} value={el.id}>
                        <span className="mr-1.5 capitalize text-muted-foreground">
                          [{el.kind}]
                        </span>
                        {el.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {linkedIds.length === 0 && (
                <span className="text-xs text-subtle-foreground">
                  No elements linked yet.
                </span>
              )}
              {linkedIds.map((id) => {
                const el = elementMap.get(id);
                if (!el) {
                  return (
                    <Badge
                      key={id}
                      variant="warning"
                      className="gap-1"
                    >
                      <AlertTriangle className="size-3" />
                      Unknown ({id.slice(0, 8)})
                      <button
                        type="button"
                        onClick={() => handleRemoveElement(id)}
                        className="ml-0.5 hover:text-foreground"
                        aria-label={`Remove unknown element ${id}`}
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  );
                }
                return (
                  <Badge
                    key={id}
                    variant="secondary"
                    className="max-w-full gap-1.5 pr-1 text-xs"
                  >
                    <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
                      {el.kind}
                    </span>
                    <span className="truncate">{el.name}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveElement(id)}
                      className="shrink-0 rounded-full p-0.5 hover:bg-surface-3"
                      aria-label={`Unlink ${el.name}`}
                    >
                      <X className="size-3" />
                    </button>
                  </Badge>
                );
              })}
            </div>

            {hasUnknownWarning && (
              <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <div>
                  {unknownElementNames.length > 0 && (
                    <span>
                      Unresolved element name(s) from refiner:{" "}
                      <strong>{unknownElementNames.join(", ")}</strong>.{" "}
                    </span>
                  )}
                  {missingLinkedIds.length > 0 && (
                    <span>
                      {missingLinkedIds.length} linked element ID(s) no longer
                      exist in the roster.
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end border-t border-border pt-3">
            <Button
              type="button"
              size="sm"
              variant={isDirty ? "default" : "outline"}
              onClick={handleSave}
              disabled={saving || !isDirty}
            >
              {saving ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <Check className="mr-1.5 size-3.5" />
              )}
              {isDirty ? "Save Scene" : "Saved"}
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}
