import {
  ProviderHttpError,
  mapProviderError,
  parseProviderErrorResponse,
} from "@/lib/providers/errors";
import { testOpenAIConnection } from "@/lib/providers/openai-text";
import {
  QWEN_ENDPOINT_PATHS,
  checkQwenKeyUrl,
  resolveQwenBaseUrl,
} from "@/lib/providers/qwen-endpoints";
import type { AppConfig } from "@/lib/config";
import type { VideoSynthesisRequestBody } from "@/lib/providers/wan-payload";

export interface SubmitVideoTaskParams {
  baseUrl: string;
  apiKey: string;
  body: VideoSynthesisRequestBody | Record<string, unknown>;
  needsOssHeader: boolean;
  fetchFn?: typeof fetch;
}

/** Submit an asynchronous Wan video synthesis task to DashScope. */
export async function submitVideoTask({
  baseUrl,
  apiKey,
  body,
  needsOssHeader,
  fetchFn = fetch,
}: SubmitVideoTaskParams): Promise<{ taskId: string }> {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "X-DashScope-Async": "enable",
  };
  if (needsOssHeader) {
    headers["X-DashScope-OssResourceResolve"] = "enable";
  }

  const res = await fetchFn(`${cleanBase}${QWEN_ENDPOINT_PATHS.videoSynthesis}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw await parseProviderErrorResponse(res);
  }

  const json = (await res.json()) as { output?: { task_id?: string } };
  const taskId = json.output?.task_id;
  if (!taskId) {
    throw new ProviderHttpError(
      mapProviderError("InvalidResponse", 502),
      502,
      "DashScope video synthesis response missing output.task_id",
    );
  }

  return { taskId };
}

export type NormalizedTaskStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED";

export interface TaskStatusResult {
  status: NormalizedTaskStatus;
  resultUrls: string[];
  errorCode?: string;
  errorMessage?: string;
}

function extractResultUrls(output: Record<string, unknown> | undefined): string[] {
  if (!output) return [];
  const urls = new Set<string>();

  if (typeof output.video_url === "string" && output.video_url.trim()) {
    urls.add(output.video_url.trim());
  }
  if (typeof output.image_url === "string" && output.image_url.trim()) {
    urls.add(output.image_url.trim());
  }

  const audio = output.audio as { url?: unknown } | undefined;
  if (typeof audio?.url === "string" && audio.url.trim()) {
    urls.add(audio.url.trim());
  }

  if (Array.isArray(output.results)) {
    for (const entry of output.results) {
      const url = (entry as { url?: unknown } | null)?.url;
      if (typeof url === "string" && url.trim()) {
        urls.add(url.trim());
      }
    }
  }

  if (Array.isArray(output.choices)) {
    for (const choice of output.choices) {
      const content = (
        choice as { message?: { content?: unknown } } | null
      )?.message?.content;
      if (Array.isArray(content)) {
        for (const item of content) {
          const image = (item as { image?: unknown } | null)?.image;
          if (typeof image === "string" && image.trim()) {
            urls.add(image.trim());
          }
        }
      }
    }
  }

  return Array.from(urls);
}

function normalizeTaskStatus(rawStatus: unknown): NormalizedTaskStatus {
  switch (rawStatus) {
    case "SUCCEEDED":
      return "SUCCEEDED";
    case "FAILED":
    case "CANCELED":
      return "FAILED";
    case "RUNNING":
      return "RUNNING";
    default:
      return "PENDING";
  }
}

export interface GetTaskStatusParams {
  baseUrl: string;
  apiKey: string;
  taskId: string;
  fetchFn?: typeof fetch;
}

/** Poll a DashScope async task by ID and normalize its status and output URLs. */
export async function getTaskStatus({
  baseUrl,
  apiKey,
  taskId,
  fetchFn = fetch,
}: GetTaskStatusParams): Promise<TaskStatusResult> {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const res = await fetchFn(
    `${cleanBase}${QWEN_ENDPOINT_PATHS.taskStatus(taskId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    },
  );

  if (!res.ok) {
    throw await parseProviderErrorResponse(res);
  }

  const json = (await res.json()) as {
    code?: string;
    message?: string;
    output?: Record<string, unknown> & {
      task_status?: string;
      code?: string;
      message?: string;
    };
  };

  const output = json.output;
  const status = normalizeTaskStatus(output?.task_status);
  const resultUrls = status === "SUCCEEDED" ? extractResultUrls(output) : [];
  const errorCode = output?.code ?? json.code;
  const errorMessage = output?.message ?? json.message;

  return {
    status,
    resultUrls,
    ...(errorCode ? { errorCode } : {}),
    ...(errorMessage ? { errorMessage } : {}),
  };
}

export interface GenerateImageParams {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  referenceImages?: string[];
  size?: string;
  n?: number;
  negativePrompt?: string;
  needsOssHeader?: boolean;
  fetchFn?: typeof fetch;
}

export type GenerateImageResult =
  | { kind: "sync"; urls: string[] }
  | { kind: "async"; taskId: string };

/**
 * Call DashScope multimodal image generation (`wan2.7-image*`, `qwen-image-*`).
 * Supports both synchronous image URL responses and asynchronous `task_id` responses.
 */
