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
} from "@/lib/api/route-helpers";
import { getConfig } from "@/lib/config";
import { enqueueJob } from "@/lib/jobs/runner";
import { getModelCapabilities } from "@/lib/providers/catalog";

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

    const modelId = input.modelId ?? getConfig().qwen.models.image;
    const cap = getModelCapabilities(modelId, getCustomModelRows());
    if (cap.modality !== "image") {
      throw new RouteError(
        "VALIDATION_ERROR",
        `Model "${modelId}" is not an image generation model.`,
        400,
      );
    }

    const basePrompt =
      input.prompt?.trim() ||
      [
        `Reference sheet for ${element.kind} "${element.name}".`,
        element.description.trim(),
        project.styleBible.trim() ? `Style: ${project.styleBible.trim()}` : "",
        "Clean neutral background, consistent design, high detail.",
      ]
        .filter(Boolean)
        .join("\n");

    const refPaths = input.referenceAssetPaths ?? [];
    const maxRefs =
      cap.maxReferenceImages ?? cap.maxCounts.reference_image ?? 0;
    const cappedRefs = refPaths.slice(0, maxRefs);

    const referenceImages = await Promise.all(
      cappedRefs.map((p) => prepareProjectImagePath(p, modelId, cappedRefs.length)),
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
        prompt: basePrompt,
        referenceImages,
        size: input.size,
        n: 1,
        needsOssHeader,
        params: { size: input.size },
      },
    });

    kickRunner();
    return apiOk({ job }, 202);
  } catch (err) {
    return handleRouteError(err);
  }
}
