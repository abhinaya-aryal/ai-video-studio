import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { QUICK_CLIPS_SLUG, getDb, projects } from "@/db";
import {
  apiOk,
  handleRouteError,
  parseJsonBody,
} from "@/lib/api/route-helpers";
import { getConfig } from "@/lib/config";
import { assertModelForSlot } from "@/lib/providers/model-selection";
import { ensureProjectDirs, slugify } from "@/lib/storage/paths";

const CreateProjectSchema = z.object({
  title: z.string().trim().min(1),
  roughIdea: z.string().default(""),
  styleBible: z.string().default(""),
  stylePresetId: z.string().nullable().optional(),
  aspectRatio: z.string().trim().min(1).default("16:9"),
  resolution: z.string().trim().min(1).default("720P"),
  defaultVideoModel: z.string().trim().min(1).optional(),
});

function resolveUniqueSlug(title: string): string {
  const db = getDb();
  const base = slugify(title);
  const candidate = base === QUICK_CLIPS_SLUG ? `${base}-project` : base;

  const existing = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, candidate))
    .get();

  // `PROJECTS_DIR` may already hold folders from earlier work, so never
  // create a project that would write into an unregistered directory.
  const existingDir = existsSync(path.join(getConfig().projectsDir, candidate));

  if (!existing && !existingDir) {
    return candidate;
  }

  return `${candidate}-${randomUUID().slice(0, 6)}`;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const includeHidden = url.searchParams.get("includeHidden") === "1";
    const db = getDb();

    const rows = includeHidden
      ? db.select().from(projects).orderBy(desc(projects.updatedAt)).all()
      : db
          .select()
          .from(projects)
          .where(eq(projects.isHidden, 0))
          .orderBy(desc(projects.updatedAt))
          .all();

    return apiOk({ projects: rows });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST(req: Request) {
  try {
    const input = await parseJsonBody(req, CreateProjectSchema);
    const db = getDb();
    const now = Date.now();
    const slug = resolveUniqueSlug(input.title);

    const defaultVideoModel = input.defaultVideoModel?.trim() || null;
    if (defaultVideoModel) {
      assertModelForSlot(db, "video", defaultVideoModel);
    }

    const project = {
      id: randomUUID(),
      slug,
      title: input.title,
      roughIdea: input.roughIdea,
      refinedStory: "",
      styleBible: input.styleBible,
      stylePresetId: input.stylePresetId ?? null,
      aspectRatio: input.aspectRatio,
      resolution: input.resolution,
      defaultVideoModel,
      isHidden: 0,
      createdAt: now,
      updatedAt: now,
    };

    db.insert(projects).values(project).run();
    ensureProjectDirs(slug);

    return apiOk({ project }, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
