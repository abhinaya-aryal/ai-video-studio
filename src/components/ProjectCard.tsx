import Link from "next/link";
import type { Project } from "@/db/schema";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ProjectCardProps {
  project: Project;
  featured?: boolean;
}

export function ProjectCard({ project, featured = false }: ProjectCardProps) {
  return (
    <Link
      href={`/projects/${project.id}`}
      className={cn(
        "group block h-full rounded-[var(--radius)] outline-none focus-visible:ring-2 focus-visible:ring-ring",
        featured && "lg:col-span-2",
      )}
    >
      <article
        className={cn(
          "panel panel-glow panel-hover flex h-full flex-col justify-between gap-4 p-6",
          featured && "panel-featured",
        )}
      >
        <div className="relative z-10 min-w-0 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Badge variant="outline" className="text-[11px] font-mono">
              {project.aspectRatio} · {project.resolution}
            </Badge>
            {featured && (
              <Badge className="prism-badge text-[11px]">
                Latest
              </Badge>
            )}
          </div>

          <div className="min-w-0 space-y-1">
            <h2 className="line-clamp-1 text-lg font-semibold tracking-tight text-foreground group-hover:text-primary transition-colors">
              {project.title}
            </h2>
            <p className="truncate font-mono text-xs text-subtle-foreground">
              {project.slug}
            </p>
          </div>

          <p className="line-clamp-2 min-h-[2.5rem] text-sm text-muted-foreground">
            {project.roughIdea || project.refinedStory || "No synopsis yet."}
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border pt-3 text-xs text-muted-foreground">
          <span className="truncate rounded-full border border-border bg-surface-2/70 px-2.5 py-0.5 font-mono text-[11px] text-foreground">
            {project.defaultVideoModel}
          </span>
          <span className="shrink-0 tabular-nums text-[11px] text-subtle-foreground">
            {new Date(project.updatedAt).toLocaleDateString()}
          </span>
        </div>
      </article>
    </Link>
  );
}
