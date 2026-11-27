import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { parseProviderErrorResponse } from "@/lib/providers/errors";
import { listGeminiModels } from "@/lib/providers/gemini-client";
import type { ModelModality } from "@/lib/providers/types";
import {
  type StoredProvider,
  readCredentialsFile,
  readSettingsFile,
} from "@/lib/settings/store";

export const DiscoveredProviderModelSchema = z.object({
  modelId: z.string().trim().min(1),
  displayName: z.string().trim().min(1).optional(),
  modality: z.enum(["text", "image", "video", "audio"]).default("text"),
  ttsCapable: z.boolean().optional(),
  supportedActions: z.array(z.string()).optional(),
});

export type DiscoveredProviderModel = z.infer<
  typeof DiscoveredProviderModelSchema
>;

const ProviderModelsEntrySchema = z.object({
  models: z.array(z.string()),
  items: z.array(DiscoveredProviderModelSchema).optional(),
  syncedAt: z.number(),
});

const ProviderModelsCacheSchema = z.object({
  version: z.literal(1).default(1),
  byProvider: z.record(z.string(), ProviderModelsEntrySchema).default({}),
});

export type ProviderModelsCache = Record<
  string,
  {
    models: string[];
    items?: DiscoveredProviderModel[];
    syncedAt: number;
  }
>;

export function providerModelsCachePath(dataDir: string): string {
  return path.join(dataDir, "provider-models.json");
}

/** Read cached model metadata for non-Qwen providers from `${DATA_DIR}/provider-models.json`. */
export function readProviderModelsCache(dataDir: string): ProviderModelsCache {
  const filePath = providerModelsCachePath(dataDir);
  if (!fs.existsSync(filePath)) return {};
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = ProviderModelsCacheSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.byProvider : {};
  } catch {
    return {};
  }
}

/** Return normalized rich model metadata for a cached external provider entry. */
export function normalizeCachedProviderItems(
  entry: ProviderModelsCache[string] | undefined,
): DiscoveredProviderModel[] {
  if (!entry) return [];
  if (Array.isArray(entry.items) && entry.items.length > 0) {
    return entry.items;
  }
  return entry.models.map((modelId) => ({
    modelId,
    displayName: modelId,
    modality: "text" as ModelModality,
  }));
}

function writeProviderModelsCache(
  dataDir: string,
  byProvider: ProviderModelsCache,
): void {
  fs.mkdirSync(dataDir, { recursive: true });
  const target = providerModelsCachePath(dataDir);
  const tmp = `${target}.${randomUUID()}.tmp`;
  fs.writeFileSync(
    tmp,
    `${JSON.stringify({ version: 1, byProvider }, null, 2)}\n`,
    "utf8",
  );
  fs.renameSync(tmp, target);
}

/** Remove cached models for a deleted provider. */
export function removeProviderModelsCache(
  dataDir: string,
  providerId: string,
): void {
  const cache = readProviderModelsCache(dataDir);
  if (!(providerId in cache)) return;
  delete cache[providerId];
  writeProviderModelsCache(dataDir, cache);
}

/**
 * Fetch available models from a single non-Qwen provider (`gemini` via the
 * official `@google/genai` SDK or `openai_compat` via `GET /models`) and store
 * the discovered models and modalities in `${DATA_DIR}/provider-models.json`.
 */
export async function fetchAndCacheExternalProviderModels(
  dataDir: string,
  provider: StoredProvider,
  fetchFn: typeof fetch = fetch,
): Promise<{
  models: string[];
  items: DiscoveredProviderModel[];
  syncedAt: number;
}> {
  const creds = readCredentialsFile(dataDir);
  const apiKey = creds[provider.id]?.trim();

  let items: DiscoveredProviderModel[];
  if (provider.kind === "gemini") {
    const discovered = await listGeminiModels({
      apiKey: apiKey ?? "",
      baseUrl: provider.baseUrl,
    });
    items = discovered.map((m) => ({
      modelId: m.modelId,
      displayName: m.displayName,
      modality: m.modality,
      ttsCapable: m.ttsCapable,
      supportedActions: m.supportedActions,
    }));
  } else {
    const baseUrl = provider.baseUrl?.trim().replace(/\/+$/, "");
    if (!baseUrl) {
      throw new Error(`Provider "${provider.name}" has no Base URL.`);
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const res = await fetchFn(`${baseUrl}/models`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      throw await parseProviderErrorResponse(res);
    }

    const json = (await res.json()) as {
      data?: Array<{ id?: unknown }>;
    };
    const rawIds = Array.isArray(json.data)
      ? json.data
          .map((entry) => (typeof entry?.id === "string" ? entry.id.trim() : ""))
          .filter(Boolean)
      : [];
    const uniqueIds = Array.from(new Set(rawIds)).sort((a, b) =>
      a.localeCompare(b),
    );
    items = uniqueIds.map((modelId) => ({
      modelId,
      displayName: modelId,
      modality: "text" as const,
      ttsCapable: false,
    }));
  }

  const models = items.map((item) => item.modelId);
  const syncedAt = Date.now();
  const cache = readProviderModelsCache(dataDir);
  cache[provider.id] = { models, items, syncedAt };
  writeProviderModelsCache(dataDir, cache);

  return { models, items, syncedAt };
}

/**
 * Sync available models for every enabled non-Qwen provider (`gemini` +
 * `openai_compat`) in `settings.json`.
 */
export async function syncAllExternalProviderModels(
  dataDir: string,
  fetchFn: typeof fetch = fetch,
): Promise<{
  total: number;
  syncedProviders: number;
  warnings: string[];
  lastSyncedAt: number;
}> {
  const stored = readSettingsFile(dataDir);
  const externals = stored.providers.filter(
    (p) => (p.kind === "gemini" || p.kind === "openai_compat") && p.enabled,
  );

  let total = 0;
  let syncedProviders = 0;
  const warnings: string[] = [];
  let lastSyncedAt = Date.now();

  for (const provider of externals) {
    try {
      const res = await fetchAndCacheExternalProviderModels(
        dataDir,
        provider,
        fetchFn,
      );
      total += res.items.length;
      syncedProviders += 1;
      lastSyncedAt = Math.max(lastSyncedAt, res.syncedAt);
    } catch (err) {
      warnings.push(
        `${provider.name}: ${err instanceof Error ? err.message : "sync failed"}`,
      );
    }
  }

  return { total, syncedProviders, warnings, lastSyncedAt };
}
