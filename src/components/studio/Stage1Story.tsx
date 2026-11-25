"use client";

import { useMemo, useState } from "react";
import {
  BookmarkPlus,
  Check,
  Clapperboard,
  Loader2,
  MapPin,
  Package,
  Plus,
  Sparkles,
  Trash2,
  User,
} from "lucide-react";
import { toast } from "sonner";
import {
  ELEMENT_KINDS,
  type ElementKind,
  type Project,
  type ReferenceElement,
  type Scene,
} from "@/db/schema";
import { EmptyState } from "@/components/EmptyState";
import { SceneCard } from "@/components/studio/SceneCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface RefineWarning {
  sceneIndex: number;
  unknownElementNames: string[];
}

interface Stage1StoryProps {
  project: Project;
  elements: ReferenceElement[];
  scenes: Scene[];
  warnings: RefineWarning[];
  onProjectChange: (project: Project) => void;
  onElementsChange: (elements: ReferenceElement[]) => void;
  onScenesChange: (scenes: Scene[]) => void;
  onWarningsChange: (warnings: RefineWarning[]) => void;
  onNextStage?: () => void;
}

const KIND_META: Record<
  ElementKind,
  {
    label: string;
    plural: string;
    icon: typeof User;
    dotClass: string;
  }
> = {
  character: {
    label: "Character",
    plural: "Characters",
    icon: User,
    dotClass: "bg-primary text-primary",
  },
  prop: {
    label: "Prop",
    plural: "Props",
    icon: Package,
    dotClass: "bg-info text-info",
  },
  location: {
    label: "Location",
    plural: "Locations",
    icon: MapPin,
    dotClass: "bg-warning text-warning",
  },
};

