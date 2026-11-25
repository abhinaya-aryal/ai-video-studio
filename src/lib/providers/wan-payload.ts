import {
  type AudioMode,
  type ElementKind,
  type ElementRef,
  type MediaItem,
  type MediaType,
  type ModelCapability,
  type TaggedElement,
  WanValidationError,
} from "@/lib/providers/types";

const FRAME_MEDIA_TYPES = new Set<MediaType>(["first_frame", "last_frame"]);
const REFERENCE_MEDIA_TYPES = new Set<MediaType>([
  "reference_image",
  "reference_video",
  "reference_audio",
  "file",
  "link",
]);

/**
 * Cap linked reference elements to `max`, keeping characters first, then props,
 * then locations (preserving link order within each kind).
 */
export function selectReferenceElements<T extends ElementRef>(
  elements: T[],
  max: number,
): { kept: T[]; dropped: T[] } {
  const byKind: Record<ElementKind, T[]> = {
    character: [],
    prop: [],
    location: [],
  };

  for (const el of elements) {
    byKind[el.kind].push(el);
  }

  const ordered = [
    ...byKind.character,
    ...byKind.prop,
    ...byKind.location,
  ];
  const limit = Math.max(0, Math.floor(max));

  return {
    kept: ordered.slice(0, limit),
    dropped: ordered.slice(limit),
  };
}

export interface CompileScenePromptInput {
  visualPrompt: string;
  cameraDirection?: string;
  audioMode: AudioMode;
  audioScript?: string;
  styleBible?: string;
  taggedElements?: TaggedElement[];
}

/**
 * Compile a scene's visual prompt, camera cues, style bible, `@Image N` element tags,
 * and audio mode instructions into a final Wan prompt and native-audio boolean.
 */
export function compileScenePrompt(input: CompileScenePromptInput): {
  prompt: string;
  audio: boolean;
} {
  const parts: string[] = [];
  const visual = input.visualPrompt.trim();
  if (visual) {
    parts.push(visual);
  }

  if (input.taggedElements && input.taggedElements.length > 0) {
    const missingTags = input.taggedElements.filter(
      (el) => !visual.includes(el.tag),
    );
    if (missingTags.length > 0) {
      const formatted = missingTags
        .map((el) => `${el.tag} (${el.name}, ${el.kind})`)
        .join("; ");
      parts.push(`References: ${formatted}.`);
    }
  }

  const camera = input.cameraDirection?.trim();
  if (camera) {
    parts.push(`Camera: ${camera}`);
  }

  const style = input.styleBible?.trim();
  if (style) {
    parts.push(`Style: ${style}`);
  }

  const audio = input.audioMode !== "silent";
  const script = input.audioScript?.trim();

  if (audio) {
    if (input.audioMode === "dialogue" && script) {
      parts.push(`Dialogue: ${script}`);
    } else if (input.audioMode === "narration" && script) {
      parts.push(`Narration: ${script}`);
    } else if (input.audioMode === "ambient_only") {
      parts.push(
        script
          ? `Ambient audio: ${script}`
          : "Ambient soundscape only, no spoken dialogue.",
      );
    }
  }

  return {
    prompt: parts.join("\n"),
    audio,
  };
}

export interface BuildVideoSynthesisInput {
  modelId: string;
  prompt: string;
  audio: boolean;
  media: MediaItem[];
  duration: number;
  resolution: string;
  ratio: string;
  promptExtend?: boolean;
}

export interface VideoSynthesisRequestBody {
  model: string;
  input: {
    prompt: string;
    media?: MediaItem[];
  };
  parameters: {
    duration: number;
    resolution: string;
    ratio: string;
    audio: boolean;
    prompt_extend?: boolean;
  };
}

