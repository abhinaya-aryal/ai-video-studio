import { getDb } from "@/db";
import { type AppConfig, getConfig } from "@/lib/config";
import {
  ProviderHttpError,
  mapProviderError,
} from "@/lib/providers/errors";
import {
  type ChatCompletionFn,
  chatCompletion,
} from "@/lib/providers/openai-text";
import { resolveSlotModel } from "@/lib/providers/model-selection";
import { resolveQwenBaseUrl } from "@/lib/providers/qwen-endpoints";
import type { TokenUsage } from "@/lib/usage/record";

export interface GetTextChatOptions {
  /** Role used to resolve the model when `modelId` is omitted. */
  role?: "text_refine" | "text_polish";
  modelId?: string;
  onUsage?: (usage: TokenUsage) => void;
}

/**
 * Return a `ChatCompletionFn` bound to either Qwen compatible-mode or the
 * configured OpenAI-compatible text provider based on `TEXT_PROVIDER`.
 * The model comes from the saved role selection unless `modelId` is passed.
 */
export function getTextChat(
  cfg?: AppConfig,
  fetchFn: typeof fetch = fetch,
  options: GetTextChatOptions = {},
): ChatCompletionFn {
  const resolved = cfg ?? getConfig();

  if (resolved.textProvider === "openai_compat") {
    const compat = resolved.openaiCompat;
    if (!compat) {
      throw new ProviderHttpError(
        mapProviderError("InvalidParameter", 400),
        400,
        "TEXT_PROVIDER=openai_compat requires OPENAI_COMPAT_BASE_URL and OPENAI_COMPAT_MODEL in .env.local",
      );
    }
    return (messages, callOptions) =>
      chatCompletion({
        baseUrl: compat.baseUrl,
        apiKey: compat.apiKey,
        model: compat.model,
        messages,
        ...callOptions,
        onUsage: options.onUsage,
        fetchFn,
      });
  }

  const apiKey = resolved.qwen.apiKey?.trim();
  if (!apiKey) {
    throw new ProviderHttpError(
      mapProviderError("InvalidApiKey", 401),
      401,
      "QWEN_API_KEY is missing in .env.local",
    );
  }

  const qwenBase = `${resolveQwenBaseUrl(resolved.qwen)}/compatible-mode/v1`;
  const model =
    options.modelId ??
    resolveSlotModel(getDb(), options.role ?? "text_refine").modelId;

  return (messages, callOptions) =>
    chatCompletion({
      baseUrl: qwenBase,
      apiKey,
      model,
      messages,
      ...callOptions,
      onUsage: options.onUsage,
      fetchFn,
    });
}
