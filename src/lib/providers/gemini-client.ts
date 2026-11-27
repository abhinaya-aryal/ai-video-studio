import {
  ApiError,
  GenerateVideosOperation,
  GoogleGenAI,
  type Content,
  type Model,
  type Part,
} from "@google/genai";
import {
  ProviderHttpError,
  mapProviderError,
  sanitizeErrorText,
} from "@/lib/providers/errors";
import type {
  ChatCompletionOptions,
  ChatMessage,
} from "@/lib/providers/openai-text";
import type { TaskStatusResult } from "@/lib/providers/qwen-client";
import type { ModelModality } from "@/lib/providers/types";
import type { TokenUsage } from "@/lib/usage/record";

/**
 * Specialized Gemini catalog models that do not map to the studio's
 * Text, Image, Video, or Voiceover (TTS) generation tasks.
 */
const NON_STUDIO_GEMINI_PATTERN =
  /(embedding|aqa|transcribe|robotics|computer-use|deep-research|antigravity|genie|decision|lyria|native-audio|-live\b|live-)/i;

const NON_TEXT_GEMINI_PATTERN =
  /(image|tts|lyria|embedding|aqa|imagen|veo|robotics|computer-use|deep-research|transcribe|nano-banana|omni|antigravity|genie|decision|native-audio|-live\b|live-)/i;

const GEMINI_PREBUILT_VOICES = new Set([
  "Zephyr",
  "Puck",
  "Charon",
  "Kore",
  "Fenrir",
  "Leda",
  "Orus",
  "Aoede",
  "Callirrhoe",
  "Autonoe",
  "Enceladus",
  "Iapetus",
  "Umbriel",
  "Algieba",
  "Despina",
  "Erinome",
  "Algenib",
  "Rasalgethi",
  "Laomedeia",
  "Achernar",
  "Alnilam",
  "Schedar",
  "Gacrux",
  "Pulcherrima",
  "Achird",
  "Zubenelgenubi",
  "Vindemiatrix",
  "Sadachbia",
  "Sadaltager",
  "Sulafat",
]);

export interface GeminiClientConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface DiscoveredGeminiModel {
  modelId: string;
  displayName: string;
  modality: ModelModality;
  ttsCapable: boolean;
  supportedActions: string[];
}

/**
 * Create an official `@google/genai` client using the user's API key on `v1beta`
 * so text, Gemini image (Nano Banana), Imagen, Gemini TTS, and Veo models are
 * all accessible through the standard Gemini Developer API.
 */
export function createGeminiClient({
  apiKey,
  baseUrl,
}: GeminiClientConfig): GoogleGenAI {
  const cleanKey = apiKey.trim();
  const cleanBase = baseUrl?.trim();
  return new GoogleGenAI({
    apiKey: cleanKey,
    apiVersion: "v1beta",
    ...(cleanBase ? { httpOptions: { baseUrl: cleanBase } } : {}),
  });
}

function mapGeminiSdkError(error: unknown): ProviderHttpError {
  if (error instanceof ProviderHttpError) return error;
  if (error instanceof ApiError) {
    const status = typeof error.status === "number" ? error.status : 500;
    let code: string | undefined;
    let detail = error.message;
    try {
      const parsed = JSON.parse(error.message) as {
        error?: { status?: string; message?: string };
      };
      if (parsed.error?.status) code = parsed.error.status;
      if (parsed.error?.message) detail = parsed.error.message;
    } catch {
      // Message is plain text.
    }
    const mapped = mapProviderError(code, status);
    return new ProviderHttpError(mapped, status, detail);
  }
  const msg =
    error instanceof Error
      ? sanitizeErrorText(error.message)
      : "Gemini request failed";
  return new ProviderHttpError(mapProviderError("ProviderError", 500), 500, msg);
}

/**
 * Classify a Gemini `Model` returned by `ai.models.list()` into one of the
 * studio's supported modalities (`text`, `image`, `video`, `audio`), or return
 * `null` for models that cannot serve any studio generation task.
 */
