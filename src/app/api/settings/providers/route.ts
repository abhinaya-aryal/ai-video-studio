import { connection } from "next/server";
import { z } from "zod";
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
import { fetchAndCacheExternalProviderModels } from "@/lib/settings/provider-models";
import {
  PROVIDER_KINDS,
  PROVIDER_PRESETS,
  PROVIDER_PRESET_IDS,
  createProvider,
  readCredentialsFile,
  readSettingsFile,
} from "@/lib/settings/store";

const CreateProviderBodySchema = z
  .object({
    name: z.string().trim().min(1, "Provider name is required"),
    kind: z.enum(PROVIDER_KINDS),
    preset: z.enum(PROVIDER_PRESET_IDS).optional(),
    keyType: z.enum(["auto", "token_plan", "standard"]).optional(),
    region: z.enum(["ap-southeast-1", "cn-beijing"]).optional(),
    workspaceId: z.string().trim().optional(),
    baseUrl: z.string().trim().optional(),
    defaultModel: z.string().trim().optional(),
    enabled: z.boolean().optional(),
    apiKey: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.kind === "openai_compat") {
      if (!val.baseUrl?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["baseUrl"],
          message: "Base URL is required for OpenAI-compatible providers",
        });
      } else {
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
    } else if (val.baseUrl?.trim()) {
      try {
        new URL(val.baseUrl.trim());
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["baseUrl"],
          message: "Base URL override must be a valid URL",
        });
      }
    }
  });

function formatProviderView(
  provider: ReturnType<typeof readSettingsFile>["providers"][number],
  creds: Record<string, string>,
) {
  const rawKey = creds[provider.id]?.trim() ?? "";
  const resolvedKeyType =
    provider.kind === "qwen"
      ? resolveQwenKeyType(provider.keyType ?? "auto", rawKey || undefined)
      : undefined;
  const resolvedBaseUrl =
    provider.kind === "qwen"
      ? resolveQwenBaseUrl({
          keyType: resolvedKeyType!,
          region: provider.region ?? "ap-southeast-1",
          baseUrlOverride: provider.baseUrl,
        })
      : provider.kind === "gemini"
        ? (provider.baseUrl?.trim() || "Official Google Gemini API (@google/genai)")
        : (provider.baseUrl ?? "");
  const keyUrlCheck =
    provider.kind === "qwen" && rawKey
      ? checkQwenKeyUrl(rawKey, resolvedBaseUrl)
      : { ok: true as const };

  return {
    ...provider,
    hasApiKey: Boolean(rawKey),
    maskedApiKey: rawKey ? maskApiKey(rawKey) : "",
    resolvedKeyType,
    resolvedBaseUrl,
    keyUrlCheck,
  };
}

export async function GET() {
  try {
    await connection();
  } catch {
    // Allow direct invocation in tests.
  }

  try {
    const cfg = getConfig();
    const stored = readSettingsFile(cfg.dataDir);
    const creds = readCredentialsFile(cfg.dataDir);

    return apiOk({
      providers: stored.providers.map((p) => formatProviderView(p, creds)),
      roleProviders: stored.roleProviders,
      app: {
        projectsDir: stored.app.projectsDir ?? cfg.projectsDir,
        maxConcurrentJobs: cfg.jobs.maxConcurrent,
        jobPollIntervalMs: cfg.jobs.pollIntervalMs,
      },
      presets: PROVIDER_PRESETS,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST(req: Request) {
  try {
    const input = await parseJsonBody(req, CreateProviderBodySchema);
    const cfg = getConfig();
    const created = createProvider(cfg.dataDir, input);
    const creds = readCredentialsFile(cfg.dataDir);

    if (!created) {
      throw new RouteError("INTERNAL_ERROR", "Failed to save provider.", 500);
    }

    // Best-effort model sync so the Models page immediately lists this provider's models.
    let syncedModelsCount = 0;
    let syncWarning: string | null = null;
    if (created.enabled) {
      try {
        if (created.kind === "qwen" && creds[created.id]) {
          const res = await syncProviderModels();
          syncedModelsCount = res.total;
        } else if (
          created.kind === "gemini" ||
          created.kind === "openai_compat"
        ) {
          const res = await fetchAndCacheExternalProviderModels(
            cfg.dataDir,
            created,
          );
          syncedModelsCount = res.models.length;
        }
      } catch (err) {
        syncWarning =
          err instanceof Error ? err.message : "Could not sync models yet.";
      }
    }

    return apiOk(
      {
        provider: formatProviderView(created, creds),
        syncedModelsCount,
        ...(syncWarning ? { syncWarning } : {}),
      },
      201,
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
