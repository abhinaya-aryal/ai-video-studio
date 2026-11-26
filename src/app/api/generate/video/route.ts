import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  AUDIO_MODES,
  getDb,
  getOrCreateQuickClipProject,
  referenceElements,
} from "@/db";
import {
  apiOk,
  getCustomModelRows,
  handleRouteError,
  kickRunner,
  parseJsonBody,
  prepareProjectImagePath,
  requireProject,
  requireScene,
} from "@/lib/api/route-helpers";
import { SceneUploadsSchema } from "@/lib/api/scene-uploads";
import { enqueueJob } from "@/lib/jobs/runner";
import { getModelCapabilities } from "@/lib/providers/catalog";
import { resolveSlotModel } from "@/lib/providers/model-selection";
import { MEDIA_TYPES } from "@/lib/providers/types";
import { buildVideoSynthesisPayload } from "@/lib/providers/wan-payload";
import { buildSceneVideoRequest } from "@/lib/studio/scene-request";

const SceneVideoSchema = z.object({
  projectId: z.string().trim().min(1),
  sceneId: z.string().trim().min(1),
  modelId: z.string().trim().min(1).optional(),
  uploads: SceneUploadsSchema.optional(),
});

const DirectVideoSchema = z.object({
  projectId: z.string().trim().min(1).optional(),
  modelId: z.string().trim().min(1).optional(),
  prompt: z.string().trim().min(1),
  media: z
    .array(
      z.object({
        type: z.enum(MEDIA_TYPES),
        url: z.string().trim().min(1),
      }),
    )
    .default([]),
  duration: z.number().int().default(5),
  resolution: z.string().trim().min(1).default("720P"),
  ratio: z.string().trim().min(1).default("16:9"),
  audio: z.boolean().optional(),
  audioMode: z.enum(AUDIO_MODES).optional(),
  promptExtend: z.boolean().optional(),
});

const GenerateVideoSchema = z.union([SceneVideoSchema, DirectVideoSchema]);

const IMAGE_MEDIA_TYPES = new Set([
  "first_frame",
  "last_frame",
  "reference_image",
]);

export async function POST(req: Request) {
  try {
    const input = await parseJsonBody(req, GenerateVideoSchema);
    const customRows = getCustomModelRows();

    if ("sceneId" in input) {
      const project = requireProject(input.projectId);
      const scene = requireScene(input.projectId, input.sceneId);
      const modelId = resolveSlotModel(getDb(), "video", {
        explicitModelId: input.modelId,
        projectModelId: project.defaultVideoModel,
      }).modelId;
      const cap = getModelCapabilities(modelId, customRows);

      const elements = getDb()
        .select()
        .from(referenceElements)
        .where(eq(referenceElements.projectId, project.id))
        .all();

      const { payload, droppedElements } = await buildSceneVideoRequest(
        scene,
        elements,
        project,
        cap,
        { uploads: input.uploads },
      );

      const job = enqueueJob({
        projectId: project.id,
        sceneId: scene.id,
        modality: "video",
        role: "video_clip",
        modelId,
        request: payload,
      });

      kickRunner();
      return apiOk({ job, droppedElements }, 202);
    }

    const project = input.projectId
      ? requireProject(input.projectId)
      : getOrCreateQuickClipProject();
    const role = input.projectId ? "video_clip" : "quick_clip";
    const modelId = resolveSlotModel(getDb(), "video", {
      explicitModelId: input.modelId,
      projectModelId: project.defaultVideoModel,
    }).modelId;
    const cap = getModelCapabilities(modelId, customRows);

    const imageCount = input.media.filter((m) =>
      IMAGE_MEDIA_TYPES.has(m.type),
    ).length;
    const preparedMedia = await Promise.all(
      input.media.map(async (item) => ({
        type: item.type,
        url: IMAGE_MEDIA_TYPES.has(item.type)
          ? await prepareProjectImagePath(item.url, modelId, imageCount)
          : item.url,
      })),
    );

    const audio =
      input.audio !== undefined
        ? input.audio
        : input.audioMode !== undefined
          ? input.audioMode !== "silent"
          : true;

    const { body, needsOssHeader } = buildVideoSynthesisPayload(
      {
        modelId,
        prompt: input.prompt,
        audio,
        media: preparedMedia,
        duration: input.duration,
        resolution: input.resolution,
        ratio: input.ratio,
        promptExtend: input.promptExtend,
      },
      cap,
    );

    const job = enqueueJob({
      projectId: project.id,
      modality: "video",
      role,
      modelId,
      request: {
        modality: "video",
        body,
        needsOssHeader,
        prompt: input.prompt,
        params: {
          resolution: input.resolution,
          ratio: input.ratio,
          duration: input.duration,
        },
      },
    });

    kickRunner();
    return apiOk({ job }, 202);
  } catch (err) {
    return handleRouteError(err);
  }
}
