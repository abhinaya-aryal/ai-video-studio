import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { CUSTOM_MODEL_MODALITIES, customModels, getDb } from "@/db";
import {
  RouteError,
  apiOk,
  getCustomModelRows,
  handleRouteError,
  parseJsonBody,
} from "@/lib/api/route-helpers";
import { listModelCapabilities } from "@/lib/providers/catalog";

const CreateCustomModelSchema = z.object({
  modelId: z.string().trim().min(1),
  displayName: z.string().trim().min(1),
  modality: z.enum(CUSTOM_MODEL_MODALITIES),
  family: z.string().trim().min(1),
  capabilities: z.record(z.string(), z.unknown()).optional(),
});

export async function GET() {
  try {
    const customRows = getCustomModelRows();
    return apiOk({
      models: listModelCapabilities(customRows),
      customModels: customRows,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST(req: Request) {
  try {
    const input = await parseJsonBody(req, CreateCustomModelSchema);
    const db = getDb();
    const capabilitiesJson = JSON.stringify(input.capabilities ?? {});

    const existing = db
      .select()
      .from(customModels)
      .where(eq(customModels.modelId, input.modelId))
      .get();

    if (existing) {
      db.update(customModels)
        .set({
          displayName: input.displayName,
          modality: input.modality,
          family: input.family,
          capabilitiesJson,
        })
        .where(eq(customModels.id, existing.id))
        .run();

      const updated = db
        .select()
        .from(customModels)
        .where(eq(customModels.id, existing.id))
        .get();
      return apiOk({ model: updated });
    }

    const row = {
      id: randomUUID(),
      modelId: input.modelId,
      displayName: input.displayName,
      modality: input.modality,
      family: input.family,
      capabilitiesJson,
    };
    db.insert(customModels).values(row).run();
    return apiOk({ model: row }, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    let id = url.searchParams.get("id")?.trim();
    let modelId = url.searchParams.get("modelId")?.trim();

    if (!id && !modelId) {
      try {
        const body = (await req.json()) as { id?: string; modelId?: string };
        id = body.id?.trim();
        modelId = body.modelId?.trim();
      } catch {
        // Ignore empty body
      }
    }

    if (!id && !modelId) {
      throw new RouteError(
        "VALIDATION_ERROR",
        "Provide id or modelId to delete a custom model.",
        400,
      );
    }

    const db = getDb();
    if (id) {
      db.delete(customModels).where(eq(customModels.id, id)).run();
    } else if (modelId) {
      db.delete(customModels).where(eq(customModels.modelId, modelId)).run();
    }

    return apiOk({ deleted: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
