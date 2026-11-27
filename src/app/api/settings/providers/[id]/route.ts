import { eq } from "drizzle-orm";
import { z } from "zod";
import { customModels, getDb, modelSelections } from "@/db";
import {
  RouteError,
  apiOk,
  handleRouteError,
  parseJsonBody,
} from "@/lib/api/route-helpers";
import { getConfig, maskApiKey, resolveQwenKeyType } from "@/lib/config";
import {
  checkQwenKeyUrl,
  resolveQwenBaseUrl,
} from "@/lib/providers/qwen-endpoints";
import { syncProviderModels } from "@/lib/providers/model-sync";
import {
  fetchAndCacheExternalProviderModels,
  removeProviderModelsCache,
} from "@/lib/settings/provider-models";
import {
  PROVIDER_PRESET_IDS,
  deleteProvider,
  readCredentialsFile,
  readSettingsFile,
  updateProvider,
} from "@/lib/settings/store";

const UpdateProviderBodySchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    preset: z.enum(PROVIDER_PRESET_IDS).optional(),
    keyType: z.enum(["auto", "token_plan", "standard"]).optional(),
    region: z.enum(["ap-southeast-1", "cn-beijing"]).optional(),
    workspaceId: z.string().nullable().optional(),
    baseUrl: z.string().nullable().optional(),
    defaultModel: z.string().nullable().optional(),
    enabled: z.boolean().optional(),
    apiKey: z.string().optional(),
    clearApiKey: z.boolean().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.baseUrl && val.baseUrl.trim()) {
      try {
        new URL(val.baseUrl.trim());
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["baseUrl"],
          message: "Base URL must be a valid URL",
        });
      }
    }
  });

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const input = await parseJsonBody(req, UpdateProviderBodySchema);
    const cfg = getConfig();
    const updated = updateProvider(cfg.dataDir, id, input);
    if (!updated) {
      throw new RouteError("NOT_FOUND", "Provider not found.", 404);
    }

    const creds = readCredentialsFile(cfg.dataDir);
    const rawKey = creds[updated.id]?.trim() ?? "";
    const resolvedKeyType =
      updated.kind === "qwen"
        ? resolveQwenKeyType(updated.keyType ?? "auto", rawKey || undefined)
        : undefined;
    const resolvedBaseUrl =
      updated.kind === "qwen"
        ? resolveQwenBaseUrl({
            keyType: resolvedKeyType!,
            region: updated.region ?? "ap-southeast-1",
            baseUrlOverride: updated.baseUrl,
          })
        : updated.kind === "gemini"
          ? (updated.baseUrl?.trim() || "Official Google Gemini API (@google/genai)")
          : (updated.baseUrl ?? "");

    let syncedModelsCount = 0;
    let syncWarning: string | null = null;
    if (updated.enabled) {
      try {
        if (updated.kind === "qwen" && rawKey) {
          const res = await syncProviderModels();
          syncedModelsCount = res.total;
        } else if (
          updated.kind === "gemini" ||
          updated.kind === "openai_compat"
        ) {
          const res = await fetchAndCacheExternalProviderModels(
            cfg.dataDir,
            updated,
          );
          syncedModelsCount = res.models.length;
        }
      } catch (err) {
        syncWarning =
          err instanceof Error ? err.message : "Could not sync models yet.";
      }
    }

    return apiOk({
      provider: {
        ...updated,
        hasApiKey: Boolean(rawKey),
        maskedApiKey: rawKey ? maskApiKey(rawKey) : "",
        resolvedKeyType,
        resolvedBaseUrl,
        keyUrlCheck:
          updated.kind === "qwen" && rawKey
            ? checkQwenKeyUrl(rawKey, resolvedBaseUrl)
            : { ok: true as const },
      },
      syncedModelsCount,
      ...(syncWarning ? { syncWarning } : {}),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const cfg = getConfig();
    const before = readSettingsFile(cfg.dataDir).providers.find(
      (p) => p.id === id,
    );
    const removed = deleteProvider(cfg.dataDir, id);
    if (!removed) {
      throw new RouteError("NOT_FOUND", "Provider not found.", 404);
    }
    removeProviderModelsCache(cfg.dataDir, id);
    if (before?.kind === "qwen") {
      const stillHasQwen = readSettingsFile(cfg.dataDir).providers.some(
        (p) => p.kind === "qwen" && p.enabled,
      );
      if (!stillHasQwen) {
        const db = getDb();
        db.delete(customModels).where(eq(customModels.source, "discovered")).run();
        db.delete(modelSelections).run();
      }
    }
    return apiOk({ deleted: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
