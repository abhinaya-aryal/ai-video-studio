import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, referenceElements, scenes } from "@/db";
import {
  apiOk,
  aspectRatioToImageSize,
  getCustomModelRows,
  handleRouteError,
  kickRunner,
  parseJsonBody,
  requireProject,
} from "@/lib/api/route-helpers";
import { SceneUploadsSchema } from "@/lib/api/scene-uploads";
import { enqueueJob } from "@/lib/jobs/runner";
import { getModelCapabilities } from "@/lib/providers/catalog";
import { resolveSlotModel } from "@/lib/providers/model-selection";
import {
  buildSceneKeyframeRequest,
  buildSceneVideoRequest,
  memoizeImagePreparer,
  prepareProjectImagePath,
  prepareProjectMediaPath,
} from "@/lib/studio/scene-request";

const BatchGenerateSchema = z.object({
  projectId: z.string().trim().min(1),
  kind: z.enum(["keyframes", "clips"]),
  sceneIds: z.array(z.string().trim().min(1)).min(1),
  confirm: z.boolean(),
  modelId: z.string().trim().min(1).optional(),
  uploadsByScene: z.record(z.string(), SceneUploadsSchema).optional(),
});

export async function POST(req: Request) {
  try {
    const input = await parseJsonBody(req, BatchGenerateSchema);
    const project = requireProject(input.projectId);
    const db = getDb();

    const targetScenes = db
      .select()
      .from(scenes)
      .where(
        and(
          eq(scenes.projectId, project.id),
          inArray(scenes.id, input.sceneIds),
        ),
      )
      .orderBy(asc(scenes.orderIndex))
      .all();

    const model =
      input.kind === "keyframes"
        ? resolveSlotModel(db, "image", { explicitModelId: input.modelId }).modelId
        : resolveSlotModel(db, "video", {
            explicitModelId: input.modelId,
            projectModelId: project.defaultVideoModel,
          }).modelId;
    const resolution =
      input.kind === "keyframes"
        ? aspectRatioToImageSize(project.aspectRatio)
        : project.resolution;

    const count = targetScenes.length;
    const totalSeconds = targetScenes.reduce((sum, s) => sum + s.duration, 0);

    if (!input.confirm) {
      return apiOk({
        count,
        totalSeconds,
        resolution,
        model,
      });
    }

    const cap = getModelCapabilities(model, getCustomModelRows());
    const elements = db
      .select()
      .from(referenceElements)
      .where(eq(referenceElements.projectId, project.id))
      .all();

    // Shared across the batch so a linked element image is prepared once,
    // not once per scene.
    const prepareImage = memoizeImagePreparer((filePath, count) =>
      prepareProjectImagePath(filePath, model, count),
    );
    const prepareMedia = (filePath: string) =>
      prepareProjectMediaPath(filePath, model);

    const builtByScene = await Promise.all(
      targetScenes.map(async (scene) => {
        if (input.kind === "keyframes") {
          return {
            scene,
            ...(await buildSceneKeyframeRequest(
              scene,
              elements,
              project,
              cap,
              { position: "first", size: resolution },
              { prepareImage },
            )),
          };
        }
        return {
          scene,
          ...(await buildSceneVideoRequest(scene, elements, project, cap, {
            uploads: input.uploadsByScene?.[scene.id],
            prepareImage,
            prepareMedia,
          })),
        };
      }),
    );

    const enqueuedJobs = [];
    const droppedElementsByScene: Record<string, string[]> = {};

    for (const { scene, payload, droppedElements } of builtByScene) {
      if (droppedElements.length > 0) {
        droppedElementsByScene[scene.id] = droppedElements;
      }
      enqueuedJobs.push(
        enqueueJob({
          projectId: project.id,
          sceneId: scene.id,
          modality: input.kind === "keyframes" ? "image" : "video",
          role: input.kind === "keyframes" ? "keyframe_first" : "video_clip",
          modelId: model,
          request: payload,
        }),
      );
    }

    kickRunner();
    return apiOk(
      {
        count,
        totalSeconds,
        resolution,
        model,
        jobs: enqueuedJobs,
        droppedElementsByScene,
      },
      202,
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
