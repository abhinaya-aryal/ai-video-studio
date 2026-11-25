import { eq } from "drizzle-orm";
import {
  assets,
  getDb,
  type Project,
  type ReferenceElement,
  type Scene,
} from "@/db";
import { getConfig } from "@/lib/config";
import type {
  PreparedImageRequest,
  PreparedVideoRequest,
} from "@/lib/jobs/runner";
import {
  ProviderHttpError,
  mapProviderError,
} from "@/lib/providers/errors";
import { resolveQwenBaseUrl } from "@/lib/providers/qwen-endpoints";
import {
  prepareImageMedia,
  uploadToDashScopeOss,
} from "@/lib/providers/qwen-oss";
import {
  type MediaItem,
  type ModelCapability,
  type TaggedElement,
  WanValidationError,
} from "@/lib/providers/types";
import {
  buildVideoSynthesisPayload,
  compileScenePrompt,
  selectReferenceElements,
} from "@/lib/providers/wan-payload";
import { resolveInsideProjects } from "@/lib/storage/paths";

/** Per-scene media uploaded in Stage 3 (project-relative paths or URLs). */
export interface SceneMediaUploads {
  firstFrame?: string;
  lastFrame?: string;
  refImages?: string[];
  refVideos?: string[];
  refAudios?: string[];
}

export interface SceneVideoRequestDeps {
  prepareImage?: (
    filePath: string,
    imageCountInRequest: number,
  ) => Promise<string>;
  prepareMedia?: (filePath: string) => Promise<string>;
  getAssetFilePath?: (
    assetId: string,
  ) => string | null | undefined | Promise<string | null | undefined>;
  uploads?: SceneMediaUploads;
}

export interface BuiltSceneVideoRequest {
  payload: PreparedVideoRequest;
  droppedElements: string[];
}

function defaultGetAssetFilePath(assetId: string): string | undefined {
  const row = getDb()
    .select({ filePath: assets.filePath })
    .from(assets)
    .where(eq(assets.id, assetId))
    .get();
  return row?.filePath;
}

const IMAGE_SIZE_BY_RATIO: Record<string, string> = {
  "16:9": "1280*720",
  "9:16": "720*1280",
  "1:1": "1024*1024",
};

/** Map a project aspect ratio string (e.g. `16:9`, `9:16`, `1:1`) to a Wan image size. */
export function aspectRatioToImageSize(aspectRatio: string): string {
  return IMAGE_SIZE_BY_RATIO[aspectRatio.trim()] ?? "1280*720";
}

/**
 * Prepare an image path (project-relative or already a URL/data/oss URI) for a
 * Qwen/Wan API request using Base64 or temporary DashScope OSS upload.
 */
export async function prepareProjectImagePath(
  relOrUrl: string,
  modelId: string,
  imageCountInRequest: number,
): Promise<string> {
  const trimmed = relOrUrl.trim();
  if (
    trimmed.startsWith("oss://") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("data:")
  ) {
    return trimmed;
  }

  const cfg = getConfig();
  const apiKey = cfg.qwen.apiKey?.trim();
  if (!apiKey) {
    throw new ProviderHttpError(
      mapProviderError("InvalidApiKey", 401),
      401,
      "QWEN_API_KEY is missing in .env.local",
    );
  }

  const absPath = resolveInsideProjects(trimmed);
  return prepareImageMedia({
    baseUrl: resolveQwenBaseUrl(cfg.qwen),
    apiKey,
    model: modelId,
    filePath: absPath,
    imageCountInRequest,
  });
}

function createDefaultPrepareImage(modelId: string) {
  return (relOrAbsPath: string, imageCountInRequest: number) =>
    prepareProjectImagePath(relOrAbsPath, modelId, imageCountInRequest);
}

/**
 * Prepare a non-image media path (video/audio) for a Wan request. Video and
 * audio always go through temporary DashScope OSS, so local project paths are
 * uploaded while existing URLs are passed through unchanged.
 */
export async function prepareProjectMediaPath(
  relOrUrl: string,
  modelId: string,
): Promise<string> {
  const trimmed = relOrUrl.trim();
  if (
    trimmed.startsWith("oss://") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("data:")
  ) {
    return trimmed;
  }

  const cfg = getConfig();
  const apiKey = cfg.qwen.apiKey?.trim();
  if (!apiKey) {
    throw new ProviderHttpError(
      mapProviderError("InvalidApiKey", 401),
      401,
      "QWEN_API_KEY is missing in .env.local",
    );
  }

  return uploadToDashScopeOss({
    baseUrl: resolveQwenBaseUrl(cfg.qwen),
    apiKey,
    model: modelId,
    filePath: resolveInsideProjects(trimmed),
  });
}

