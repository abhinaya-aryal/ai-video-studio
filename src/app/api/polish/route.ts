import { z } from "zod";
import { AUDIO_MODES } from "@/db";
import {
  apiOk,
  handleRouteError,
  parseJsonBody,
} from "@/lib/api/route-helpers";
import { getTextChat } from "@/lib/providers/text";
import { polishPrompt } from "@/lib/refiner/story-refiner";

const PolishSchema = z.object({
  text: z.string().trim().min(1),
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
    const chat = getTextChat();
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
