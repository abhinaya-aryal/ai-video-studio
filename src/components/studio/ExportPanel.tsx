"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  FileCode2,
  FolderOpen,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import type { Project } from "@/db/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface ExportResult {
  dir: string;
  files: string[];
  missingScenes: string[];
}

interface ExportPanelProps {
  project: Project;
}

/**
 * Kdenlive export panel: rebuilds `export_kdenlive/`, reports missing scenes,
 * and provides direct downloads for `project.kdenlive` and the full ZIP archive.
 */
export function ExportPanel({ project }: ExportPanelProps) {
  const [rebuilding, setRebuilding] = useState(false);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRebuild = async () => {
    setRebuilding(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/export`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Failed to rebuild export");
      }
      const next = data.export as ExportResult | undefined;
      if (!next || typeof next.dir !== "string") {
        throw new Error("Invalid export response from server");
      }
      setExportResult(next);
      toast.success("Kdenlive export rebuilt");
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to rebuild export";
      setError(msg);
      toast.error(msg);
    } finally {
      setRebuilding(false);
    }
  };

  const hasKdenliveFile = Boolean(
    exportResult?.files.includes("project.kdenlive"),
  );
  const zipUrl = `/api/projects/${project.id}/export`;
  const kdenliveUrl = `/api/files/${project.slug}/export_kdenlive/project.kdenlive`;

  return (
    <section className="panel overflow-hidden">
      <div className="prism-line" aria-hidden="true" />
      <div className="space-y-5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
              <Archive className="size-4 text-primary" />
              Kdenlive Export
            </h2>
            <p className="text-sm text-muted-foreground">
              Assemble active scene clips, voiceovers,{" "}
              <code className="font-mono text-xs">story.md</code>, and a starter{" "}
              <code className="font-mono text-xs">project.kdenlive</code>{" "}
              timeline in current scene order.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleRebuild()}
              disabled={rebuilding}
              className="gap-1.5"
            >
              {rebuilding ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Rebuild Export
            </Button>

            <Button
              render={
                <a href={zipUrl} download={`${project.slug}-kdenlive.zip`} />
              }
              nativeButton={false}
              className="gap-1.5"
            >
              <Archive className="size-4" />
              Download ZIP
            </Button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            {error}
          </div>
        )}

        {exportResult ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface-2/40 px-3.5 py-2.5 text-xs">
              <div className="flex min-w-0 items-center gap-2">
                <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
                <span className="shrink-0 text-muted-foreground">
                  Export Folder:
                </span>
                <code className="truncate font-mono text-foreground">
                  {exportResult.dir}
                </code>
              </div>

              {hasKdenliveFile && (
                <Button
                  render={
                    <a href={kdenliveUrl} download="project.kdenlive" />
                  }
                  nativeButton={false}
                  size="xs"
                  variant="secondary"
                  className="gap-1.5"
                >
                  <FileCode2 className="size-3.5" />
                  project.kdenlive
                </Button>
              )}
            </div>

            {exportResult.missingScenes.length > 0 ? (
              <div className="rounded-xl border border-warning/40 bg-warning/10 p-3.5 text-xs text-warning">
                <div className="mb-1.5 flex items-center gap-1.5 font-medium">
                  <AlertTriangle className="size-4 shrink-0 text-warning" />
                  Missing active video clips (
                  {exportResult.missingScenes.length})
                </div>
                <ul className="list-disc space-y-0.5 pl-5 opacity-90">
                  {exportResult.missingScenes.map((title, idx) => (
                    <li key={`${title}-${idx}`}>{title}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-xl border border-success/40 bg-success/10 px-3.5 py-2.5 text-xs text-success">
                <CheckCircle2 className="size-4 shrink-0 text-success" />
                All scenes have active video clips included in the export.
              </div>
            )}

            {exportResult.files.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-muted-foreground">
                  Exported Files ({exportResult.files.length})
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {exportResult.files.map((file) => (
                    <Badge
                      key={file}
                      variant="outline"
                      className="font-mono text-[11px]"
                    >
                      {file}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="media-tile px-4 py-6 text-center text-xs text-muted-foreground">
            Click <strong>Rebuild Export</strong> to assemble the export folder
            and check for any missing scene clips, or click{" "}
            <strong>Download ZIP</strong> to package the latest export directly.
          </div>
        )}
      </div>
    </section>
  );
}