function createDefaultPrepareMedia(modelId: string) {
  return (relOrAbsPath: string) => prepareProjectMediaPath(relOrAbsPath, modelId);
}

function parseLinkedElementIds(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

/**
 * Build a validated Wan video synthesis `PreparedVideoRequest` for a storyboard scene,
 * applying kind-priority element capping (`@Image N` tags) in `omni_reference` mode
 * or keyframe-only media in `first_last_frame` mode.
 */
export async function buildSceneVideoRequest(
  scene: Scene,
  elements: ReferenceElement[],
  project: Pick<
    Project,
    "styleBible" | "aspectRatio" | "resolution" | "defaultVideoModel"
  >,
  cap: ModelCapability,
  deps: SceneVideoRequestDeps = {},
): Promise<BuiltSceneVideoRequest> {
  const prepareImage =
    deps.prepareImage ?? createDefaultPrepareImage(cap.modelId);
  const prepareMedia =
    deps.prepareMedia ?? createDefaultPrepareMedia(cap.modelId);
  const getAssetFilePath = deps.getAssetFilePath ?? defaultGetAssetFilePath;
  const uploads = deps.uploads ?? {};

  let media: MediaItem[] = [];
  let droppedElements: string[] = [];
  let taggedElements: TaggedElement[] | undefined;

  if (scene.videoMode === "first_last_frame") {
    const uploadedFirst = uploads.firstFrame?.trim() || undefined;
    const firstPath =
      uploadedFirst ??
      (scene.activeKeyframeFirstAssetId
        ? await getAssetFilePath(scene.activeKeyframeFirstAssetId)
        : undefined);

    if (!firstPath) {
      throw new WanValidationError(
        `Scene "${scene.title}" is in first_last_frame mode but has no keyframe asset. Generate a keyframe in Stage 2 first, or upload a first frame.`,
      );
    }

    const uploadedLast = uploads.lastFrame?.trim() || undefined;
    const lastPath =
      uploadedLast ??
      (scene.activeKeyframeLastAssetId
        ? await getAssetFilePath(scene.activeKeyframeLastAssetId)
        : undefined);

    const imageCount = lastPath ? 2 : 1;
    const firstUrl = await prepareImage(firstPath, imageCount);
    media.push({ type: "first_frame", url: firstUrl });

    if (lastPath) {
      const lastUrl = await prepareImage(lastPath, imageCount);
      media.push({ type: "last_frame", url: lastUrl });
    }
  } else if (scene.videoMode === "omni_reference") {
    const linkedIds = parseLinkedElementIds(scene.linkedElementIdsJson);
    const byId = new Map(elements.map((el) => [el.id, el]));
    const linkedWithImages = linkedIds
      .map((id) => byId.get(id))
      .filter(
        (el): el is ReferenceElement & { activeImagePath: string } =>
          Boolean(el && el.activeImagePath && el.activeImagePath.trim()),
      );

    const maxRefImages = cap.maxCounts.reference_image ?? 0;
    const { kept, dropped } = selectReferenceElements(
      linkedWithImages,
      maxRefImages,
    );
    droppedElements = dropped.map((el) => el.name);

    taggedElements = kept.map((el, idx) => ({
      tag: `@Image ${idx + 1}`,
      name: el.name,
      kind: el.kind,
    }));

    // Uploaded references fill the remaining slots after linked elements, so
    // the kind-priority cap and `@Image N` order stay stable.
    const uploadedImages = (uploads.refImages ?? [])
      .map((path) => path.trim())
      .filter(Boolean)
      .slice(0, Math.max(0, maxRefImages - kept.length));
    const imageCount = kept.length + uploadedImages.length;

    const preparedUrls = await Promise.all([
      ...kept.map((el) => prepareImage(el.activeImagePath, imageCount)),
      ...uploadedImages.map((path) => prepareImage(path, imageCount)),
    ]);
    media = preparedUrls.map((url) => ({
      type: "reference_image",
      url,
    }));

    const maxVideos = cap.allowedMediaTypes.includes("reference_video")
      ? (cap.maxCounts.reference_video ?? 0)
      : 0;
    const uploadedVideos = (uploads.refVideos ?? [])
      .map((path) => path.trim())
      .filter(Boolean)
      .slice(0, maxVideos);
    const preparedVideos = await Promise.all(
      uploadedVideos.map((path) => prepareMedia(path)),
    );
    media.push(
      ...preparedVideos.map((url) => ({
        type: "reference_video" as const,
        url,
      })),
    );

    const maxAudios = cap.allowedMediaTypes.includes("reference_audio")
      ? (cap.maxCounts.reference_audio ?? 0)
      : 0;
    const uploadedAudios = (uploads.refAudios ?? [])
      .map((path) => path.trim())
      .filter(Boolean)
      .slice(0, maxAudios);
    const preparedAudios = await Promise.all(
      uploadedAudios.map((path) => prepareMedia(path)),
    );
    media.push(
      ...preparedAudios.map((url) => ({
        type: "reference_audio" as const,
        url,
      })),
    );
  }

  const { prompt, audio } = compileScenePrompt({
    visualPrompt: scene.visualPrompt,
    cameraDirection: scene.cameraDirection,
    audioMode: scene.audioMode,
    audioScript: scene.audioScript,
    styleBible: project.styleBible,
    taggedElements,
  });

  const { body, needsOssHeader } = buildVideoSynthesisPayload(
    {
      modelId: cap.modelId,
      prompt,
      audio,
      media,
      duration: scene.duration,
      resolution: project.resolution,
      ratio: project.aspectRatio,
    },
    cap,
  );

  return {
    payload: {
      modality: "video",
      body,
      needsOssHeader,
      prompt,
      params: {
        resolution: project.resolution,
        ratio: project.aspectRatio,
        duration: scene.duration,
        videoMode: scene.videoMode,
      },
    },
    droppedElements,
  };
}

export interface SceneKeyframeOptions {
  position?: "first" | "last";
  promptOverride?: string;
  size?: string;
  referenceElementIds?: string[];
}

/**
 * Build a `PreparedImageRequest` for a scene keyframe (`keyframe_first` or `keyframe_last`),
 * capping linked element images to the image model's `reference_image` limit.
 */
export async function buildSceneKeyframeRequest(
  scene: Scene,
  elements: ReferenceElement[],
  project: Pick<Project, "styleBible" | "aspectRatio">,
  cap: ModelCapability,
  options: SceneKeyframeOptions = {},
  deps: Pick<SceneVideoRequestDeps, "prepareImage"> = {},
): Promise<{ payload: PreparedImageRequest; droppedElements: string[] }> {
  const prepareImage =
    deps.prepareImage ?? createDefaultPrepareImage(cap.modelId);

  const elementIds =
    options.referenceElementIds ??
    parseLinkedElementIds(scene.linkedElementIdsJson);
  const byId = new Map(elements.map((el) => [el.id, el]));
  const linkedWithImages = elementIds
    .map((id) => byId.get(id))
    .filter(
      (el): el is ReferenceElement & { activeImagePath: string } =>
        Boolean(el && el.activeImagePath && el.activeImagePath.trim()),
    );

  const maxRefs =
    cap.maxReferenceImages ?? cap.maxCounts.reference_image ?? 0;
  const { kept, dropped } = selectReferenceElements(linkedWithImages, maxRefs);

  const taggedElements: TaggedElement[] = kept.map((el, idx) => ({
    tag: `@Image ${idx + 1}`,
    name: el.name,
    kind: el.kind,
  }));

  const referenceImages = await Promise.all(
    kept.map((el) => prepareImage(el.activeImagePath, kept.length)),
  );

  const baseVisual = options.promptOverride?.trim() || scene.visualPrompt;
  const { prompt } = compileScenePrompt({
    visualPrompt:
      options.position === "last"
        ? `End frame of shot: ${baseVisual}`
        : baseVisual,
    cameraDirection: scene.cameraDirection,
    audioMode: "silent",
    styleBible: project.styleBible,
    taggedElements,
  });

  const needsOssHeader = referenceImages.some((url) => url.startsWith("oss://"));
  const size = options.size ?? aspectRatioToImageSize(project.aspectRatio);

  return {
    payload: {
      modality: "image",
      prompt,
      referenceImages,
      size,
      n: 1,
      needsOssHeader,
      params: {
        position: options.position ?? "first",
        size,
      },
    },
    droppedElements: dropped.map((el) => el.name),
  };
}
