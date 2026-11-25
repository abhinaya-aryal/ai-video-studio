import { z } from "zod";
import {
  RouteError,
  apiOk,
  getCustomModelRows,
  handleRouteError,
  kickRunner,
  parseJsonBody,
  requireProject,
  requireScene,
} from "@/lib/api/route-helpers";
import { getConfig } from "@/lib/config";
import { enqueueJob } from "@/lib/jobs/runner";
import { getModelCapabilities } from "@/lib/providers/catalog";

const GenerateTtsSchema = z.object({
  projectId: z.string().trim().min(1),
  sceneId: z.string().trim().min(1).optional(),
  text: z.string().optional(),
  voice: z.string().trim().min(1).optional(),
  format: z.string().trim().min(1).default("mp3"),
  sampleRate: z.number().int().positive().optional(),
  modelId: z.string().trim().min(1).optional(),
});

export async function POST(req: Request) {
  try {
    const input = await parseJsonBody(req, GenerateTtsSchema);
    const project = requireProject(input.projectId);
    const scene = input.sceneId
      ? requireScene(input.projectId, input.sceneId)
      : undefined;

    const text = (input.text ?? scene?.audioScript ?? "").trim();
    if (!text) {
      throw new RouteError(
        "VALIDATION_ERROR",
        "TTS text must not be empty.",
        400,
      );
    }

    const modelId = input.modelId ?? getConfig().qwen.models.tts;
    const cap = getModelCapabilities(modelId, getCustomModelRows());
    if (cap.modality !== "audio") {
      throw new RouteError(
        "VALIDATION_ERROR",
        `Model "${modelId}" is not an audio TTS model.`,
        400,
      );
    }

    const job = enqueueJob({
      projectId: project.id,
      sceneId: scene?.id ?? null,
      modality: "audio",
      role: "voiceover",
      modelId,
      request: {
        modality: "audio",
        text,
        voice: input.voice,
        format: input.format,
        sampleRate: input.sampleRate,
        prompt: text,
        params: {
          voice: input.voice,
          format: input.format,
        },
      },
    });

    kickRunner();
    return apiOk({ job }, 202);
  } catch (err) {
    return handleRouteError(err);
  }
}
