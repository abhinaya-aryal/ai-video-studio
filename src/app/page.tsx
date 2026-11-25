"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Clapperboard,
  FolderPlus,
  Loader2,
  Settings,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import type { Project, StylePreset } from "@/db/schema";
import type { ModelCapability } from "@/lib/providers/types";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { ProjectCard } from "@/components/ProjectCard";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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

const ASPECT_RATIOS = ["16:9", "9:16", "1:1"] as const;
const RESOLUTIONS = ["480P", "720P", "1080P"] as const;

export default function ProjectsDashboardPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [presets, setPresets] = useState<StylePreset[]>([]);
  const [videoModels, setVideoModels] = useState<ModelCapability[]>([]);
  const [configured, setConfigured] = useState<boolean>(true);
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [roughIdea, setRoughIdea] = useState("");
  const [stylePresetId, setStylePresetId] = useState<string>("none");
  const [styleBible, setStyleBible] = useState("");
  const [aspectRatio, setAspectRatio] = useState<string>("16:9");
  const [resolution, setResolution] = useState<string>("720P");
  const [defaultVideoModel, setDefaultVideoModel] =
    useState<string>("wan3.0-video");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [projRes, presetRes, modelRes, statusRes] = await Promise.all([
          fetch("/api/projects", { cache: "no-store" }),
          fetch("/api/settings/presets", { cache: "no-store" }),
          fetch("/api/settings/models", { cache: "no-store" }),
          fetch("/api/settings/status", { cache: "no-store" }),
        ]);

        const [projData, presetData, modelData, statusData] = await Promise.all([
          projRes.json(),
          presetRes.json(),
          modelRes.json(),
          statusRes.json(),
        ]);

        if (!active) return;
        setProjects(Array.isArray(projData.projects) ? projData.projects : []);
        setPresets(Array.isArray(presetData.presets) ? presetData.presets : []);

        const models: ModelCapability[] = Array.isArray(modelData.models)
          ? modelData.models.filter(
              (m: ModelCapability) => m.modality === "video",
            )
          : [];
        setVideoModels(models);
        if (statusData?.qwen?.models?.video) {
          setDefaultVideoModel(statusData.qwen.models.video);
        }
        setConfigured(Boolean(statusData?.configured));
      } catch {
        if (active) toast.error("Failed to load dashboard data");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const handlePresetChange = (nextId: string | null) => {
    if (!nextId) return;
    setStylePresetId(nextId);
    if (nextId === "none") return;
    const match = presets.find((p) => p.id === nextId);
    if (match) {
      setStyleBible(match.styleBible);
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Project title is required");
      return;
    }

    setCreating(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          roughIdea,
          styleBible,
          stylePresetId: stylePresetId === "none" ? null : stylePresetId,
          aspectRatio,
          resolution,
          defaultVideoModel,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Failed to create project");
      }

      toast.success(`Created "${data.project.title}"`);
      setDialogOpen(false);
      setTitle("");
      setRoughIdea("");
      setStylePresetId("none");
      setStyleBible("");
      router.push(`/projects/${data.project.id}`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create project",
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workspace"
        title={<span className="prism-text">Projects</span>}
        description="Manage multi-scene stories, consistent element libraries, and Kdenlive exports."
        actions={
          <>
            <Link href="/quick-clip">
              <Button variant="ghost" className="gap-2">
                <Clapperboard className="size-4" />
                <span>Quick Clip</span>
              </Button>
            </Link>
            <Link href="/settings" aria-label="Settings">
              <Button variant="ghost" size="icon" aria-label="Settings">
                <Settings className="size-4" />
              </Button>
            </Link>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger
                render={
                  <Button className="gap-2">
                    <FolderPlus className="size-4" />
                    <span>New Project</span>
                  </Button>
                }
              />
              <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                  <DialogTitle>New Story Project</DialogTitle>
                  <DialogDescription>
                    Create a local project workspace with a style preset and
                    default video model.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleCreateProject} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium" htmlFor="proj-title">
                      Title
                    </label>
                    <Input
                      id="proj-title"
                      placeholder="e.g., Neon Harbor Chase"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium" htmlFor="proj-idea">
                      Rough Idea
                    </label>
                    <Textarea
                      id="proj-idea"
                      rows={3}
                      placeholder="A courier sprints across rain-slicked rooftops..."
                      value={roughIdea}
                      onChange={(e) => setRoughIdea(e.target.value)}
                    />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <label
                        className="text-xs font-medium"
                        htmlFor="proj-preset"
                      >
                        Style Preset
                      </label>
                      <Select
                        value={stylePresetId}
                        onValueChange={handlePresetChange}
                      >
                        <SelectTrigger id="proj-preset" className="w-full">
                          <SelectValue placeholder="Choose a style preset">
                            {stylePresetId === "none"
                              ? "Custom / None"
                              : (presets.find((p) => p.id === stylePresetId)
                                  ?.name ?? "Choose a style preset")}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Custom / None</SelectItem>
                          {presets.map((preset) => (
                            <SelectItem key={preset.id} value={preset.id}>
                              {preset.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <label
                        className="text-xs font-medium"
                        htmlFor="proj-style"
                      >
                        Style Bible
                      </label>
                      <Textarea
                        id="proj-style"
                        rows={2}
                        placeholder="Visual palette, lighting, lens, and aesthetic rules..."
                        value={styleBible}
                        onChange={(e) => setStyleBible(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium">Aspect</label>
                      <Select
                        value={aspectRatio}
                        onValueChange={(v) => v && setAspectRatio(v)}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue>{aspectRatio}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {ASPECT_RATIOS.map((r) => (
                            <SelectItem key={r} value={r}>
                              {r}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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
                          {RESOLUTIONS.map((res) => (
                            <SelectItem key={res} value={res}>
                              {res}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium">Video Model</label>
                      <Select
                        value={defaultVideoModel}
                        onValueChange={(v) => v && setDefaultVideoModel(v)}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue>{defaultVideoModel}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {(videoModels.length > 0
                            ? videoModels
                            : [{ modelId: "wan3.0-video" } as ModelCapability]
                          ).map((m) => (
                            <SelectItem key={m.modelId} value={m.modelId}>
                              {m.modelId}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setDialogOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" disabled={creating}>
                      {creating && (
                        <Loader2 className="mr-2 size-4 animate-spin" />
                      )}
                      Create Project
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </>
        }
      />

      {!configured && (
        <div className="panel flex flex-wrap items-center justify-between gap-4 border-warning/40 bg-warning/10 px-5 py-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" />
            <div className="text-sm">
              <p className="font-medium text-warning">
                Provider API key is not configured
              </p>
              <p className="text-xs text-muted-foreground">
                Edit <code className="font-mono">.env.local</code> with your
                DashScope or Token Plan key and restart the server, then verify
                in Settings.
              </p>
            </div>
          </div>
          <Link href="/settings">
            <Button size="sm" variant="outline">
              Open Settings
            </Button>
          </Link>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 size-5 animate-spin" />
          <span>Loading projects…</span>
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No projects yet"
          description="Start a multi-scene story project or jump straight into Quick Clip for single-shot Wan video generation."
        >
          <Button onClick={() => setDialogOpen(true)} className="gap-2">
            <FolderPlus className="size-4" />
            <span>Create First Project</span>
          </Button>
          <Link href="/quick-clip">
            <Button variant="outline">Try Quick Clip</Button>
          </Link>
        </EmptyState>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project, index) => (
            <ProjectCard
              key={project.id}
              project={project}
              featured={index === 0}
            />
          ))}
        </div>
      )}
    </div>
  );
}
