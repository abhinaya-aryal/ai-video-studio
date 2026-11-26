"use client";

import {
  FileAudio2,
  FileImage,
  FileVideo2,
  FolderOpen,
  Layers,
} from "lucide-react";
import type { Project } from "@/db/schema";
import { Badge } from "@/components/ui/badge";

interface ProjectMedia {
  dir: string;
  files: string[];
}

interface ProjectAssetsPanelProps {
  project: Project;
  media: ProjectMedia;
}

function FileIcon({ file }: { file: string }) {
  if (/\.(mp4|webm|mov)$/i.test(file)) {
    return <FileVideo2 className="size-3.5 shrink-0 text-primary" />;
  }
  if (/\.(mp3|wav|ogg)$/i.test(file)) {
    return <FileAudio2 className="size-3.5 shrink-0 text-muted-foreground" />;
  }
  return <FileImage className="size-3.5 shrink-0 text-muted-foreground" />;
}

/**
 * Shows the project folder where every generated image, clip, and voiceover is
 * mirrored as a flat file, ready to drag into Kdenlive.
 */
export function ProjectAssetsPanel({ project, media }: ProjectAssetsPanelProps) {
  return (
    <section className="panel overflow-hidden">
      <div className="prism-line" aria-hidden="true" />
      <div className="space-y-5 p-6">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
            <Layers className="size-4 text-primary" />
            Project Assets
          </h2>
          <p className="text-sm text-muted-foreground">
            Every generated keyframe, clip, voiceover, and element image is
            copied into your project folder as a flat file. Drop them into
            Kdenlive and build the edit your way.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface-2/40 px-3.5 py-2.5 text-xs">
          <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
          <span className="shrink-0 text-muted-foreground">Folder:</span>
          <code className="truncate font-mono text-foreground">{media.dir}</code>
        </div>

        {media.files.length > 0 ? (
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">
              Assets ({media.files.length})
            </div>
            <div className="flex max-h-64 flex-wrap gap-1.5 overflow-y-auto">
              {media.files.map((file) => (
                <Badge
                  key={file}
                  variant="outline"
                  className="gap-1.5 font-mono text-[11px]"
                >
                  <FileIcon file={file} />
                  {file}
                </Badge>
              ))}
            </div>
          </div>
        ) : (
          <div className="media-tile px-4 py-6 text-center text-xs text-muted-foreground">
            No media yet for <strong>{project.title}</strong>. Generate a
            keyframe, clip, voiceover, or element image and the flat file will
            appear in this folder automatically.
          </div>
        )}
      </div>
    </section>
  );
}