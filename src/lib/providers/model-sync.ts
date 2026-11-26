import { randomUUID } from "node:crypto";
import { and, eq, notInArray } from "drizzle-orm";
import type { DrizzleDb } from "@/db";
import { getDb } from "@/db";
import { customModels } from "@/db/schema";
import { getConfig } from "@/lib/config";
import { parseProviderErrorResponse } from "@/lib/providers/errors";
import { inferModel, capabilityPatchJson } from "@/lib/providers/model-inference";
import { resolveQwenBaseUrl } from "@/lib/providers/qwen-endpoints";

export class ModelSyncError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 409) {
    super(message);
    this.name = "ModelSyncError";
    this.code = code;
    this.status = status;
  }
}

export interface SyncResult {
  added: number;
  updated: number;
  unavailable: number;
  total: number;
  lastSyncedAt: number;
}

interface ProviderModel {
  id: string;
  created?: number;
}

function capabilityPatch(modelId: string): string {
  return capabilityPatchJson(modelId);
}

function upsertModel(
  db: DrizzleDb,
  model: ProviderModel,
  now: number,
): "added" | "updated" {
  const inferred = inferModel(model.id);
  const existing = db
    .select()
    .from(customModels)
    .where(eq(customModels.modelId, model.id))
    .get();

  if (existing) {
    const keepRules = existing.source === "manual" || existing.capabilitiesEdited === 1;
    db.update(customModels)
      .set({
        lastSeenAt: now,
        providerCreatedAt: model.created ?? null,
        available: 1,
        ...(keepRules
          ? {}
          : {
              modality: inferred.modality,
              family: inferred.family,
              capabilitiesJson: capabilityPatch(model.id),
            }),
      })
      .where(eq(customModels.id, existing.id))
      .run();
    return "updated";
  }

  db.insert(customModels)
    .values({
      id: randomUUID(),
      modelId: model.id,
      displayName: model.id,
      modality: inferred.modality,
      family: inferred.family,
      capabilitiesJson: capabilityPatch(model.id),
      source: "discovered",
      providerCreatedAt: model.created ?? null,
      lastSeenAt: now,
      available: 1,
      ignored: 0,
      capabilitiesEdited: 0,
    })
    .run();
  return "added";
}

/**
 * Fetch the token's model list and reconcile it with the local registry.
 * Calls the metadata endpoint only; no model is invoked and no tokens are
 * billed. Manual rows keep their source and capabilities.
 */
export async function syncProviderModels({
  fetchFn = fetch,
  db = getDb(),
}: {
  fetchFn?: typeof fetch;
  db?: DrizzleDb;
} = {}): Promise<SyncResult> {
  const cfg = getConfig();
  const apiKey = cfg.qwen.apiKey?.trim();
  if (!apiKey) {
    throw new ModelSyncError(
      "API_KEY_MISSING",
      "QWEN_API_KEY is not configured. Add it to .env.local before syncing models.",
    );
  }

  const base = resolveQwenBaseUrl(cfg.qwen);
  const res = await fetchFn(`${base}/compatible-mode/v1/models`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    throw await parseProviderErrorResponse(res);
  }

  const json = (await res.json()) as { data?: Array<{ id?: unknown; created?: unknown }> };
  const models: ProviderModel[] = Array.isArray(json.data)
    ? json.data.flatMap((entry) =>
        typeof entry?.id === "string" && entry.id.trim().length > 0
          ? [
              {
                id: entry.id,
                created:
                  typeof entry.created === "number" ? entry.created : undefined,
              },
            ]
          : [],
      )
    : [];

  const now = Date.now();
  let added = 0;
  let updated = 0;
  for (const model of models) {
    if (upsertModel(db, model, now) === "added") added += 1;
    else updated += 1;
  }

  const seen = models.map((model) => model.id);
  const stale = db
    .select({ id: customModels.id })
    .from(customModels)
    .where(
      seen.length > 0
        ? and(
            eq(customModels.source, "discovered"),
            notInArray(customModels.modelId, seen),
          )
        : eq(customModels.source, "discovered"),
    )
    .all();

  let unavailable = 0;
  for (const row of stale) {
    const result = db
      .update(customModels)
      .set({ available: 0 })
      .where(eq(customModels.id, row.id))
      .run();
    unavailable += result.changes;
  }

  return { added, updated, unavailable, total: models.length, lastSyncedAt: now };
}