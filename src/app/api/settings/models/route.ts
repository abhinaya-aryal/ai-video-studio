import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { CUSTOM_MODEL_MODALITIES, customModels, getDb, modelSelections } from "@/db";
import {
  RouteError,
  apiOk,
  getCustomModelRows,
  handleRouteError,
  parseJsonBody,
} from "@/lib/api/route-helpers";
import { getConfig } from "@/lib/config";
import { getModelCapabilities } from "@/lib/providers/catalog";
import {
  getAutoPreset,
  resolveAllSlots,
} from "@/lib/providers/model-selection";
import { syncProviderModels } from "@/lib/providers/model-sync";

const CreateCustomModelSchema = z.object({
  modelId: z.string().trim().min(1),
  displayName: z.string().trim().min(1),
  modality: z.enum(CUSTOM_MODEL_MODALITIES),
  family: z.string().trim().min(1),
  capabilities: z.record(z.string(), z.unknown()).optional(),
});

export async function GET() {
  try {
    const db = getDb();
    let syncWarning: string | null = null;

    const before = getCustomModelRows();
    const hasDiscovered = before.some((row) => row.source === "discovered");
    if (!hasDiscovered && getConfig().qwen.apiKey) {
      try {
        await syncProviderModels({ db });
      } catch (err) {
        syncWarning =
          err instanceof Error ? err.message : "Model sync failed.";
      }
    }

    const rows = getCustomModelRows();
    const models = rows.map((row) => {
      let capabilities;
      try {
        capabilities = getModelCapabilities(row.modelId, rows);
      } catch {
        capabilities = undefined;
      }
      return {
        id: row.id,
        modelId: row.modelId,
        displayName: row.displayName,
        modality: row.modality,
        family: row.family,
        source: row.source,
        providerCreatedAt: row.providerCreatedAt,
        lastSeenAt: row.lastSeenAt,
        available: row.available === 1,
        ignored: row.ignored === 1,
        capabilitiesEdited: row.capabilitiesEdited === 1,
        capabilitiesJson: row.capabilitiesJson,
        ...(capabilities ?? {}),
      };
    });

    const lastSyncedAt = rows.reduce(
      (latest, row) => Math.max(latest, row.lastSeenAt ?? 0),
      0,
    );

    return apiOk({
      models,
      customModels: rows,
      selections: db.select().from(modelSelections).all(),
      resolved: resolveAllSlots(db),
      autoPreset: getAutoPreset(db),
      lastSyncedAt: lastSyncedAt || null,
      syncWarning,
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
          capabilitiesEdited: 1,
          ignored: 0,
          available: 1,
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
      source: "manual" as const,
      available: 1,
      ignored: 0,
      capabilitiesEdited: 1,
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
    const row = id
      ? db.select().from(customModels).where(eq(customModels.id, id)).get()
      : db
          .select()
          .from(customModels)
          .where(eq(customModels.modelId, modelId!))
          .get();

    if (!row) {
      throw new RouteError("NOT_FOUND", "Model not found.", 404);
    }

    if (row.source === "discovered") {
      db.update(customModels)
        .set({ ignored: 1 })
        .where(eq(customModels.id, row.id))
        .run();
      return apiOk({ deleted: false, ignored: true });
    }

    db.delete(customModels).where(eq(customModels.id, row.id)).run();
    return apiOk({ deleted: true, ignored: false });
  } catch (err) {
    return handleRouteError(err);
  }
}
