import { defaultTemplateFor, getModelCapabilities } from "@/lib/providers/catalog";
import type {
  ModelCapability,
  ModelFamily,
  ModelModality,
} from "@/lib/providers/types";

export interface InferredModel {
  modality: ModelModality;
  family: ModelFamily;
  ttsCapable: boolean;
}

const NON_TTS_AUDIO = /(asr|realtime)/i;

/**
 * Classify a provider model ID into a modality and family. Unknown IDs become
 * text models, which is the only modality the studio can drive without
 * knowing media rules.
 */
export function inferModel(modelId: string): InferredModel {
  const id = modelId.trim().toLowerCase();

  if (id === "wan3.0-video" || id === "wan3.0-video-prime") {
    return { modality: "video", family: "wan3", ttsCapable: false };
  }
  if (/^wan2\.7-(r2v|i2v|t2v)/.test(id)) {
    return { modality: "video", family: "wan2.7", ttsCapable: false };
  }
  if (id.startsWith("wan") && id.includes("image")) {
    return { modality: "image", family: "wan2.7", ttsCapable: false };
  }
  if (id.startsWith("qwen-image") || (id.includes("image") && id.startsWith("qwen"))) {
    return { modality: "image", family: "qwen-image", ttsCapable: false };
  }
  if (id.includes("image")) {
    return { modality: "image", family: "qwen-image", ttsCapable: false };
  }
  if (id.includes("audio")) {
    return {
      modality: "audio",
      family: "qwen-tts",
      ttsCapable: !NON_TTS_AUDIO.test(id),
    };
  }
  if (id.includes("video")) {
    return { modality: "video", family: "wan3", ttsCapable: false };
  }
  return { modality: "text", family: "text", ttsCapable: false };
}

/**
 * Build capabilities for a discovered model ID. Built-in IDs keep their
 * catalog rules. Unrecognised IDs start conservative and can be widened in
 * the model editor.
 */
export function inferCapabilities(modelId: string): ModelCapability {
  try {
    return getModelCapabilities(modelId);
  } catch {
    // Fall through to inference for IDs the catalog does not know.
  }

  const inferred = inferModel(modelId);
  const base = defaultTemplateFor(inferred.modality, inferred.family);

  if (inferred.modality === "video") {
    const known =
      /^wan2\.7-(r2v|i2v|t2v)/.test(modelId.toLowerCase()) ||
      modelId.toLowerCase().startsWith("wan3.0-video");
    if (!known) {
      return {
        modelId,
        modality: "video",
        family: inferred.family,
        allowedMediaTypes: [],
        maxCounts: {},
        durations: { min: 2, max: 15, smart: false },
        resolutions: ["480P", "720P", "1080P"],
        nativeAudio: false,
        ttsCapable: false,
      };
    }
  }

  if (inferred.modality === "image") {
    const known =
      /^wan[\d.]+-image/.test(modelId.toLowerCase()) ||
      modelId.toLowerCase().startsWith("qwen-image");
    if (!known) {
      return {
        modelId,
        modality: "image",
        family: inferred.family,
        allowedMediaTypes: ["reference_image"],
        maxCounts: { reference_image: 1 },
        maxReferenceImages: 1,
        durations: { min: 0, max: 0, smart: false },
        resolutions: ["1024*1024"],
        nativeAudio: false,
        ttsCapable: false,
      };
    }
  }

  return {
    modelId,
    ...base,
    ttsCapable: inferred.ttsCapable || base.ttsCapable,
  };
}

/** Serialize the inferred capability fields for storage in `capabilities_json`. */
export function capabilityPatchJson(modelId: string): string {
  const capability = inferCapabilities(modelId);
  return JSON.stringify({
    allowedMediaTypes: capability.allowedMediaTypes,
    maxCounts: capability.maxCounts,
    maxReferenceImages: capability.maxReferenceImages,
    durations: capability.durations,
    resolutions: capability.resolutions,
    nativeAudio: capability.nativeAudio,
    ttsCapable: capability.ttsCapable,
  });
}