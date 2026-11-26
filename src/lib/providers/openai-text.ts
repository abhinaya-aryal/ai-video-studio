import {
  ProviderHttpError,
  mapProviderError,
  parseProviderErrorResponse,
  sanitizeErrorText,
} from "@/lib/providers/errors";
import { extractChatUsage, type TokenUsage } from "@/lib/usage/record";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionOptions {
  maxTokens?: number;
  temperature?: number;
  responseFormat?: { type: "json_object" | "text" };
  /** Qwen/DashScope thinking toggle; false skips hidden reasoning tokens. */
  enableThinking?: boolean;
  /** Called with the provider usage block when the response includes one. */
  onUsage?: (usage: TokenUsage) => void;
}

export type ChatCompletionFn = (
  messages: ChatMessage[],
  options?: ChatCompletionOptions,
) => Promise<string>;

export interface ChatCompletionParams extends ChatCompletionOptions {
  baseUrl: string;
  apiKey?: string;
  model: string;
  messages: ChatMessage[];
  fetchFn?: typeof fetch;
}

/** Send a chat completion request to an OpenAI-compatible `/chat/completions` endpoint. */
export async function chatCompletion({
  baseUrl,
  apiKey,
  model,
  messages,
  maxTokens,
  temperature,
  responseFormat,
  enableThinking,
  onUsage,
  fetchFn = fetch,
}: ChatCompletionParams): Promise<string> {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey?.trim()) {
    headers.Authorization = `Bearer ${apiKey.trim()}`;
  }

  const body: Record<string, unknown> = {
    model,
    messages,
  };
  if (maxTokens !== undefined) body.max_tokens = maxTokens;
  if (temperature !== undefined) body.temperature = temperature;
  if (responseFormat) body.response_format = responseFormat;
  if (enableThinking !== undefined) body.enable_thinking = enableThinking;

  const res = await fetchFn(`${cleanBase}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    throw await parseProviderErrorResponse(res);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
    usage?: unknown;
  };
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new ProviderHttpError(
      mapProviderError("InvalidResponse", 502),
      502,
      "Chat completion response missing choices[0].message.content",
    );
  }

  const usage = extractChatUsage(json);
  if (usage && onUsage) {
    try {
      onUsage(usage);
    } catch {
      // Observability must not break generation.
    }
  }

  return content;
}

export interface TestOpenAIConnectionParams {
  baseUrl: string;
  apiKey?: string;
  model: string;
  fetchFn?: typeof fetch;
}

/**
 * Check OpenAI-compatible connectivity via `GET /models`, falling back to a
 * `max_tokens: 1` chat completion when `/models` returns 404.
 */
export async function testOpenAIConnection({
  baseUrl,
  apiKey,
  model,
  fetchFn = fetch,
}: TestOpenAIConnectionParams): Promise<{ ok: boolean; detail: string }> {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (apiKey?.trim()) {
    headers.Authorization = `Bearer ${apiKey.trim()}`;
  }

  try {
    const modelsRes = await fetchFn(`${cleanBase}/models`, {
      method: "GET",
      signal: AbortSignal.timeout(15_000),
      headers,
    });

    if (modelsRes.ok) {
      return { ok: true, detail: `Connected to ${cleanBase}` };
    }

    if (modelsRes.status === 404) {
      await chatCompletion({
        baseUrl: cleanBase,
        apiKey,
        model,
        messages: [{ role: "user", content: "ping" }],
        maxTokens: 1,
        fetchFn,
      });
      return { ok: true, detail: `Connected to ${cleanBase} (chat fallback)` };
    }

    const err = await parseProviderErrorResponse(modelsRes);
    return { ok: false, detail: err.userMessage };
  } catch (error) {
    if (error instanceof ProviderHttpError) {
      return { ok: false, detail: error.userMessage };
    }
    const message =
      error instanceof Error ? sanitizeErrorText(error.message) : "Network error";
    return { ok: false, detail: `Connection failed: ${message}` };
  }
}