export function Stage1Story({
  project,
  elements,
  scenes,
  warnings,
  onProjectChange,
  onElementsChange,
  onScenesChange,
  onWarningsChange,
  onNextStage,
}: Stage1StoryProps) {
  const [roughIdea, setRoughIdea] = useState(project.roughIdea);
  const [refinedStory, setRefinedStory] = useState(project.refinedStory);
  const [styleBible, setStyleBible] = useState(project.styleBible);
  const [targetSceneCount, setTargetSceneCount] = useState<string>("");

  const [refining, setRefining] = useState(false);
  const [refineConfirmOpen, setRefineConfirmOpen] = useState(false);
  const [savingStory, setSavingStory] = useState(false);

  const [presetDialogOpen, setPresetDialogOpen] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [savingPreset, setSavingPreset] = useState(false);

  const [newElKind, setNewElKind] = useState<ElementKind>("character");
  const [newElName, setNewElName] = useState("");
  const [newElDesc, setNewElDesc] = useState("");
  const [addingElement, setAddingElement] = useState(false);

  const [addingScene, setAddingScene] = useState(false);

  const storyDirty =
    roughIdea !== project.roughIdea ||
    refinedStory !== project.refinedStory ||
    styleBible !== project.styleBible;

  const groupedElements = useMemo(() => {
    const groups: Record<ElementKind, ReferenceElement[]> = {
      character: [],
      prop: [],
      location: [],
    };
    for (const el of elements) {
      groups[el.kind]?.push(el);
    }
    return groups;
  }, [elements]);

  const warningBySceneIndex = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const w of warnings) {
      map.set(w.sceneIndex, w.unknownElementNames);
    }
    return map;
  }, [warnings]);

  const runAutoRefine = async (confirmRebuild: boolean) => {
    setRefining(true);
    try {
      const parsedCount = targetSceneCount.trim()
        ? Number.parseInt(targetSceneCount.trim(), 10)
        : undefined;
      const res = await fetch(`/api/projects/${project.id}/refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roughIdea,
          styleBible,
          ...(parsedCount && parsedCount >= 1 && parsedCount <= 30
            ? { targetSceneCount: parsedCount }
            : {}),
          ...(confirmRebuild ? { confirm: true } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Auto-Refine failed");
      }
      onProjectChange(data.project);
      setRoughIdea(data.project.roughIdea);
      setRefinedStory(data.project.refinedStory);
      setStyleBible(data.project.styleBible);
      onElementsChange(Array.isArray(data.elements) ? data.elements : []);
      onScenesChange(Array.isArray(data.scenes) ? data.scenes : []);
      onWarningsChange(Array.isArray(data.warnings) ? data.warnings : []);
      toast.success(
        `Refined story into ${data.scenes?.length ?? 0} scenes and ${data.elements?.length ?? 0} elements`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Auto-Refine failed");
    } finally {
      setRefining(false);
    }
  };

  const handleAutoRefine = () => {
    if (!roughIdea.trim()) {
      toast.error("Enter a rough idea before running Auto-Refine.");
      return;
    }
    if (scenes.length > 0 || elements.length > 0) {
      setRefineConfirmOpen(true);
      return;
    }
    void runAutoRefine(false);
  };

  const handleSaveStory = async () => {
    setSavingStory(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roughIdea,
          refinedStory,
          styleBible,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Failed to save story");
      }
      onProjectChange(data.project);
      toast.success("Story and Style Bible saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save story");
    } finally {
      setSavingStory(false);
    }
  };

  const handleSavePreset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!presetName.trim() || !styleBible.trim()) {
      toast.error("Preset name and Style Bible text are required.");
      return;
    }
    setSavingPreset(true);
    try {
      const res = await fetch("/api/settings/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: presetName.trim(),
          styleBible: styleBible.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Failed to save preset");
      }
      toast.success(`Saved preset "${data.preset.name}"`);
      setPresetName("");
      setPresetDialogOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save preset");
    } finally {
      setSavingPreset(false);
    }
  };

  const handleAddElement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newElName.trim()) {
      toast.error("Element name is required.");
      return;
    }
    setAddingElement(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/elements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: newElKind,
          name: newElName.trim(),
          description: newElDesc.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Failed to add element");
      }
      onElementsChange([...elements, data.element]);
      setNewElName("");
      setNewElDesc("");
      toast.success(`Added ${data.element.kind} "${data.element.name}"`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add element");
    } finally {
      setAddingElement(false);
    }
  };

  const handleDeleteElement = async (elementId: string) => {
    try {
      const res = await fetch(
        `/api/projects/${project.id}/elements?elementId=${encodeURIComponent(elementId)}`,
        { method: "DELETE" },
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Failed to delete element");
      }
      onElementsChange(elements.filter((el) => el.id !== elementId));
      toast.success("Element removed");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete element",
      );
    }
  };

  const handleAddScene = async () => {
    setAddingScene(true);
    try {
      const nextNum = scenes.length + 1;
      const res = await fetch(`/api/projects/${project.id}/scenes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Scene ${nextNum}`,
          visualPrompt: "",
          cameraDirection: "",
          audioMode: "ambient_only",
          audioScript: "",
          duration: 5,
          videoMode: "omni_reference",
          linkedElementIds: [],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Failed to add scene");
      }
      onScenesChange([...scenes, data.scene]);
      toast.success(`Added ${data.scene.title}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add scene");
    } finally {
      setAddingScene(false);
    }
  };

  const handleReorder = async (sceneId: string, direction: -1 | 1) => {
    const idx = scenes.findIndex((s) => s.id === sceneId);
    const targetIdx = idx + direction;
    if (idx < 0 || targetIdx < 0 || targetIdx >= scenes.length) return;

    const reordered = [...scenes];
    const [moved] = reordered.splice(idx, 1);
    reordered.splice(targetIdx, 0, moved);

    try {
      const res = await fetch(`/api/projects/${project.id}/scenes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reorder: reordered.map((s) => s.id) }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Failed to reorder scenes");
      }
      onScenesChange(Array.isArray(data.scenes) ? data.scenes : reordered);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to reorder scenes",
      );
    }
  };

  const handleDeleteScene = async (sceneId: string) => {
    try {
      const res = await fetch(
        `/api/projects/${project.id}/scenes?sceneId=${encodeURIComponent(sceneId)}`,
        { method: "DELETE" },
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Failed to delete scene");
      }
      onScenesChange(scenes.filter((s) => s.id !== sceneId));
      toast.success("Scene deleted");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete scene",
      );
    }
  };

  return (
    <div className="space-y-8">
      {/* Rough Idea & Auto-Refine */}
      <section className="panel space-y-5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="eyebrow">Stage 1</div>
            <h2 className="text-xl font-semibold tracking-tight text-foreground">
              Story Concept &amp; Auto-Refine
            </h2>
            <p className="text-sm text-muted-foreground">
              Write your rough idea and let the refiner generate a structured
              story, element roster, and scene breakdown.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="number"
              min={1}
              max={30}
              value={targetSceneCount}
              onChange={(e) => setTargetSceneCount(e.target.value)}
              placeholder="Scenes (auto)"
              className="h-9 w-32 text-xs"
              aria-label="Target scene count"
            />
            <Button
              type="button"
              onClick={handleAutoRefine}
              disabled={refining || !roughIdea.trim()}
              className="gap-1.5"
            >
              {refining ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              {refining ? "Refining..." : "Auto-Refine"}
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Rough Idea
            </label>
            <Textarea
              rows={3}
              value={roughIdea}
              onChange={(e) => setRoughIdea(e.target.value)}
              placeholder="Describe your video concept, characters, setting, and arc..."
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Refined Story
              </label>
              <Textarea
                rows={5}
                value={refinedStory}
                onChange={(e) => setRefinedStory(e.target.value)}
                placeholder="Refined narrative treatment..."
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-medium text-muted-foreground">
                  Style Bible
                </label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() => setPresetDialogOpen(true)}
                  disabled={!styleBible.trim()}
                >
                  <BookmarkPlus className="size-3.5" />
                  Save as Preset
                </Button>
              </div>
              <Textarea
                rows={5}
                value={styleBible}
                onChange={(e) => setStyleBible(e.target.value)}
                placeholder="Visual style, color palette, lens/lighting rules..."
              />
            </div>
          </div>

          <div className="flex justify-end border-t border-border pt-4">
            <Button
              type="button"
              variant={storyDirty ? "default" : "outline"}
              size="sm"
              onClick={handleSaveStory}
              disabled={savingStory || !storyDirty}
            >
              {savingStory ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <Check className="mr-1.5 size-3.5" />
              )}
              {storyDirty ? "Save Story & Style Bible" : "Saved"}
            </Button>
          </div>
        </div>
      </section>

      {/* Element Roster */}
      <section className="panel space-y-5 p-6">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            Element Roster ({elements.length})
          </h2>
          <p className="text-sm text-muted-foreground">
            Consistent characters, props, and locations referenced across
            scenes.
          </p>
        </div>

        <form
          onSubmit={handleAddElement}
          className="grid gap-2.5 rounded-xl border border-border bg-surface-2/40 p-3 md:grid-cols-[150px_1fr_2fr_auto]"
        >
          <Select
            value={newElKind}
            onValueChange={(val) => {
              if (val) setNewElKind(val as ElementKind);
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue>{KIND_META[newElKind].label}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {ELEMENT_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {KIND_META[k].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={newElName}
            onChange={(e) => setNewElName(e.target.value)}
            placeholder="Element name"
            required
          />
          <Input
            value={newElDesc}
            onChange={(e) => setNewElDesc(e.target.value)}
            placeholder="Visual description (appearance, materials, colors...)"
          />
          <Button type="submit" disabled={addingElement} className="gap-1.5">
            {addingElement ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Add
          </Button>
        </form>

        <div className="grid gap-4 md:grid-cols-3">
          {ELEMENT_KINDS.map((kind) => {
            const meta = KIND_META[kind];
            const Icon = meta.icon;
            const items = groupedElements[kind];
            return (
              <div
                key={kind}
                className="space-y-2.5 rounded-xl border border-border bg-surface-2/30 p-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <span
                      aria-hidden="true"
                      className={cn("size-2 rounded-full", meta.dotClass)}
                    />
                    <Icon className="size-3.5 text-muted-foreground" />
                    <span>{meta.plural}</span>
                  </div>
                  <Badge variant="secondary" className="font-mono text-xs">
                    {items.length}
                  </Badge>
                </div>

                {items.length === 0 ? (
                  <p className="py-2 text-xs text-subtle-foreground">
                    No {meta.plural.toLowerCase()} yet.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {items.map((el) => (
                      <div
                        key={el.id}
                        className="group/el flex items-start justify-between gap-2 rounded-lg border border-border bg-card/70 p-2.5 text-xs transition-colors hover:border-border-strong"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <div className="truncate font-medium text-foreground">
                            {el.name}
                          </div>
                          {el.description && (
                            <p className="line-clamp-2 text-muted-foreground">
                              {el.description}
                            </p>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="shrink-0 text-muted-foreground opacity-60 transition-opacity hover:text-destructive group-hover/el:opacity-100 focus-visible:opacity-100"
                          onClick={() => handleDeleteElement(el.id)}
                          title={`Delete ${el.name}`}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Scenes Breakdown */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              Scenes ({scenes.length})
            </h2>
            <p className="text-xs text-muted-foreground">
              Edit prompts, reorder shots, polish descriptions, and link
              elements.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleAddScene}
              disabled={addingScene}
              className="gap-1.5"
            >
              {addingScene ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Add Scene
            </Button>
            {onNextStage && scenes.length > 0 && (
              <Button type="button" onClick={onNextStage}>
                Continue to Stage 2
              </Button>
            )}
          </div>
        </div>

        {scenes.length === 0 ? (
          <EmptyState
            icon={Clapperboard}
            title="No scenes yet"
            description="Run Auto-Refine above or click Add Scene to start building your storyboard."
          >
            <Button
              type="button"
              variant="outline"
              onClick={handleAddScene}
              disabled={addingScene}
              className="gap-1.5"
            >
              <Plus className="size-4" />
              Add Scene
            </Button>
          </EmptyState>
        ) : (
          <div className="space-y-4">
            {scenes.map((scene, index) => (
              <SceneCard
                key={`${scene.id}-${scene.updatedAt}`}
                projectId={project.id}
                scene={scene}
                index={index}
                totalScenes={scenes.length}
                styleBible={styleBible}
                elements={elements}
                unknownElementNames={warningBySceneIndex.get(index)}
                onSceneUpdated={(updated) =>
                  onScenesChange(
                    scenes.map((s) => (s.id === updated.id ? updated : s)),
                  )
                }
                onMoveUp={(id) => handleReorder(id, -1)}
                onMoveDown={(id) => handleReorder(id, 1)}
                onDelete={handleDeleteScene}
              />
            ))}
          </div>
        )}
      </section>

      {/* Save Style Bible as Preset Dialog */}
      <Dialog open={presetDialogOpen} onOpenChange={setPresetDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleSavePreset} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Save Style Bible as Preset</DialogTitle>
              <DialogDescription>
                Reuse this Style Bible across future projects.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Preset Name
              </label>
              <Input
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="e.g. Neo-Tokyo Rain Noir"
                required
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPresetDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={savingPreset}>
                {savingPreset && (
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                )}
                Save Preset
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={refineConfirmOpen} onOpenChange={setRefineConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rebuild the storyboard?</DialogTitle>
            <DialogDescription>
              Auto-Refine replaces all {scenes.length} scene(s) and{" "}
              {elements.length} reference element(s). Generated keyframes,
              clips, and take history will be orphaned and must be regenerated.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRefineConfirmOpen(false)}
              disabled={refining}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                setRefineConfirmOpen(false);
                void runAutoRefine(true);
              }}
              disabled={refining}
            >
              Rebuild Storyboard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
