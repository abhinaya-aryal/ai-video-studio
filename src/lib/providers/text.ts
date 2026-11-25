import { type AppConfig, getConfig } from "@/lib/config";
import {
  ProviderHttpError,
  mapProviderError,
} from "@/lib/providers/errors";
import {
  type ChatCompletionFn,
  chatCompletion,
} from "@/lib/providers/openai-text";
import { resolveQwenBaseUrl } from "@/lib/providers/qwen-endpoints";

/**
 * Return a `ChatCompletionFn` bound to either Qwen compatible-mode or the
 * configured OpenAI-compatible text provider based on `TEXT_PROVIDER`.
 */
export function getTextChat(
  cfg?: AppConfig,
  fetchFn: typeof fetch = fetch,
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
    return (messages, options) =>
      chatCompletion({
        baseUrl: compat.baseUrl,
        apiKey: compat.apiKey,
        model: compat.model,
        messages,
        ...options,
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
  const model = resolved.qwen.models.text;

  return (messages, options) =>
    chatCompletion({
      baseUrl: qwenBase,
      apiKey,
      model,
      messages,
      ...options,
      fetchFn,
    });
}
