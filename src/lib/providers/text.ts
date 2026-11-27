import { getDb, type DrizzleDb } from "@/db";
import { type AppConfig, getConfig, resolveQwenKeyType } from "@/lib/config";
import {
  ProviderHttpError,
  mapProviderError,
} from "@/lib/providers/errors";
import { geminiChatCompletion } from "@/lib/providers/gemini-client";
import {
  type ChatCompletionFn,
  chatCompletion,
} from "@/lib/providers/openai-text";
import { resolveSlotModel } from "@/lib/providers/model-selection";
import { resolveQwenBaseUrl } from "@/lib/providers/qwen-endpoints";
import {
  type TextRole,
  readCredentialsFile,
} from "@/lib/settings/store";
import type { TokenUsage } from "@/lib/usage/record";

export interface GetTextChatOptions {
  /** Role used to resolve the provider & model when `modelId` is omitted. */
  role?: TextRole;
  modelId?: string;
  onUsage?: (usage: TokenUsage) => void;
}

export interface ResolvedTextTarget {
  providerId: string | null;
  providerName: string;
  kind: "qwen" | "gemini" | "openai_compat";
  baseUrl?: string;
  apiKey?: string;
  modelId: string;
  enableThinking?: boolean;
}

/**
 * Resolve the concrete text provider endpoint, credentials, and model for a
 * text role (`text_refine` or `text_polish`). Checks UI `roleProviders` first,
 * then falls back to `TEXT_PROVIDER=openai_compat` or QwenCloud.
 */
export function resolveTextTarget(
  cfg: AppConfig,
  db: DrizzleDb,
  role: TextRole = "text_refine",
  explicitModelId?: string,
): ResolvedTextTarget {
  const siblingRole: TextRole =
    role === "text_polish" ? "text_refine" : "text_polish";
  const primaryBinding = cfg.roleProviders?.[role];
  const siblingBinding = cfg.roleProviders?.[siblingRole];
  const binding =
    primaryBinding?.modelId?.trim() || !siblingBinding?.modelId?.trim()
      ? primaryBinding
      : siblingBinding;

  if (binding) {
    const provider = (cfg.providers ?? []).find(
      (p) => p.id === binding.providerId && p.enabled,
    );
    if (!provider) {
      throw new ProviderHttpError(
        mapProviderError("InvalidParameter", 400),
        400,
        `The provider assigned to ${role} is missing or disabled. Update it in Settings → Models.`,
      );
    }

    const creds = readCredentialsFile(cfg.dataDir);
    const apiKey = creds[provider.id]?.trim();

    if (provider.kind === "gemini") {
      if (!apiKey) {
        throw new ProviderHttpError(
          mapProviderError("InvalidApiKey", 401),
          401,
          `API key for "${provider.name}" is missing. Add it in Settings → Providers.`,
        );
      }
      const modelId =
        explicitModelId?.trim() ||
        binding.modelId?.trim() ||
        provider.defaultModel?.trim();
      if (!modelId) {
        throw new ProviderHttpError(
          mapProviderError("InvalidParameter", 400),
          400,
          `No model is selected for "${provider.name}". Choose a model in Settings → Models.`,
        );
      }
      return {
        providerId: provider.id,
        providerName: provider.name,
        kind: "gemini",
        baseUrl: provider.baseUrl?.trim() || undefined,
        apiKey,
        modelId,
      };
    }

    if (provider.kind === "openai_compat") {
      const baseUrl = provider.baseUrl?.trim();
      if (!baseUrl) {
        throw new ProviderHttpError(
          mapProviderError("InvalidParameter", 400),
          400,
          `Provider "${provider.name}" is missing a Base URL. Edit it in Settings → Providers.`,
        );
      }
      const modelId =
        explicitModelId?.trim() ||
        binding.modelId?.trim() ||
        provider.defaultModel?.trim();
      if (!modelId) {
        throw new ProviderHttpError(
          mapProviderError("InvalidParameter", 400),
          400,
          `No model is selected for "${provider.name}". Choose a model in Settings → Models.`,
        );
      }
      return {
        providerId: provider.id,
        providerName: provider.name,
        kind: "openai_compat",
        baseUrl,
        apiKey,
        modelId,
      };
    }

    // Qwen provider selected explicitly via UI
    if (!apiKey) {
      throw new ProviderHttpError(
        mapProviderError("InvalidApiKey", 401),
        401,
        `API key for "${provider.name}" is missing. Add it in Settings → Providers.`,
      );
    }
    const qwenBase = `${resolveQwenBaseUrl({
      keyType: resolveQwenKeyType(provider.keyType ?? "auto", apiKey),
      region: provider.region ?? "ap-southeast-1",
      baseUrlOverride: provider.baseUrl,
    })}/compatible-mode/v1`;
    const modelId =
      explicitModelId?.trim() ||
      binding.modelId?.trim() ||
      resolveSlotModel(db, role).modelId;
    return {
      providerId: provider.id,
      providerName: provider.name,
      kind: "qwen",
      baseUrl: qwenBase,
      apiKey,
      modelId,
      enableThinking: false,
    };
  }

  if (cfg.textProvider === "openai_compat") {
    const compat = cfg.openaiCompat;
    if (!compat) {
      throw new ProviderHttpError(
        mapProviderError("InvalidParameter", 400),
        400,
        "OpenAI-compatible text provider requires a Base URL and model. Configure a provider in Settings → Providers.",
      );
    }
    return {
      providerId: null,
      providerName: "OpenAI-Compatible",
      kind: "openai_compat",
      baseUrl: compat.baseUrl,
      apiKey: compat.apiKey,
      modelId: explicitModelId?.trim() || compat.model,
    };
  }

  const apiKey = cfg.qwen.apiKey?.trim();
  if (!apiKey) {
    throw new ProviderHttpError(
      mapProviderError("InvalidApiKey", 401),
      401,
      "No text provider API key is configured. Add QwenCloud, Gemini, or another provider in Settings → Providers.",
    );
  }

  const qwenBase = `${resolveQwenBaseUrl(cfg.qwen)}/compatible-mode/v1`;
  const modelId =
    explicitModelId?.trim() || resolveSlotModel(db, role).modelId;

  return {
    providerId: null,
    providerName: "QwenCloud",
    kind: "qwen",
    baseUrl: qwenBase,
    apiKey,
    modelId,
    enableThinking: false,
  };
}

/**
 * Return a provider-independent `ChatCompletionFn` bound to whichever provider
 * and model are assigned to the requested role (`text_refine` or `text_polish`).
 */
export function getTextChat(
  cfg?: AppConfig,
  fetchFn: typeof fetch = fetch,
  options: GetTextChatOptions = {},
): ChatCompletionFn {
  const resolved = cfg ?? getConfig();
  const role = options.role ?? "text_refine";
  const target = resolveTextTarget(resolved, getDb(), role, options.modelId);

  if (target.kind === "gemini") {
    return (messages, callOptions) =>
      geminiChatCompletion({
        apiKey: target.apiKey ?? "",
        baseUrl: target.baseUrl,
        model: target.modelId,
        messages,
        ...callOptions,
        onUsage: options.onUsage,
      });
  }

  return (messages, callOptions) =>
    chatCompletion({
      baseUrl: target.baseUrl ?? "",
      apiKey: target.apiKey,
      model: target.modelId,
      messages,
      ...(target.enableThinking !== undefined
        ? { enableThinking: target.enableThinking }
        : {}),
      ...callOptions,
      onUsage: options.onUsage,
      fetchFn,
    });
}
