import { eq } from "drizzle-orm";
import { z } from "zod";
import { customModels, getDb } from "@/db";
import {
  RouteError,
  apiOk,
  handleRouteError,
  parseJsonBody,
} from "@/lib/api/route-helpers";
import { getModelCapabilities } from "@/lib/providers/catalog";
import { capabilityPatchJson } from "@/lib/providers/model-inference";

const PatchModelSchema = z
  .object({
    displayName: z.string().trim().min(1).optional(),
    ignored: z.boolean().optional(),
    capabilities: z.record(z.string(), z.unknown()).optional(),
    resetCapabilities: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.displayName !== undefined ||
      value.ignored !== undefined ||
      value.capabilities !== undefined ||
      value.resetCapabilities === true,
    { message: "Provide at least one field to update." },
  )
  .refine(
    (value) => !(value.capabilities && value.resetCapabilities),
    {
      message: "capabilities and resetCapabilities cannot be combined.",
    },
  );

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const input = await parseJsonBody(req, PatchModelSchema);
    const db = getDb();

    const row = db
      .select()
      .from(customModels)
      .where(eq(customModels.id, id))
      .get();
    if (!row) {
      throw new RouteError("NOT_FOUND", "Model not found.", 404);
    }

    const patch: Partial<typeof customModels.$inferInsert> = {};
    if (input.displayName !== undefined) patch.displayName = input.displayName;
    if (input.ignored !== undefined) patch.ignored = input.ignored ? 1 : 0;
    if (input.capabilities !== undefined) {
      patch.capabilitiesJson = JSON.stringify(input.capabilities);
      patch.capabilitiesEdited = 1;
    }
    if (input.resetCapabilities) {
      patch.capabilitiesJson = capabilityPatchJson(row.modelId);
      patch.capabilitiesEdited = 0;
    }

    if (Object.keys(patch).length > 0) {
      db.update(customModels)
        .set(patch)
        .where(eq(customModels.id, id))
        .run();
    }

    const updated = db
      .select()
      .from(customModels)
      .where(eq(customModels.id, id))
      .get();

    let capabilities;
    try {
      capabilities = updated
        ? getModelCapabilities(updated.modelId, db.select().from(customModels).all())
        : undefined;
    } catch {
      capabilities = undefined;
    }

    return apiOk({ model: updated, capabilities });
  } catch (err) {
    return handleRouteError(err);
  }
}