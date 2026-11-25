import type { AppConfig } from "@/lib/config";

/** Subset of `AppConfig["qwen"]` required to compute the QwenCloud / DashScope base URL. */
export type QwenRoutingConfig = Pick<
  AppConfig["qwen"],
  "keyType" | "region" | "workspaceId" | "baseUrlOverride"
> & {
  apiKey?: string;
};

/** Relative API paths on QwenCloud / DashScope endpoints. */
export const QWEN_ENDPOINT_PATHS = {
  chatCompletions: "/compatible-mode/v1/chat/completions",
  models: "/compatible-mode/v1/models",
  imageGeneration: "/api/v1/services/aigc/multimodal-generation/generation",
  videoSynthesis: "/api/v1/services/aigc/video-generation/video-synthesis",
  taskStatus: (taskId: string) =>
    `/api/v1/tasks/${encodeURIComponent(taskId)}`,
  tts: "/api/v1/services/audio/tts/SpeechSynthesizer",
  uploads: "/api/v1/uploads",
} as const;

const STANDARD_REGIONAL_HOSTS: Record<AppConfig["qwen"]["region"], string> = {
  "ap-southeast-1": "https://dashscope-intl.aliyuncs.com",
  "cn-beijing": "https://dashscope.aliyuncs.com",
};

/**
 * Resolve the QwenCloud / DashScope base URL from key type, region, workspace ID,
 * and optional explicit override (trimmed, with no trailing slash).
 */
export function resolveQwenBaseUrl(cfg: QwenRoutingConfig): string {
  const override = cfg.baseUrlOverride?.trim();
  if (override) {
    return override.replace(/\/+$/, "");
  }

  const isTokenPlan =
    cfg.keyType === "token_plan" ||
    Boolean(cfg.apiKey?.trim().startsWith("sk-sp-"));

  if (isTokenPlan) {
    return `https://token-plan.${cfg.region}.maas.aliyuncs.com`;
  }

  const workspaceId = cfg.workspaceId?.trim();
  if (workspaceId) {
    return `https://${workspaceId}.${cfg.region}.maas.aliyuncs.com`;
  }

  return STANDARD_REGIONAL_HOSTS[cfg.region];
}

function extractHostname(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return rawUrl.toLowerCase();
  }
}

/**
 * Verify that the API key prefix matches the resolved endpoint host.
 * Token Plan keys (`sk-sp-*`) require `token-plan.<region>.maas.aliyuncs.com`.
 */
export function checkQwenKeyUrl(
  apiKey: string,
  baseUrl: string,
): { ok: true } | { ok: false; warning: string } {
  const key = apiKey.trim();
  const url = baseUrl.trim();
  if (!key) {
    return { ok: true };
  }

  const hostname = extractHostname(url);
  const isTokenPlanHost =
    hostname.startsWith("token-plan.") || hostname.includes("token-plan.");

  if (key.startsWith("sk-sp-")) {
    if (!isTokenPlanHost) {
      return {
        ok: false,
        warning:
          "Token Plan API keys (sk-sp-*) must route to the token-plan endpoint (https://token-plan.<region>.maas.aliyuncs.com); standard DashScope endpoints reject them with 401 InvalidApiKey.",
      };
    }
    return { ok: true };
  }

  if (key.startsWith("sk-") && isTokenPlanHost) {
    return {
      ok: false,
      warning:
        "Standard DashScope keys (sk-*) should not use a token-plan endpoint; route to a standard DashScope or workspace endpoint instead.",
    };
  }

  return { ok: true };
}
