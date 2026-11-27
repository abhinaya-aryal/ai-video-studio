import { randomUUID } from "node:crypto";
import fs from "node:fs";
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
import { getGeminiModelCapabilities } from "@/lib/providers/media";
import {
  getAutoPreset,
  resolveAllSlots,
} from "@/lib/providers/model-selection";
import { syncProviderModels } from "@/lib/providers/model-sync";
import {
  fetchAndCacheExternalProviderModels,
  normalizeCachedProviderItems,
  readProviderModelsCache,
} from "@/lib/settings/provider-models";
import { settingsFilePath } from "@/lib/settings/store";

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

    const cfg = getConfig();
    const uiManaged = fs.existsSync(settingsFilePath(cfg.dataDir));
    const qwenProvider = (cfg.providers ?? []).find(
      (p) => p.kind === "qwen" && p.enabled,
    );
    const includeQwenModels = !uiManaged || Boolean(qwenProvider && cfg.qwen.apiKey);
    const qwenProviderName = qwenProvider?.name ?? "QwenCloud";

    const rows = includeQwenModels ? getCustomModelRows() : [];
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
        providerId: qwenProvider?.id ?? "qwen",
        providerName: qwenProviderName,
        providerKind: "qwen" as const,
        providerCreatedAt: row.providerCreatedAt,
        lastSeenAt: row.lastSeenAt,
        available: row.available === 1,
        ignored: row.ignored === 1,
        capabilitiesEdited: row.capabilitiesEdited === 1,
        capabilitiesJson: row.capabilitiesJson,
        ...(capabilities ?? {}),
      };
    });

    let extCache = readProviderModelsCache(cfg.dataDir);
    const uncachedExternals = (cfg.providers ?? []).filter((p) => {
      if ((p.kind !== "gemini" && p.kind !== "openai_compat") || !p.enabled) {
        return false;
      }
      const entry = extCache[p.id];
      if (!entry) return true;
      // Upgrade legacy Gemini string-only caches so image/video/audio models appear.
      if (p.kind === "gemini" && !Array.isArray(entry.items)) return true;
      return false;
    });
    if (uncachedExternals.length > 0) {
      for (const provider of uncachedExternals) {
        try {
          await fetchAndCacheExternalProviderModels(cfg.dataDir, provider);
        } catch (err) {
          const msg = `${provider.name}: ${err instanceof Error ? err.message : "sync failed"}`;
          syncWarning = syncWarning ? `${syncWarning}; ${msg}` : msg;
        }
      }
      extCache = readProviderModelsCache(cfg.dataDir);
    }

    const externalModels = (cfg.providers ?? [])
      .filter(
        (p) => (p.kind === "gemini" || p.kind === "openai_compat") && p.enabled,
      )
      .flatMap((provider) => {
        const entry = extCache[provider.id];
        const items = normalizeCachedProviderItems(entry);
        return items.map((item) => {
          const mediaCaps =
            provider.kind === "gemini" && item.modality !== "text"
              ? getGeminiModelCapabilities(item.modelId, item.modality)
              : undefined;
          return {
            id: `ext:${provider.id}:${item.modelId}`,
            modelId: item.modelId,
            displayName: item.displayName ?? item.modelId,
            modality: item.modality,
            family: provider.preset ?? provider.kind,
            source: "discovered" as const,
            providerId: provider.id,
            providerName: provider.name,
            providerKind: provider.kind,
            providerCreatedAt: null,
            lastSeenAt: entry?.syncedAt ?? null,
            available: true,
            ignored: false,
            capabilitiesEdited: false,
            capabilitiesJson: "{}",
            ttsCapable: item.ttsCapable ?? item.modality === "audio",
            ...(mediaCaps ?? {}),
          };
        });
      });

    const qwenLastSyncedAt = rows.reduce(
      (latest, row) => Math.max(latest, row.lastSeenAt ?? 0),
      0,
    );
    const extLastSyncedAt = Object.values(extCache).reduce(
      (latest, entry) => Math.max(latest, entry.syncedAt ?? 0),
      0,
    );
    const lastSyncedAt = Math.max(qwenLastSyncedAt, extLastSyncedAt);

    const selections = includeQwenModels
      ? db.select().from(modelSelections).all()
      : [];

    return apiOk({
      models,
      externalModels,
      customModels: rows,
      selections,
      resolved: includeQwenModels ? resolveAllSlots(db) : [],
      roleProviders: cfg.roleProviders ?? {},
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
