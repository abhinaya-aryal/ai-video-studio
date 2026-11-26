"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import type {
  Asset,
  Project,
  ReferenceElement,
  Scene,
} from "@/db/schema";
import { useJobs } from "@/hooks/useJobs";
import {
  type RefineWarning,
  Stage1Story,
} from "@/components/studio/Stage1Story";
import { Stage2Elements } from "@/components/studio/Stage2Elements";
import { Stage3Video } from "@/components/studio/Stage3Video";
import { StageRail } from "@/components/studio/StageRail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent } from "@/components/ui/tabs";

interface StageTabsProps {
  projectId: string;
}

type StageValue = "stage1" | "stage2" | "stage3";

const STAGE_NUMBER: Record<StageValue, number> = {
  stage1: 1,
  stage2: 2,
  stage3: 3,
};

export function StageTabs({ projectId }: StageTabsProps) {
  const [activeTab, setActiveTab] = useState<StageValue>("stage1");
  const [project, setProject] = useState<Project | null>(null);
  const [elements, setElements] = useState<ReferenceElement[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [warnings, setWarnings] = useState<RefineWarning[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { jobs, hasActiveJobs, refresh: refreshJobs, retryJob } = useJobs({
    projectId,
  });

  const loadProject = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Failed to load project");
      }
      setProject(data.project);
      setElements(Array.isArray(data.elements) ? data.elements : []);
      setScenes(Array.isArray(data.scenes) ? data.scenes : []);
      setAssets(Array.isArray(data.assets) ? data.assets : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load project");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error?.message ?? "Failed to load project");
        }
        if (active) {
          setProject(data.project);
          setElements(Array.isArray(data.elements) ? data.elements : []);
          setScenes(Array.isArray(data.scenes) ? data.scenes : []);
          setAssets(Array.isArray(data.assets) ? data.assets : []);
          setError(null);
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error ? err.message : "Failed to load project",
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [projectId]);

  const readyJobCount = useMemo(
    () => jobs.filter((j) => j.status === "READY").length,
    [jobs],
  );
  const prevReadyCountRef = useRef<number | null>(null);

  useEffect(() => {
    if (prevReadyCountRef.current === null) {
      prevReadyCountRef.current = readyJobCount;
      return;
    }
    if (readyJobCount > prevReadyCountRef.current) {
      prevReadyCountRef.current = readyJobCount;
      void loadProject();
    } else {
      prevReadyCountRef.current = readyJobCount;
    }
  }, [readyJobCount, loadProject]);

  const activeJobsCount = useMemo(
    () =>
      jobs.filter((j) => j.status !== "READY" && j.status !== "FAILED").length,
    [jobs],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        Loading project studio...
      </div>
    );
  }

  if (error || !project) {
    return (
      <Card className="mx-auto max-w-lg border-destructive/40">
        <CardHeader>
          <CardTitle>Unable to load project</CardTitle>
          <CardDescription>
            {error ?? "Project could not be found."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            render={<Link href="/" />}
            nativeButton={false}
            variant="outline"
            size="sm"
          >
            <ArrowLeft className="mr-1.5 size-4" />
            Back to Projects
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Tabs
      value={activeTab}
      onValueChange={(val) => {
        if (val === "stage1" || val === "stage2" || val === "stage3") {
          setActiveTab(val);
        }
      }}
      className="space-y-6"
    >
      <div className="sticky top-3 z-20 space-y-4 rounded-xl border border-border bg-background/90 px-5 py-4 shadow-sm backdrop-blur-md">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <Button
                render={<Link href="/" />}
                nativeButton={false}
                variant="ghost"
                size="icon-sm"
                title="Back to Projects"
                className="shrink-0"
              >
                <ArrowLeft className="size-4" />
              </Button>
              <h1 className="truncate text-2xl font-bold tracking-tight text-foreground">
                {project.title}
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-2 pl-9">
              <Badge variant="outline">{project.aspectRatio}</Badge>
              <Badge variant="outline">{project.resolution}</Badge>
              <Badge variant="secondary" className="font-mono text-xs">
                {project.defaultVideoModel || "Global model"}
              </Badge>
              {hasActiveJobs && (
                <Badge variant="info" className="gap-1.5 tabular-nums">
                  <Loader2 className="size-3 animate-spin" />
                  {activeJobsCount} active job{activeJobsCount === 1 ? "" : "s"}
                </Badge>
              )}
            </div>
          </div>

          <div className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
            Stage {STAGE_NUMBER[activeTab]} of 3
          </div>
        </div>

        <StageRail />
      </div>

      <TabsContent value="stage1">
        <Stage1Story
          project={project}
          elements={elements}
          scenes={scenes}
          warnings={warnings}
          onProjectChange={setProject}
          onElementsChange={setElements}
          onScenesChange={setScenes}
          onWarningsChange={setWarnings}
          onNextStage={() => setActiveTab("stage2")}
        />
      </TabsContent>

      <TabsContent value="stage2">
        <Stage2Elements
          project={project}
          elements={elements}
          scenes={scenes}
          assets={assets}
          jobs={jobs}
          onRefreshProject={loadProject}
          onRefreshJobs={refreshJobs}
          onRetryJob={retryJob}
          onNextStage={() => setActiveTab("stage3")}
        />
      </TabsContent>

      <TabsContent value="stage3">
        <Stage3Video
          project={project}
          elements={elements}
          scenes={scenes}
          assets={assets}
          jobs={jobs}
          onRefreshProject={loadProject}
          onRefreshJobs={refreshJobs}
          onRetryJob={retryJob}
          onBackStage={() => setActiveTab("stage2")}
        />
      </TabsContent>
    </Tabs>
  );
}
