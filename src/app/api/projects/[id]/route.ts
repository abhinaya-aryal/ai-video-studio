import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  assets,
  getDb,
  jobs,
  projects,
  referenceElements,
  scenes,
} from "@/db";
import {
  PUBLIC_JOB_COLUMNS,
  RouteError,
  apiOk,
  handleRouteError,
  parseJsonBody,
  requireProject,
} from "@/lib/api/route-helpers";
import { readProjectMedia } from "@/lib/storage/project-media";

const UpdateProjectSchema = z.object({
  title: z.string().trim().min(1).optional(),
  roughIdea: z.string().optional(),
  refinedStory: z.string().optional(),
  styleBible: z.string().optional(),
  stylePresetId: z.string().nullable().optional(),
  aspectRatio: z.string().trim().min(1).optional(),
  resolution: z.string().trim().min(1).optional(),
  defaultVideoModel: z.string().trim().min(1).optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const project = requireProject(id);
    const db = getDb();

    const projectElements = db
      .select()
      .from(referenceElements)
      .where(eq(referenceElements.projectId, id))
      .orderBy(asc(referenceElements.createdAt))
      .all();

    const projectScenes = db
      .select()
      .from(scenes)
      .where(eq(scenes.projectId, id))
      .orderBy(asc(scenes.orderIndex))
      .all();

    const projectAssets = db
      .select()
      .from(assets)
      .where(eq(assets.projectId, id))
      .orderBy(desc(assets.createdAt))
      .all();

    const projectJobs = db
      .select(PUBLIC_JOB_COLUMNS)
      .from(jobs)
      .where(eq(jobs.projectId, id))
      .orderBy(desc(jobs.createdAt))
      .all();

    return apiOk({
      project,
      elements: projectElements,
      scenes: projectScenes,
      assets: projectAssets,
      jobs: projectJobs,
      media: readProjectMedia(id),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    requireProject(id);
    const input = await parseJsonBody(req, UpdateProjectSchema);

    const db = getDb();
    db.update(projects)
      .set({
        ...input,
        updatedAt: Date.now(),
      })
      .where(eq(projects.id, id))
      .run();

    const updated = requireProject(id);
    return apiOk({ project: updated });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const project = requireProject(id);
    if (project.isHidden) {
      throw new RouteError(
        "PROJECT_PROTECTED",
        "The Quick Clips project is managed by the app and cannot be deleted.",
        409,
      );
    }

    // DB rows only. PROJECTS_DIR/<slug>/ is intentionally left on disk.
    getDb().delete(projects).where(eq(projects.id, id)).run();
    return apiOk({ deleted: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
