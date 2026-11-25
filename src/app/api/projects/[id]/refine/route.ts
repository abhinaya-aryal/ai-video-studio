import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, projects, referenceElements, scenes } from "@/db";
import {
  RouteError,
  apiOk,
  handleRouteError,
  parseJsonBody,
  requireProject,
} from "@/lib/api/route-helpers";
import { getTextChat } from "@/lib/providers/text";
import {
  refineStoryAndScenes,
  resolveLinkedElementIds,
} from "@/lib/refiner/story-refiner";
import { slugify } from "@/lib/storage/paths";

const RefineProjectSchema = z
  .object({
    roughIdea: z.string().optional(),
    styleBible: z.string().optional(),
    targetSceneCount: z.number().int().min(1).max(30).optional(),
    confirm: z.boolean().optional(),
  })
  .default({});

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const project = requireProject(id);

    let input: z.infer<typeof RefineProjectSchema> = {};
    try {
      input = await parseJsonBody(req, RefineProjectSchema);
    } catch (err) {
      if (!(err instanceof RouteError && err.code === "INVALID_JSON")) {
        throw err;
      }
    }

    const roughIdea = (input.roughIdea ?? project.roughIdea).trim();
    if (!roughIdea) {
      throw new RouteError(
        "VALIDATION_ERROR",
        "Rough idea must not be empty to refine the story.",
        400,
      );
    }

    const db = getDb();
    const existingSceneIds = db
      .select({ id: scenes.id })
      .from(scenes)
      .where(eq(scenes.projectId, id))
      .all();
    const existingElementIds = db
      .select({ id: referenceElements.id })
      .from(referenceElements)
      .where(eq(referenceElements.projectId, id))
      .all();

    if (
      (existingSceneIds.length > 0 || existingElementIds.length > 0) &&
      input.confirm !== true
    ) {
      throw new RouteError(
        "CONFIRM_REQUIRED",
        "Re-running Auto-Refine replaces every scene and reference element, which orphans generated keyframes, clips, and takes. Send confirm: true to rebuild the storyboard.",
        409,
      );
    }

    const styleBible = input.styleBible ?? project.styleBible;
    const chat = getTextChat();
    const refined = await refineStoryAndScenes({
      roughIdea,
      styleBible,
      targetSceneCount: input.targetSceneCount,
      chat,
    });

    const now = Date.now();

    const savedElements = refined.elements.map((el) => ({
      id: randomUUID(),
      projectId: id,
      kind: el.kind,
      name: el.name,
      description: el.description,
      activeImagePath: null,
      createdAt: now,
      updatedAt: now,
    }));

    const resolved = resolveLinkedElementIds(refined.scenes, savedElements);
    const savedScenes = refined.scenes.map((scene, index) => {
      const linked = resolved.find((r) => r.sceneIndex === index);
      const nn = String(index + 1).padStart(2, "0");
      return {
        id: randomUUID(),
        projectId: id,
        orderIndex: index,
        slug: `${nn}-${slugify(scene.title)}`,
        title: scene.title,
        visualPrompt: scene.visualPrompt,
        cameraDirection: scene.cameraDirection,
        audioMode: scene.audioMode,
        audioScript: scene.audioScript,
        duration: scene.duration,
        videoMode: scene.videoMode,
        linkedElementIdsJson: JSON.stringify(linked?.ids ?? []),
        activeKeyframeFirstAssetId: null,
        activeKeyframeLastAssetId: null,
        activeVideoAssetId: null,
        activeAudioAssetId: null,
        createdAt: now,
        updatedAt: now,
      };
    });

    db.transaction((tx) => {
      tx.update(projects)
        .set({
          roughIdea,
          refinedStory: refined.refinedStory,
          styleBible: refined.styleBible || styleBible,
          updatedAt: now,
        })
        .where(eq(projects.id, id))
        .run();

      tx.delete(scenes).where(eq(scenes.projectId, id)).run();
      tx.delete(referenceElements)
        .where(eq(referenceElements.projectId, id))
        .run();

      if (savedElements.length > 0) {
        tx.insert(referenceElements).values(savedElements).run();
      }
      if (savedScenes.length > 0) {
        tx.insert(scenes).values(savedScenes).run();
      }
    });

    const updatedProject = requireProject(id);
    const warnings = resolved
      .filter((r) => r.unknownNames.length > 0)
      .map((r) => ({
        sceneIndex: r.sceneIndex,
        unknownElementNames: r.unknownNames,
      }));

    return apiOk({
      project: updatedProject,
      elements: savedElements,
      scenes: savedScenes,
      warnings,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
