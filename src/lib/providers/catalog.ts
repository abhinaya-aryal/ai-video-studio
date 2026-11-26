import { z } from "zod";
import {
  type CustomModelRow,
  MEDIA_TYPES,
  MODEL_FAMILIES,
  type ModelCapability,
  type ModelFamily,
  type ModelModality,
  UnknownModelError,
} from "@/lib/providers/types";

const MODEL_STUDIO_DOC_URL =
  "https://www.alibabacloud.com/help/en/model-studio/";

type CapabilityTemplate = Omit<ModelCapability, "modelId">;

const WAN3_VIDEO_TEMPLATE: CapabilityTemplate = {
  modality: "video",
  family: "wan3",
  allowedMediaTypes: [
    "first_frame",
    "last_frame",
    "reference_image",
    "reference_video",
    "reference_audio",
    "file",
    "link",
  ],
  maxCounts: {
    first_frame: 1,
    last_frame: 1,
    reference_image: 10,
    reference_video: 5,
    reference_audio: 5,
    file: 1,
    link: 1,
  },
  durations: { min: 2, max: 30, smart: true },
  resolutions: ["480P", "720P", "1080P"],
  nativeAudio: true,
};

const WAN27_IMAGE_TEMPLATE: CapabilityTemplate = {
  modality: "image",
  family: "wan2.7",
  allowedMediaTypes: ["reference_image"],
  maxCounts: { reference_image: 9 },
  maxReferenceImages: 9,
  durations: { min: 0, max: 0, smart: false },
  resolutions: ["1024*1024", "1280*720", "720*1280", "1920*1080", "1080*1920"],
  nativeAudio: false,
};

const TEXT_MODEL_TEMPLATE: CapabilityTemplate = {
  modality: "text",
  family: "text",
  allowedMediaTypes: [],
  maxCounts: {},
  durations: { min: 0, max: 0, smart: false },
  resolutions: [],
  nativeAudio: false,
};

const BUILTIN_CAPABILITIES: Record<string, ModelCapability> = {
  // Source: https://www.alibabacloud.com/help/en/model-studio/ (Wan 3.0 unified video synthesis)
  "wan3.0-video": { modelId: "wan3.0-video", ...WAN3_VIDEO_TEMPLATE },

  // Source: https://www.alibabacloud.com/help/en/model-studio/ (Wan 3.0 Prime unified video synthesis)
  "wan3.0-video-prime": {
    modelId: "wan3.0-video-prime",
    ...WAN3_VIDEO_TEMPLATE,
  },

  // Source: https://www.alibabacloud.com/help/en/model-studio/ (Wan 2.7 Text-to-Video)
  "wan2.7-t2v": {
    modelId: "wan2.7-t2v",
    modality: "video",
    family: "wan2.7",
    allowedMediaTypes: [],
    maxCounts: {},
    durations: { min: 2, max: 15, smart: false },
    resolutions: ["480P", "720P", "1080P"],
    nativeAudio: true,
  },

  // Source: https://www.alibabacloud.com/help/en/model-studio/ (Wan 2.7 Image-to-Video: first_frame / last_frame)
  "wan2.7-i2v": {
    modelId: "wan2.7-i2v",
    modality: "video",
    family: "wan2.7",
    allowedMediaTypes: ["first_frame", "last_frame"],
    maxCounts: { first_frame: 1, last_frame: 1 },
    durations: { min: 2, max: 15, smart: false },
    resolutions: ["480P", "720P", "1080P"],
    nativeAudio: true,
  },

  // Source: https://www.alibabacloud.com/help/en/model-studio/ (Wan 2.7 Reference-to-Video)
  "wan2.7-r2v": {
    modelId: "wan2.7-r2v",
    modality: "video",
    family: "wan2.7",
    allowedMediaTypes: [
      "reference_image",
      "reference_video",
      "reference_audio",
    ],
    maxCounts: {
      reference_image: 10,
      reference_video: 5,
      reference_audio: 5,
    },
    durations: { min: 2, max: 15, smart: false },
    resolutions: ["480P", "720P", "1080P"],
    nativeAudio: true,
  },

  // Source: https://www.alibabacloud.com/help/en/model-studio/ (Wan 2.7 Image Pro: up to 9 reference images)
  "wan2.7-image-pro": {
    modelId: "wan2.7-image-pro",
    ...WAN27_IMAGE_TEMPLATE,
  },

  // Source: https://www.alibabacloud.com/help/en/model-studio/ (Wan 2.7 Image: up to 9 reference images)
  "wan2.7-image": {
    modelId: "wan2.7-image",
    ...WAN27_IMAGE_TEMPLATE,
  },

  // Source: https://www.alibabacloud.com/help/en/model-studio/ (Qwen Image 3.0: up to 3 reference images)
  "qwen-image-3.0": {
    modelId: "qwen-image-3.0",
    modality: "image",
    family: "qwen-image",
    allowedMediaTypes: ["reference_image"],
    maxCounts: { reference_image: 3 },
    maxReferenceImages: 3,
    durations: { min: 0, max: 0, smart: false },
    resolutions: ["1024*1024", "1280*720", "720*1280"],
    nativeAudio: false,
  },

  // Source: https://www.alibabacloud.com/help/en/model-studio/ (Qwen Audio 3.0 TTS Plus)
  "qwen-audio-3.0-tts-plus": {
    modelId: "qwen-audio-3.0-tts-plus",
    modality: "audio",
    family: "qwen-tts",
    allowedMediaTypes: [],
    maxCounts: {},
    durations: { min: 0, max: 0, smart: false },
    resolutions: [],
    nativeAudio: false,
    ttsCapable: true,
  },

  // Source: https://www.alibabacloud.com/help/en/model-studio/ (Qwen Plus text model)
  "qwen-plus": { modelId: "qwen-plus", ...TEXT_MODEL_TEMPLATE },

  // Source: https://www.alibabacloud.com/help/en/model-studio/ (Qwen Max text model)
  "qwen-max": { modelId: "qwen-max", ...TEXT_MODEL_TEMPLATE },

  // Source: https://www.alibabacloud.com/help/en/model-studio/ (Qwen Turbo text model)
  "qwen-turbo": { modelId: "qwen-turbo", ...TEXT_MODEL_TEMPLATE },
};

