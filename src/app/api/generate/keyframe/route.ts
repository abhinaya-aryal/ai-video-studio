import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, referenceElements } from "@/db";
import {
  RouteError,
  apiOk,
  getCustomModelRows,
  handleRouteError,
  kickRunner,
  parseJsonBody,
  requireProject,
  requireScene,
  toPublicJob,
} from "@/lib/api/route-helpers";
import { enqueueJob } from "@/lib/jobs/runner";
import {
  prepareGeminiImageDataUri,
  resolveMediaTarget,
} from "@/lib/providers/media";
import { buildSceneKeyframeRequest } from "@/lib/studio/scene-request";

const GenerateKeyframeSchema = z.object({
  projectId: z.string().trim().min(1),
  sceneId: z.string().trim().min(1),
  position: z.enum(["first", "last"]).default("first"),
  modelId: z.string().trim().min(1).optional(),
  prompt: z.string().optional(),
  size: z.string().trim().min(1).optional(),
  referenceElementIds: z.array(z.string()).optional(),
});

export async function POST(req: Request) {
  try {
    const input = await parseJsonBody(req, GenerateKeyframeSchema);
    const project = requireProject(input.projectId);
    const scene = requireScene(input.projectId, input.sceneId);

    const target = resolveMediaTarget(
      "image",
      { explicitModelId: input.modelId },
      getCustomModelRows(),
    );
    const modelId = target.modelId;
    const cap = target.capabilities;
    if (cap.modality !== "image") {
      throw new RouteError(
        "VALIDATION_ERROR",
        `Model "${modelId}" is not an image generation model.`,
        400,
      );
    }

    const elements = getDb()
      .select()
      .from(referenceElements)
      .where(eq(referenceElements.projectId, project.id))
      .all();

    const { payload, droppedElements } = await buildSceneKeyframeRequest(
      scene,
      elements,
      project,
      cap,
      {
        position: input.position,
        promptOverride: input.prompt,
        size: input.size,
        referenceElementIds: input.referenceElementIds,
      },
      target.providerKind === "gemini"
        ? { prepareImage: (p) => prepareGeminiImageDataUri(p) }
        : undefined,
    );

    const job = enqueueJob({
      projectId: project.id,
      sceneId: scene.id,
      modality: "image",
      role: input.position === "last" ? "keyframe_last" : "keyframe_first",
      modelId,
      request: {
        ...payload,
        ...(target.providerKind === "gemini"
          ? { providerKind: "gemini" as const, providerId: target.providerId }
          : {}),
      },
    });

    kickRunner();
    return apiOk({ job: toPublicJob(job), droppedElements }, 202);
  } catch (err) {
    return handleRouteError(err);
  }
}
