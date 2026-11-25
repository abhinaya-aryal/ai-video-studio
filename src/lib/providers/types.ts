import type {
  AudioMode,
  CustomModel,
  CustomModelModality,
  ElementKind,
} from "@/db/schema";

export type { AudioMode, ElementKind };

/** Custom model row shape stored in SQLite (`custom_models`). */
export type CustomModelRow = CustomModel;

/** Supported DashScope / Wan `input.media[].type` values. */
export const MEDIA_TYPES = [
  "first_frame",
  "last_frame",
  "reference_image",
  "reference_video",
  "reference_audio",
  "file",
  "link",
] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

/** Supported model families in the capability catalog. */
export const MODEL_FAMILIES = [
  "wan3",
  "wan2.7",
  "qwen-image",
  "qwen-tts",
  "text",
] as const;
export type ModelFamily = (typeof MODEL_FAMILIES)[number];

export type ModelModality = CustomModelModality;

/** Capability profile for a built-in or user-registered model. */
export interface ModelCapability {
  modelId: string;
  modality: ModelModality;
  family: ModelFamily;
  allowedMediaTypes: MediaType[];
  maxCounts: Partial<Record<MediaType, number>>;
  maxReferenceImages?: number;
  durations: {
    min: number;
    max: number;
    smart: boolean;
  };
  resolutions: string[];
  nativeAudio: boolean;
}

/** Minimal reference element descriptor used for priority-ordered capping. */
export interface ElementRef {
  id: string;
  kind: ElementKind;
  name?: string;
}

/** Positional prompt reference tag mapping an element to `@Image N`. */
export interface TaggedElement {
  tag: string;
  name: string;
  kind: ElementKind;
}

/** Single item in a DashScope `input.media[]` array. */
export interface MediaItem {
  type: MediaType;
  url: string;
}

/** Thrown when resolving capabilities for an unregistered model ID. */
export class UnknownModelError extends Error {
  readonly modelId: string;

  constructor(modelId: string, message?: string) {
    super(message ?? `Unknown model ID: "${modelId}"`);
    this.name = "UnknownModelError";
    this.modelId = modelId;
  }
}

/** Thrown when a Wan video synthesis request violates model capability or mutual-exclusion rules. */
export class WanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WanValidationError";
  }
}