export async function generateImage({
  baseUrl,
  apiKey,
  model,
  prompt,
  referenceImages = [],
  size,
  n,
  negativePrompt,
  needsOssHeader,
  fetchFn = fetch,
}: GenerateImageParams): Promise<GenerateImageResult> {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const hasOssUri =
    Boolean(needsOssHeader) ||
    referenceImages.some((url) => url.trim().startsWith("oss://"));

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (hasOssUri) {
    headers["X-DashScope-OssResourceResolve"] = "enable";
  }

  const content: Array<{ image: string } | { text: string }> = [
    ...referenceImages.map((url) => ({ image: url })),
    { text: prompt },
  ];

  const parameters: Record<string, unknown> = {};
  if (size) parameters.size = size;
  if (n !== undefined) parameters.n = n;
  if (negativePrompt) parameters.negative_prompt = negativePrompt;

  const res = await fetchFn(
    `${cleanBase}${QWEN_ENDPOINT_PATHS.imageGeneration}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        input: {
          messages: [{ role: "user", content }],
        },
        ...(Object.keys(parameters).length > 0 ? { parameters } : {}),
      }),
    },
  );

  if (!res.ok) {
    throw await parseProviderErrorResponse(res);
  }

  const json = (await res.json()) as {
    output?: Record<string, unknown> & { task_id?: string };
  };

  if (json.output?.task_id) {
    return { kind: "async", taskId: json.output.task_id };
  }

  const urls = extractResultUrls(json.output);
  if (urls.length === 0) {
    throw new ProviderHttpError(
      mapProviderError("InvalidResponse", 502),
      502,
      "DashScope image generation returned neither image URLs nor task_id",
    );
  }

  return { kind: "sync", urls };
}

export interface SynthesizeSpeechParams {
  baseUrl: string;
  apiKey: string;
  model: string;
  text: string;
  voice?: string;
  format?: string;
  sampleRate?: number;
  fetchFn?: typeof fetch;
}

export type SynthesizeSpeechResult =
  | { kind: "bytes"; data: Uint8Array; mime: string }
  | { kind: "url"; url: string };

/**
 * Call DashScope TTS (`qwen-audio-3.0-tts-plus`, `cosyvoice-*`).
 * Handles both raw binary audio streams and JSON `{ output: { audio: { url } } }`.
 */
export async function synthesizeSpeech({
  baseUrl,
  apiKey,
  model,
  text,
  voice,
  format,
  sampleRate,
  fetchFn = fetch,
}: SynthesizeSpeechParams): Promise<SynthesizeSpeechResult> {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const parameters: Record<string, unknown> = {};
  if (format) parameters.format = format;
  if (sampleRate !== undefined) parameters.sample_rate = sampleRate;

  const res = await fetchFn(`${cleanBase}${QWEN_ENDPOINT_PATHS.tts}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: {
        text,
        ...(voice ? { voice } : {}),
      },
      ...(Object.keys(parameters).length > 0 ? { parameters } : {}),
    }),
  });

  if (!res.ok) {
    throw await parseProviderErrorResponse(res);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.toLowerCase().includes("application/json")) {
    const json = (await res.json()) as {
      output?: { audio?: { url?: string; data?: string }; url?: string };
      url?: string;
    };
    const url = json.output?.audio?.url ?? json.output?.url ?? json.url;
    if (url) {
      return { kind: "url", url };
    }
    if (json.output?.audio?.data) {
      const buf = Buffer.from(json.output.audio.data, "base64");
      return {
        kind: "bytes",
        data: new Uint8Array(buf),
        mime: format ? `audio/${format}` : "audio/mpeg",
      };
    }
    throw new ProviderHttpError(
      mapProviderError("InvalidResponse", 502),
      502,
      "TTS JSON response missing audio url or data",
    );
  }

  const buffer = await res.arrayBuffer();
  const mime = contentType.split(";")[0].trim() || "audio/mpeg";
  return {
    kind: "bytes",
    data: new Uint8Array(buffer),
    mime,
  };
}

export type QwenConnectionConfig = AppConfig | AppConfig["qwen"];

/**
 * Verify QwenCloud key/endpoint pairing and connectivity via `/compatible-mode/v1/models`
 * (falling back to a `max_tokens: 1` chat ping on 404).
 */
export async function testQwenConnection(
  cfg: QwenConnectionConfig,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: boolean; detail: string }> {
  const qwen = "qwen" in cfg ? cfg.qwen : cfg;
  if (!qwen.apiKey?.trim()) {
    return {
      ok: false,
      detail: "QWEN_API_KEY is not configured in .env.local.",
    };
  }

  const baseUrl = resolveQwenBaseUrl(qwen);
  const keyCheck = checkQwenKeyUrl(qwen.apiKey, baseUrl);
  if (!keyCheck.ok) {
    return { ok: false, detail: keyCheck.warning };
  }

  return testOpenAIConnection({
    baseUrl: `${baseUrl}/compatible-mode/v1`,
    apiKey: qwen.apiKey,
    model: qwen.models.text,
    fetchFn,
  });
}
