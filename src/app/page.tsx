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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">
            Manage multi-scene stories, consistent element libraries, and
            Kdenlive exports.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link href="/quick-clip">
            <Button variant="outline" className="gap-2">
              <Clapperboard className="size-4" />
              <span>Quick Clip</span>
            </Button>
          </Link>
          <Link href="/settings">
            <Button variant="outline" className="gap-2">
              <Settings className="size-4" />
              <span>Settings</span>
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
            <DialogContent className="sm:max-w-lg">
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

                <div className="space-y-1.5">
                  <label className="text-xs font-medium" htmlFor="proj-preset">
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
                          : (presets.find((p) => p.id === stylePresetId)?.name ??
                            "Choose a style preset")}
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
                  <label className="text-xs font-medium" htmlFor="proj-style">
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
        </div>
      </div>

      {!configured && (
        <Card className="border-amber-700/50 bg-amber-950/20">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 size-5 text-amber-400 shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-amber-200">
                  Provider API key is not configured
                </p>
                <p className="text-xs text-muted-foreground">
                  Edit <code className="font-mono">.env.local</code> with your
                  DashScope or Token Plan key and restart the server, then
                  verify in Settings.
                </p>
              </div>
            </div>
            <Link href="/settings">
              <Button size="sm" variant="outline">
                Open Settings
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 size-5 animate-spin" />
          <span>Loading projects...</span>
        </div>
      ) : projects.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-14 text-center space-y-3">
            <Sparkles className="size-8 text-muted-foreground" />
            <div className="space-y-1">
              <p className="text-base font-medium">No projects yet</p>
              <p className="text-sm text-muted-foreground max-w-md">
                Start a multi-scene story project or jump straight into Quick
                Clip for single-shot Wan video generation.
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={() => setDialogOpen(true)} className="gap-2">
                <FolderPlus className="size-4" />
                <span>Create First Project</span>
              </Button>
              <Link href="/quick-clip">
                <Button variant="outline">Try Quick Clip</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Link key={project.id} href={`/projects/${project.id}`}>
              <Card className="h-full transition-colors hover:border-primary/60">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base line-clamp-1">
                      {project.title}
                    </CardTitle>
                    <Badge variant="secondary" className="shrink-0 text-[11px]">
                      {project.aspectRatio} · {project.resolution}
                    </Badge>
                  </div>
                  <CardDescription className="font-mono text-xs">
                    {project.slug}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-muted-foreground line-clamp-2 min-h-[2rem]">
                    {project.roughIdea ||
                      project.refinedStory ||
                      "No synopsis yet."}
                  </p>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground border-t border-border pt-2.5">
                    <span className="font-mono">{project.defaultVideoModel}</span>
                    <span>
                      {new Date(project.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
