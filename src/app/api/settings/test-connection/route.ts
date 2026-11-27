import { z } from "zod";
import { apiOk, handleRouteError } from "@/lib/api/route-helpers";
import { getConfig, resolveQwenKeyType } from "@/lib/config";
import { testGeminiConnection } from "@/lib/providers/gemini-client";
import { testOpenAIConnection } from "@/lib/providers/openai-text";
import { testQwenConnection } from "@/lib/providers/qwen-client";
import {
  readCredentialsFile,
  readSettingsFile,
} from "@/lib/settings/store";

const TestConnectionSchema = z
  .object({
    target: z.enum(["qwen", "openai_compat", "all"]).default("all"),
    providerId: z.string().trim().min(1).optional(),
  })
  .default({ target: "all" });

export async function POST(req: Request) {
  try {
    let target: "qwen" | "openai_compat" | "all" = "all";
    let providerId: string | undefined;
    try {
      const raw = await req.json();
      const parsed = TestConnectionSchema.safeParse(raw);
      if (parsed.success) {
        target = parsed.data.target;
        providerId = parsed.data.providerId;
      }
    } catch {
      // Empty or non-JSON body defaults to testing all configured providers.
    }

    let cfg;
    try {
      cfg = getConfig();
    } catch (err) {
      return apiOk({
        ok: false,
        qwen: {
          ok: false,
          detail:
            err instanceof Error
              ? err.message
              : "Invalid configuration.",
        },
      });
    }

    if (providerId) {
      const stored = readSettingsFile(cfg.dataDir);
      const provider = stored.providers.find((p) => p.id === providerId);
      if (!provider) {
        return apiOk({
          ok: false,
          provider: { ok: false, detail: "Provider not found." },
        });
      }
      const creds = readCredentialsFile(cfg.dataDir);
      const apiKey = creds[provider.id]?.trim();

      const result =
        provider.kind === "qwen"
          ? await testQwenConnection({
              apiKey,
              keyType: resolveQwenKeyType(provider.keyType ?? "auto", apiKey),
              region: provider.region ?? "ap-southeast-1",
              workspaceId: provider.workspaceId,
              baseUrlOverride: provider.baseUrl,
            })
          : provider.kind === "gemini"
            ? await testGeminiConnection({
                apiKey: apiKey ?? "",
                baseUrl: provider.baseUrl,
              })
            : await testOpenAIConnection({
                baseUrl: provider.baseUrl ?? "",
                apiKey,
                model: provider.defaultModel || "gpt-4o-mini",
              });

      return apiOk({
        ok: result.ok,
        provider: result,
      });
    }

    const qwenResult =
      target === "qwen" || target === "all"
        ? await testQwenConnection(cfg)
        : undefined;

    const openaiResult =
      (target === "openai_compat" ||
        (target === "all" && cfg.textProvider === "openai_compat")) &&
      cfg.openaiCompat
        ? await testOpenAIConnection(cfg.openaiCompat)
        : target === "openai_compat"
          ? {
              ok: false,
              detail:
                "No OpenAI-compatible provider is configured. Add one in Settings → Providers.",
            }
          : undefined;

    const checks = [qwenResult, openaiResult].filter(
      (r): r is { ok: boolean; detail: string } => r !== undefined,
    );
    const ok = checks.length > 0 && checks.every((r) => r.ok);

    return apiOk({
      ok,
      ...(qwenResult ? { qwen: qwenResult } : {}),
      ...(openaiResult ? { openaiCompat: openaiResult } : {}),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