export function classifyGeminiModel(
  model: Model,
): DiscoveredGeminiModel | null {
  const modelId = (model.name ?? "").replace(/^models\//, "").trim();
  if (!modelId) return null;
  if (NON_STUDIO_GEMINI_PATTERN.test(modelId)) return null;

  const actions = Array.isArray(model.supportedActions)
    ? model.supportedActions.filter((a): a is string => typeof a === "string")
    : [];

  const displayName = model.displayName?.trim() || modelId;

  // Video models (Veo via predictLongRunning)
  if (
    /^veo-/i.test(modelId) ||
    actions.includes("predictLongRunning")
  ) {
    return {
      modelId,
      displayName,
      modality: "video",
      ttsCapable: false,
      supportedActions: actions,
    };
  }

  // Image models (Imagen via predict, or Gemini / Nano Banana image via generateContent)
  if (
    /^imagen-/i.test(modelId) ||
    actions.includes("predict") ||
    /(-image\b|image-|nano-banana)/i.test(modelId)
  ) {
    if (
      actions.length > 0 &&
      !actions.includes("generateContent") &&
      !actions.includes("predict")
    ) {
      return null;
    }
    return {
      modelId,
      displayName,
      modality: "image",
      ttsCapable: false,
      supportedActions: actions,
    };
  }

  // Audio / Voiceover TTS models (Gemini TTS via generateContent)
  if (/(-tts\b|tts-)/i.test(modelId)) {
    if (actions.length > 0 && !actions.includes("generateContent")) {
      return null;
    }
    return {
      modelId,
      displayName,
      modality: "audio",
      ttsCapable: true,
      supportedActions: actions,
    };
  }

  // Remaining generateContent models serve text tasks (Story refine & Prompt polish)
  if (actions.length > 0 && !actions.includes("generateContent")) {
    return null;
  }

  return {
    modelId,
    displayName,
    modality: "text",
    ttsCapable: false,
    supportedActions: actions,
  };
}

/** Return true when a Gemini `Model` supports text `generateContent` for chat/refinement. */
export function isGeminiTextModel(model: Model): boolean {
  const name = (model.name ?? "").replace(/^models\//, "").trim();
  if (!name) return false;
  if (NON_TEXT_GEMINI_PATTERN.test(name)) return false;
  if (Array.isArray(model.supportedActions) && model.supportedActions.length > 0) {
    return model.supportedActions.includes("generateContent");
  }
  return true;
}

/**
 * List all usable Gemini models (text, image, video, audio/TTS) visible to the
 * user's API key via the official `@google/genai` `models.list()` pager
 * (zero tokens spent).
 */
export async function listGeminiModels(
  config: GeminiClientConfig,
): Promise<DiscoveredGeminiModel[]> {
  if (!config.apiKey.trim()) {
    throw new ProviderHttpError(
      mapProviderError("InvalidApiKey", 401),
      401,
      "Google Gemini API key is missing. Add it in Settings → Providers.",
    );
  }

  try {
    const ai = createGeminiClient(config);
    const pager = await ai.models.list({ config: { pageSize: 100 } });
    const byId = new Map<string, DiscoveredGeminiModel>();
    for await (const model of pager) {
      const classified = classifyGeminiModel(model);
      if (classified) {
        byId.set(classified.modelId, classified);
      }
    }
    return Array.from(byId.values()).sort((a, b) =>
      a.modelId.localeCompare(b.modelId),
    );
  } catch (err) {
    throw mapGeminiSdkError(err);
  }
}

/**
 * List available Gemini text model IDs for the user's API key (zero tokens spent).
 */
export async function listGeminiTextModels(
  config: GeminiClientConfig,
): Promise<string[]> {
  const all = await listGeminiModels(config);
  return all.filter((m) => m.modality === "text").map((m) => m.modelId);
}

/** Verify a Google Gemini API key via `models.list({ pageSize: 1 })` (zero tokens spent). */
export async function testGeminiConnection(
  config: GeminiClientConfig,
): Promise<{ ok: boolean; detail: string }> {
  if (!config.apiKey.trim()) {
    return {
      ok: false,
      detail: "Google Gemini API key is not configured.",
    };
  }
  try {
    const ai = createGeminiClient(config);
    await ai.models.list({ config: { pageSize: 1 } });
    return {
      ok: true,
      detail: config.baseUrl?.trim()
        ? `Connected to Google Gemini (${config.baseUrl.trim()})`
        : "Connected to Google Gemini API",
    };
  } catch (err) {
    const mapped = mapGeminiSdkError(err);
    return { ok: false, detail: mapped.message };
  }
}

export interface GeminiChatParams extends ChatCompletionOptions {
  apiKey: string;
  baseUrl?: string;
  model: string;
  messages: ChatMessage[];
}

function extractGeminiUsage(
  meta:
    | {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
      }
    | undefined,
): TokenUsage | null {
  if (!meta) return null;
  const inputTokens =
    typeof meta.promptTokenCount === "number" ? meta.promptTokenCount : null;
  const totalTokens =
    typeof meta.totalTokenCount === "number" ? meta.totalTokenCount : null;
  const outputTokens =
    typeof meta.candidatesTokenCount === "number"
      ? meta.candidatesTokenCount
      : inputTokens !== null && totalTokens !== null
        ? Math.max(0, totalTokens - inputTokens)
        : null;
  if (inputTokens === null || outputTokens === null || totalTokens === null) {
    return null;
  }
  return { inputTokens, outputTokens, totalTokens };
}

/**
 * Run a chat completion against Google Gemini using the official `@google/genai`
 * `models.generateContent()` API with native `systemInstruction` and JSON MIME mode.
 */
export async function geminiChatCompletion({
  apiKey,
  baseUrl,
  model,
  messages,
  maxTokens,
  temperature,
  responseFormat,
  onUsage,
}: GeminiChatParams): Promise<string> {
  if (!apiKey.trim()) {
    throw new ProviderHttpError(
      mapProviderError("InvalidApiKey", 401),
      401,
      "Google Gemini API key is missing. Add it in Settings → Providers.",
    );
  }

  const systemParts: string[] = [];
  const contents: Content[] = [];
  for (const msg of messages) {
    if (msg.role === "system") {
      if (msg.content.trim()) systemParts.push(msg.content);
    } else {
      contents.push({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      });
    }
  }

  try {
    const ai = createGeminiClient({ apiKey, baseUrl });
    const response = await ai.models.generateContent({
      model: model.replace(/^models\//, "").trim(),
      contents,
      config: {
        ...(systemParts.length > 0
          ? { systemInstruction: systemParts.join("\n\n") }
          : {}),
        ...(temperature !== undefined ? { temperature } : {}),
        ...(maxTokens !== undefined ? { maxOutputTokens: maxTokens } : {}),
        ...(responseFormat?.type === "json_object"
          ? { responseMimeType: "application/json" }
          : {}),
      },
    });

    const text = response.text;
    if (typeof text !== "string" || text.length === 0) {
      throw new ProviderHttpError(
        mapProviderError("InvalidResponse", 502),
        502,
        "Gemini generateContent response contained no text output",
      );
    }

    const usage = extractGeminiUsage(response.usageMetadata);
    if (usage && onUsage) {
      try {
        onUsage(usage);
      } catch {
        // Observability must not break generation.
      }
    }

    return text;
  } catch (err) {
    throw mapGeminiSdkError(err);
  }
}

/** Map a studio size string (`"1280*720"`, `"16:9"`, etc.) to a Gemini aspect ratio. */
export function sizeToGeminiAspectRatio(size?: string): string | undefined {
  if (!size) return undefined;
  const clean = size.trim();
  if (/^\d+:\d+$/.test(clean)) return clean;
  const match = clean.match(/^(\d+)\s*[*xX]\s*(\d+)$/);
  if (!match) return undefined;
  const w = Number(match[1]);
  const h = Number(match[2]);
  if (!w || !h) return undefined;
  const ratio = w / h;
  if (Math.abs(ratio - 1) < 0.08) return "1:1";
  if (Math.abs(ratio - 16 / 9) < 0.12) return "16:9";
  if (Math.abs(ratio - 9 / 16) < 0.12) return "9:16";
  if (Math.abs(ratio - 4 / 3) < 0.1) return "4:3";
  if (Math.abs(ratio - 3 / 4) < 0.1) return "3:4";
  if (Math.abs(ratio - 3 / 2) < 0.1) return "3:2";
  if (Math.abs(ratio - 2 / 3) < 0.1) return "2:3";
  if (ratio > 2) return "21:9";
  return ratio > 1 ? "16:9" : "9:16";
}

function parseDataUri(
  uri: string,
): { mimeType: string; data: string } | null {
  const match = uri.match(/^data:([^;]+);base64,(.+)$/i);
  if (!match) return null;
  return { mimeType: match[1].trim(), data: match[2].trim() };
}

export interface GeminiGenerateImageParams extends GeminiClientConfig {
  model: string;
  prompt: string;
  referenceImages?: string[];
  size?: string;
  n?: number;
}

/**
 * Generate an image using either Imagen (`generateImages`) or Gemini native
 * image / Nano Banana models (`generateContent` with `responseModalities: ["IMAGE"]`).
 */
export async function geminiGenerateImage({
  apiKey,
  baseUrl,
  model,
  prompt,
  referenceImages,
  size,
  n,
}: GeminiGenerateImageParams): Promise<{ bytes: Uint8Array; mime: string }> {
  if (!apiKey.trim()) {
    throw new ProviderHttpError(
      mapProviderError("InvalidApiKey", 401),
      401,
      "Google Gemini API key is missing. Add it in Settings → Providers.",
    );
  }

  const cleanModel = model.replace(/^models\//, "").trim();
  const aspectRatio = sizeToGeminiAspectRatio(size);

  try {
    const ai = createGeminiClient({ apiKey, baseUrl });

    if (/^imagen-/i.test(cleanModel)) {
      const response = await ai.models.generateImages({
        model: cleanModel,
        prompt,
        config: {
          numberOfImages: n ?? 1,
          ...(aspectRatio ? { aspectRatio } : {}),
        },
      });
      const img = response.generatedImages?.[0]?.image;
      if (!img?.imageBytes) {
        throw new ProviderHttpError(
          mapProviderError("InvalidResponse", 502),
          502,
          "Imagen response contained no image bytes",
        );
      }
      return {
        bytes: new Uint8Array(Buffer.from(img.imageBytes, "base64")),
        mime: img.mimeType || "image/png",
      };
    }

    const parts: Part[] = [];
    for (const ref of referenceImages ?? []) {
      const parsed = parseDataUri(ref);
      if (parsed) {
        parts.push({
          inlineData: {
            mimeType: parsed.mimeType,
            data: parsed.data,
          },
        });
      }
    }
    parts.push({ text: prompt });

    const response = await ai.models.generateContent({
      model: cleanModel,
      contents: [{ role: "user", parts }],
      config: {
        responseModalities: ["IMAGE"],
        ...(aspectRatio ? { imageConfig: { aspectRatio } } : {}),
      },
    });

    const responseParts = response.candidates?.[0]?.content?.parts ?? [];
    for (const part of responseParts) {
      if (part.inlineData?.data) {
        return {
          bytes: new Uint8Array(Buffer.from(part.inlineData.data, "base64")),
          mime: part.inlineData.mimeType || "image/png",
        };
      }
    }

    throw new ProviderHttpError(
      mapProviderError("InvalidResponse", 502),
      502,
      "Gemini image generation response contained no image data",
    );
  } catch (err) {
    throw mapGeminiSdkError(err);
  }
}

/**
 * Wrap raw 16-bit signed little-endian PCM bytes (`audio/L16;codec=pcm`) in a
 * standard 44-byte RIFF/WAVE header so browsers and players play it cleanly.
 */
export function pcm16ToWav(
  pcmBytes: Uint8Array,
  sampleRate = 24000,
  channels = 1,
  bitsPerSample = 16,
): Uint8Array {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = pcmBytes.byteLength;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // PCM subchunk size
  view.setUint16(20, 1, true); // AudioFormat = PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  new Uint8Array(buffer, 44).set(pcmBytes);
  return new Uint8Array(buffer);
}

export interface GeminiSynthesizeSpeechParams extends GeminiClientConfig {
  model: string;
  text: string;
  voice?: string;
}

/**
 * Generate speech audio using Gemini TTS models via `generateContent` with
 * `responseModalities: ["AUDIO"]` and `speechConfig.voiceConfig`.
 */
export async function geminiSynthesizeSpeech({
  apiKey,
  baseUrl,
  model,
  text,
  voice,
}: GeminiSynthesizeSpeechParams): Promise<{ bytes: Uint8Array; mime: string }> {
  if (!apiKey.trim()) {
    throw new ProviderHttpError(
      mapProviderError("InvalidApiKey", 401),
      401,
      "Google Gemini API key is missing. Add it in Settings → Providers.",
    );
  }

  const cleanModel = model.replace(/^models\//, "").trim();
  const voiceName =
    voice && GEMINI_PREBUILT_VOICES.has(voice.trim()) ? voice.trim() : "Kore";

  try {
    const ai = createGeminiClient({ apiKey, baseUrl });
    const response = await ai.models.generateContent({
      model: cleanModel,
      contents: [{ role: "user", parts: [{ text }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        const rawBytes = new Uint8Array(
          Buffer.from(part.inlineData.data, "base64"),
        );
        const rawMime = (part.inlineData.mimeType ?? "audio/L16;rate=24000").trim();
        if (/audio\/(l16|pcm)/i.test(rawMime)) {
          const rateMatch = rawMime.match(/rate=(\d+)/i);
          const sampleRate = rateMatch ? Number(rateMatch[1]) : 24000;
          return {
            bytes: pcm16ToWav(rawBytes, sampleRate || 24000, 1, 16),
            mime: "audio/wav",
          };
        }
        return { bytes: rawBytes, mime: rawMime.split(";")[0].trim() };
      }
    }

    throw new ProviderHttpError(
      mapProviderError("InvalidResponse", 502),
      502,
      "Gemini TTS response contained no audio data",
    );
  } catch (err) {
    throw mapGeminiSdkError(err);
  }
}

export interface GeminiSubmitVideoParams extends GeminiClientConfig {
  model: string;
  prompt: string;
  firstFrameDataUri?: string;
  lastFrameDataUri?: string;
  aspectRatio?: string;
  resolution?: string;
  durationSeconds?: number;
  generateAudio?: boolean;
}

/** Submit an async video generation operation via `@google/genai` `models.generateVideos()`. */
export async function geminiSubmitVideoTask({
  apiKey,
  baseUrl,
  model,
  prompt,
  firstFrameDataUri,
  lastFrameDataUri,
  aspectRatio,
  resolution,
  durationSeconds,
  generateAudio,
}: GeminiSubmitVideoParams): Promise<{ taskId: string }> {
  if (!apiKey.trim()) {
    throw new ProviderHttpError(
      mapProviderError("InvalidApiKey", 401),
      401,
      "Google Gemini API key is missing. Add it in Settings → Providers.",
    );
  }

  const cleanModel = model.replace(/^models\//, "").trim();
  const firstFrame = firstFrameDataUri ? parseDataUri(firstFrameDataUri) : null;
  const lastFrame = lastFrameDataUri ? parseDataUri(lastFrameDataUri) : null;
  const normResolution =
    resolution && /^(720|1080)p$/i.test(resolution.trim())
      ? resolution.trim().toLowerCase()
      : undefined;
  const normRatio =
    aspectRatio && (aspectRatio === "16:9" || aspectRatio === "9:16")
      ? aspectRatio
      : undefined;

  try {
    const ai = createGeminiClient({ apiKey, baseUrl });
    const operation = await ai.models.generateVideos({
      model: cleanModel,
      prompt,
      ...(firstFrame
        ? {
            image: {
              imageBytes: firstFrame.data,
              mimeType: firstFrame.mimeType,
            },
          }
        : {}),
      config: {
        numberOfVideos: 1,
        ...(normRatio ? { aspectRatio: normRatio } : {}),
        ...(normResolution ? { resolution: normResolution } : {}),
        ...(durationSeconds ? { durationSeconds } : {}),
        ...(generateAudio !== undefined ? { generateAudio } : {}),
        ...(lastFrame
          ? {
              lastFrame: {
                imageBytes: lastFrame.data,
                mimeType: lastFrame.mimeType,
              },
            }
          : {}),
      },
    });

    if (!operation.name) {
      throw new ProviderHttpError(
        mapProviderError("InvalidResponse", 502),
        502,
        "Gemini generateVideos did not return an operation name",
      );
    }

    return { taskId: operation.name };
  } catch (err) {
    throw mapGeminiSdkError(err);
  }
}

/** Poll a Veo long-running video operation via `ai.operations.getVideosOperation()`. */
export async function geminiGetVideoTaskStatus(
  config: GeminiClientConfig & { taskId: string },
): Promise<TaskStatusResult> {
  if (!config.apiKey.trim()) {
    throw new ProviderHttpError(
      mapProviderError("InvalidApiKey", 401),
      401,
      "Google Gemini API key is missing. Add it in Settings → Providers.",
    );
  }

  try {
    const ai = createGeminiClient(config);
    const stub = new GenerateVideosOperation();
    stub.name = config.taskId;
    const op = await ai.operations.getVideosOperation({ operation: stub });

    if (!op.done) {
      return { status: "RUNNING", resultUrls: [] };
    }

    if (op.error) {
      const msg =
        typeof op.error.message === "string"
          ? op.error.message
          : JSON.stringify(op.error);
      return {
        status: "FAILED",
        resultUrls: [],
        errorCode:
          typeof op.error.code === "number" || typeof op.error.code === "string"
            ? String(op.error.code)
            : "GeminiVideoError",
        errorMessage: sanitizeErrorText(msg),
      };
    }

    const videos = op.response?.generatedVideos ?? [];
    const urls = videos
      .map((entry) => entry.video?.uri)
      .filter((u): u is string => typeof u === "string" && u.length > 0);

    if (urls.length === 0) {
      return {
        status: "FAILED",
        resultUrls: [],
        errorCode: "InvalidResponse",
        errorMessage: "Gemini video operation succeeded without a video URI",
      };
    }

    return { status: "SUCCEEDED", resultUrls: urls };
  } catch (err) {
    throw mapGeminiSdkError(err);
  }
}

/** Download a Gemini file/video URI using `x-goog-api-key` authentication. */
export async function downloadGeminiMediaUri(
  apiKey: string,
  uri: string,
): Promise<{ bytes: Uint8Array; mime: string }> {
  const res = await fetch(uri, {
    headers: { "x-goog-api-key": apiKey.trim() },
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) {
    throw new Error(
      `Failed to download Gemini media (${res.status} ${res.statusText})`,
    );
  }
  const buf = await res.arrayBuffer();
  const mime = (res.headers.get("content-type") ?? "video/mp4")
    .split(";")[0]
    .trim();
  return { bytes: new Uint8Array(buf), mime };
}
