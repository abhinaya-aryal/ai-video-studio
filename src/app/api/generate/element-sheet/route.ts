import { z } from "zod";
import {
  RouteError,
  apiOk,
  getCustomModelRows,
  handleRouteError,
  kickRunner,
  parseJsonBody,
  prepareProjectImagePath,
  requireElement,
  requireProject,
  toPublicJob,
} from "@/lib/api/route-helpers";
import { enqueueJob } from "@/lib/jobs/runner";
import {
  prepareGeminiImageDataUri,
  resolveMediaTarget,
} from "@/lib/providers/media";
import { resolveElementImagePrompt } from "@/lib/studio/element-image";
import { stableSeed } from "@/lib/studio/seed";

const ElementSheetSchema = z.object({
  projectId: z.string().trim().min(1),
  elementId: z.string().trim().min(1),
  modelId: z.string().trim().min(1).optional(),
  prompt: z.string().optional(),
  size: z.string().trim().min(1).default("1024*1024"),
  referenceAssetPaths: z.array(z.string().min(1)).optional(),
});

export async function POST(req: Request) {
  try {
    const input = await parseJsonBody(req, ElementSheetSchema);
    const project = requireProject(input.projectId);
    const element = requireElement(input.projectId, input.elementId);

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

    const basePrompt = resolveElementImagePrompt(
      element,
      project.styleBible,
      project.refinedStory || project.roughIdea,
      input.prompt,
    );

    const refPaths = input.referenceAssetPaths ?? [];
    const maxRefs =
      cap.maxReferenceImages ?? cap.maxCounts.reference_image ?? 0;
    const cappedRefs = refPaths.slice(0, maxRefs);

    const referenceImages = await Promise.all(
      cappedRefs.map((p) =>
        target.providerKind === "gemini"
          ? prepareGeminiImageDataUri(p)
          : prepareProjectImagePath(p, modelId, cappedRefs.length),
      ),
    );
    const needsOssHeader = referenceImages.some((u) => u.startsWith("oss://"));

    const job = enqueueJob({
      projectId: project.id,
      elementId: element.id,
      modality: "image",
      role: "element_sheet",
      modelId,
      request: {
        modality: "image",
        ...(target.providerKind === "gemini"
          ? { providerKind: "gemini" as const, providerId: target.providerId }
          : {}),
        prompt: basePrompt,
        referenceImages,
        size: input.size,
        n: 1,
        thinkingMode: false,
        seed: stableSeed("element", project.id, element.id),
        needsOssHeader,
        params: { size: input.size },
      },
    });

    kickRunner();
    return apiOk({ job: toPublicJob(job) }, 202);
  } catch (err) {
    return handleRouteError(err);
  }
}