function validateMediaItems(media: MediaItem[], cap: ModelCapability): void {
  const counts: Partial<Record<MediaType, number>> = {};
  let hasFrame = false;
  let hasReference = false;

  for (const item of media) {
    if (!item.url || item.url.trim().length === 0) {
      throw new WanValidationError(
        `Media item of type "${item.type}" must have a non-empty url.`,
      );
    }

    if (!cap.allowedMediaTypes.includes(item.type)) {
      throw new WanValidationError(
        `Model "${cap.modelId}" does not support media type "${item.type}".`,
      );
    }

    if (FRAME_MEDIA_TYPES.has(item.type)) {
      hasFrame = true;
    }
    if (REFERENCE_MEDIA_TYPES.has(item.type)) {
      hasReference = true;
    }

    counts[item.type] = (counts[item.type] ?? 0) + 1;
  }

  if (hasFrame && hasReference) {
    throw new WanValidationError(
      "first_frame/last_frame cannot be combined with reference_*, file, or link media.",
    );
  }

  for (const [type, count] of Object.entries(counts) as [MediaType, number][]) {
    const max = cap.maxCounts[type];
    if (max !== undefined && count > max) {
      throw new WanValidationError(
        `Too many "${type}" media items for model "${cap.modelId}": got ${count}, max ${max}.`,
      );
    }
  }
}

function validateVideoParameters(
  input: BuildVideoSynthesisInput,
  cap: ModelCapability,
): void {
  if (input.duration === -1) {
    if (!cap.durations.smart) {
      throw new WanValidationError(
        `Model "${cap.modelId}" does not support smart duration (-1).`,
      );
    }
  } else if (
    !Number.isFinite(input.duration) ||
    input.duration < cap.durations.min ||
    input.duration > cap.durations.max
  ) {
    throw new WanValidationError(
      `Invalid duration ${input.duration}s for model "${cap.modelId}" (expected ${cap.durations.min}-${cap.durations.max}s${cap.durations.smart ? " or -1" : ""}).`,
    );
  }

  if (
    cap.resolutions.length > 0 &&
    !cap.resolutions.includes(input.resolution)
  ) {
    throw new WanValidationError(
      `Invalid resolution "${input.resolution}" for model "${cap.modelId}" (allowed: ${cap.resolutions.join(", ")}).`,
    );
  }

  if (!input.ratio || input.ratio.trim().length === 0) {
    throw new WanValidationError("Aspect ratio must not be empty.");
  }

  if (input.audio && !cap.nativeAudio) {
    throw new WanValidationError(
      `Model "${cap.modelId}" does not support native audio.`,
    );
  }
}

/**
 * Validate video synthesis inputs against the model's capability profile and
 * build the DashScope request body plus `X-DashScope-OssResourceResolve` flag.
 */
export function buildVideoSynthesisPayload(
  input: BuildVideoSynthesisInput,
  cap: ModelCapability,
): { body: VideoSynthesisRequestBody; needsOssHeader: boolean } {
  if (cap.modality !== "video") {
    throw new WanValidationError(
      `Model "${cap.modelId}" is not a video model (modality: "${cap.modality}").`,
    );
  }

  if (input.modelId !== cap.modelId) {
    throw new WanValidationError(
      `Model mismatch: request model "${input.modelId}" does not match capability "${cap.modelId}".`,
    );
  }

  const prompt = input.prompt.trim();
  if (!prompt) {
    throw new WanValidationError("Prompt must not be empty.");
  }

  validateMediaItems(input.media, cap);
  validateVideoParameters(input, cap);

  const normalizedMedia = input.media.map((item) => ({
    type: item.type,
    url: item.url.trim(),
  }));

  const needsOssHeader = normalizedMedia.some((item) =>
    item.url.startsWith("oss://"),
  );

  const body: VideoSynthesisRequestBody = {
    model: input.modelId,
    input: {
      prompt,
      ...(normalizedMedia.length > 0 ? { media: normalizedMedia } : {}),
    },
    parameters: {
      duration: input.duration,
      resolution: input.resolution,
      ratio: input.ratio.trim(),
      audio: input.audio,
      ...(input.promptExtend !== undefined
        ? { prompt_extend: input.promptExtend }
        : {}),
    },
  };

  return { body, needsOssHeader };
}
