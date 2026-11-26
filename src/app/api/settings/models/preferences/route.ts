import { z } from "zod";
import { AUTO_PRESETS, getDb } from "@/db";
import {
  apiOk,
  handleRouteError,
  parseJsonBody,
} from "@/lib/api/route-helpers";
import {
  getAutoPreset,
  resolveAllSlots,
  setAutoPreset,
} from "@/lib/providers/model-selection";

const PreferencesSchema = z.object({
  autoPreset: z.enum(AUTO_PRESETS),
});

export async function PUT(req: Request) {
  try {
    const input = await parseJsonBody(req, PreferencesSchema);
    const db = getDb();
    setAutoPreset(db, input.autoPreset);
    return apiOk({
      autoPreset: getAutoPreset(db),
      resolved: resolveAllSlots(db),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}