import { connection } from "next/server";
import { getConfig, maskApiKey } from "@/lib/config";
import { apiOk } from "@/lib/api/route-helpers";
import {
  checkQwenKeyUrl,
  resolveQwenBaseUrl,
} from "@/lib/providers/qwen-endpoints";

export async function GET() {
  try {
    await connection();
  } catch {
    // Allow direct handler invocation in unit tests outside Next.js request scope.
  }

  try {
    const cfg = getConfig();
    const qwenBaseUrl = resolveQwenBaseUrl(cfg.qwen);
    const keyUrlCheck = cfg.qwen.apiKey
      ? checkQwenKeyUrl(cfg.qwen.apiKey, qwenBaseUrl)
      : { ok: true as const };

    return apiOk({
      configured: Boolean(cfg.qwen.apiKey),
      qwen: {
        hasApiKey: Boolean(cfg.qwen.apiKey),
        maskedApiKey: cfg.qwen.apiKey ? maskApiKey(cfg.qwen.apiKey) : "",
        keyType: cfg.qwen.keyType,
        region: cfg.qwen.region,
        workspaceId: cfg.qwen.workspaceId ?? null,
        baseUrl: qwenBaseUrl,
        models: cfg.qwen.models,
        keyUrlCheck,
      },
      textProvider: cfg.textProvider,
      openaiCompat: cfg.openaiCompat
        ? {
            baseUrl: cfg.openaiCompat.baseUrl,
            hasApiKey: Boolean(cfg.openaiCompat.apiKey),
            maskedApiKey: cfg.openaiCompat.apiKey
              ? maskApiKey(cfg.openaiCompat.apiKey)
              : "",
            model: cfg.openaiCompat.model,
          }
        : null,
      jobs: cfg.jobs,
    });
  } catch (err) {
    return apiOk({
      configured: false,
      configError:
        err instanceof Error ? err.message : "Invalid environment configuration",
      qwen: null,
      textProvider: null,
      openaiCompat: null,
      jobs: null,
    });
  }
}
