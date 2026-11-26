import { z } from "zod";
import { MODEL_SLOTS, getDb, modelSelections } from "@/db";
import {
  RouteError,
  apiOk,
  handleRouteError,
  parseJsonBody,
} from "@/lib/api/route-helpers";
import {
  assertModelForSlot,
  resolveAllSlots,
} from "@/lib/providers/model-selection";

const SlotSelectionSchema = z
  .object({
    slot: z.enum(MODEL_SLOTS),
    mode: z.enum(["auto", "manual"]),
    modelId: z.string().trim().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mode === "manual" && !value.modelId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["modelId"],
        message: "modelId is required when mode is manual.",
      });
    }
  });

const UpdateSelectionsSchema = z.object({
  updates: z.array(SlotSelectionSchema).min(1).max(MODEL_SLOTS.length),
});

export function listSelections() {
  const db = getDb();
  return {
    selections: db.select().from(modelSelections).all(),
    resolved: resolveAllSlots(db),
  };
}

export async function PUT(req: Request) {
  try {
    const input = await parseJsonBody(req, UpdateSelectionsSchema);
    const db = getDb();

    for (const update of input.updates) {
      if (update.mode === "manual") {
        assertModelForSlot(db, update.slot, update.modelId!);
      }
      const updatedAt = Date.now();
      db.insert(modelSelections)
        .values({
          slot: update.slot,
          mode: update.mode,
          modelId: update.mode === "manual" ? update.modelId! : null,
          updatedAt,
        })
        .onConflictDoUpdate({
          target: modelSelections.slot,
          set: {
            mode: update.mode,
            modelId: update.mode === "manual" ? update.modelId! : null,
            updatedAt,
          },
        })
        .run();
    }

    return apiOk(listSelections());
  } catch (err) {
    if (err instanceof RouteError) return handleRouteError(err);
    return handleRouteError(err);
  }
}