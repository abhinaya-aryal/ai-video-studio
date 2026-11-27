import { z } from "zod";
import { AUDIO_MODES, getDb } from "@/db";
import {
  apiOk,
  handleRouteError,
  parseJsonBody,
} from "@/lib/api/route-helpers";
import { getConfig } from "@/lib/config";
import { getTextChat, resolveTextTarget } from "@/lib/providers/text";
import { polishPrompt } from "@/lib/refiner/story-refiner";
import { recordUsage } from "@/lib/usage/record";

const PolishSchema = z.object({
  text: z.string().trim().min(1),
  projectId: z.string().trim().min(1).optional(),
  context: z
    .object({
      styleBible: z.string().optional(),
      audioMode: z.enum(AUDIO_MODES).optional(),
      cameraDirection: z.string().optional(),
    })
    .optional(),
});

export async function POST(req: Request) {
  try {
    const input = await parseJsonBody(req, PolishSchema);
    const db = getDb();
    const cfg = getConfig();
    const target = resolveTextTarget(cfg, db, "text_polish");
    const chat = getTextChat(cfg, fetch, {
      role: "text_polish",
      onUsage: (usage) =>
        recordUsage(db, {
          projectId: input.projectId ?? null,
          modality: "text",
          modelId: target.modelId,
          ...usage,
        }),
    });
    const polished = await polishPrompt({
      text: input.text,
      context: input.context,
      chat,
    });
    return apiOk({ polished });
  } catch (err) {
    return handleRouteError(err);
  }
}