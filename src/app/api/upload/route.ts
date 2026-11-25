import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import {
  getDb,
  getOrCreateQuickClipProject,
  referenceElements,
} from "@/db";
import {
  RouteError,
  apiOk,
  handleRouteError,
  requireProject,
} from "@/lib/api/route-helpers";
import { ensureProjectDirs, slugify } from "@/lib/storage/paths";

function sanitizeExtension(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (/^\.[a-z0-9]{1,8}$/.test(ext)) {
    return ext;
  }
  return ".bin";
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new RouteError(
        "VALIDATION_ERROR",
        "A non-empty file field is required.",
        400,
      );
    }

    const rawProjectId = formData.get("projectId");
    const projectId =
      typeof rawProjectId === "string" && rawProjectId.trim().length > 0
        ? rawProjectId.trim()
        : undefined;
    const project = projectId
      ? requireProject(projectId)
      : getOrCreateQuickClipProject();

    const dirs = ensureProjectDirs(project.slug);
    const baseName = path.basename(
      file.name || "upload",
      path.extname(file.name || ""),
    );
    const ext = sanitizeExtension(file.name || "upload.png");
    const safeFilename = `${randomUUID().slice(0, 8)}-${slugify(baseName)}${ext}`;
    const absTarget = path.join(dirs.elements, safeFilename);
    const relPath = `${project.slug}/elements/${safeFilename}`;

    const bytes = new Uint8Array(await file.arrayBuffer());
    writeFileSync(absTarget, bytes);

    const rawElementId = formData.get("elementId");
    const elementId =
      typeof rawElementId === "string" && rawElementId.trim().length > 0
        ? rawElementId.trim()
        : undefined;

    if (elementId) {
      getDb()
        .update(referenceElements)
        .set({ activeImagePath: relPath, updatedAt: Date.now() })
        .where(
          and(
            eq(referenceElements.id, elementId),
            eq(referenceElements.projectId, project.id),
          ),
        )
        .run();
    }

    return apiOk(
      {
        filePath: relPath,
        url: `/api/files/${relPath}`,
        projectId: project.id,
      },
      201,
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