const CustomCapabilitiesPatchSchema = z
  .object({
    allowedMediaTypes: z.array(z.enum(MEDIA_TYPES)).optional(),
    maxCounts: z
      .partialRecord(z.enum(MEDIA_TYPES), z.number().int().min(0))
      .optional(),
    maxReferenceImages: z.number().int().min(0).optional(),
    durations: z
      .object({
        min: z.number().int().min(0),
        max: z.number().int().min(0),
        smart: z.boolean(),
      })
      .optional(),
    resolutions: z.array(z.string().min(1)).optional(),
    nativeAudio: z.boolean().optional(),
    ttsCapable: z.boolean().optional(),
  })
  .passthrough();

function resolveCustomFamily(
  rawFamily: string,
  modality: ModelModality,
): ModelFamily {
  if ((MODEL_FAMILIES as readonly string[]).includes(rawFamily)) {
    return rawFamily as ModelFamily;
  }
  switch (modality) {
    case "video":
      return "wan3";
    case "image":
      return "qwen-image";
    case "audio":
      return "qwen-tts";
    case "text":
      return "text";
  }
}

export function defaultTemplateFor(
  modality: ModelModality,
  family: ModelFamily,
): CapabilityTemplate {
  if (modality === "video") {
    return family === "wan2.7"
      ? {
          modality: "video",
          family: "wan2.7",
          allowedMediaTypes: ["first_frame", "last_frame"],
          maxCounts: { first_frame: 1, last_frame: 1 },
          durations: { min: 2, max: 15, smart: false },
          resolutions: ["480P", "720P", "1080P"],
          nativeAudio: true,
        }
      : { ...WAN3_VIDEO_TEMPLATE, family };
  }
  if (modality === "image") {
    return family === "wan2.7"
      ? WAN27_IMAGE_TEMPLATE
      : {
          modality: "image",
          family,
          allowedMediaTypes: ["reference_image"],
          maxCounts: { reference_image: 3 },
          maxReferenceImages: 3,
          durations: { min: 0, max: 0, smart: false },
          resolutions: ["1024*1024", "1280*720", "720*1280"],
          nativeAudio: false,
        };
  }
  if (modality === "audio") {
    return {
      modality: "audio",
      family,
      allowedMediaTypes: [],
      maxCounts: {},
      durations: { min: 0, max: 0, smart: false },
      resolutions: [],
      nativeAudio: false,
    };
  }
  return { ...TEXT_MODEL_TEMPLATE, family };
}

function customRowToCapability(row: CustomModelRow): ModelCapability {
  const family = resolveCustomFamily(row.family, row.modality);
  const base = defaultTemplateFor(row.modality, family);

  let rawJson: unknown = {};
  if (row.capabilitiesJson && row.capabilitiesJson.trim().length > 0) {
    try {
      rawJson = JSON.parse(row.capabilitiesJson);
    } catch {
      rawJson = {};
    }
  }

  const parsed = CustomCapabilitiesPatchSchema.safeParse(rawJson);
  const patch = parsed.success ? parsed.data : {};

  return {
    modelId: row.modelId,
    modality: row.modality,
    family,
    allowedMediaTypes: patch.allowedMediaTypes ?? base.allowedMediaTypes,
    maxCounts: patch.maxCounts ?? base.maxCounts,
    maxReferenceImages: patch.maxReferenceImages ?? base.maxReferenceImages,
    durations: patch.durations ?? base.durations,
    resolutions: patch.resolutions ?? base.resolutions,
    nativeAudio: patch.nativeAudio ?? base.nativeAudio,
    ttsCapable: patch.ttsCapable ?? base.ttsCapable,
  };
}

/**
 * Look up capabilities for a built-in or user-registered custom model ID.
 * Throws `UnknownModelError` if the model ID is not found.
 */
export function getModelCapabilities(
  modelId: string,
  custom?: CustomModelRow[],
): ModelCapability {
  const normalized = modelId.trim();
  const customMatch = custom?.find((row) => row.modelId === normalized);
  if (customMatch) {
    return customRowToCapability(customMatch);
  }

  const builtin = BUILTIN_CAPABILITIES[normalized];
  if (builtin) {
    return builtin;
  }

  throw new UnknownModelError(
    modelId,
    `Unknown model ID "${modelId}". Register it as a custom model in Settings or verify against ${MODEL_STUDIO_DOC_URL}.`,
  );
}

/** Return all built-in capabilities merged with any user-registered custom models. */
export function listModelCapabilities(
  custom?: CustomModelRow[],
): ModelCapability[] {
  const merged = new Map<string, ModelCapability>(
    Object.entries(BUILTIN_CAPABILITIES),
  );
  if (custom) {
    for (const row of custom) {
      merged.set(row.modelId, customRowToCapability(row));
    }
  }
  return Array.from(merged.values());
}
