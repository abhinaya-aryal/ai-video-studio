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
import { prepareImageMedia } from "@/lib/providers/qwen-oss";
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

export interface SceneVideoRequestDeps {
  prepareImage?: (
    filePath: string,
    imageCountInRequest: number,
  ) => Promise<string>;
  getAssetFilePath?: (
    assetId: string,
  ) => string | null | undefined | Promise<string | null | undefined>;
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

function createDefaultPrepareImage(modelId: string) {
  return async (
    relOrAbsPath: string,
    imageCountInRequest: number,
  ): Promise<string> => {
    const trimmed = relOrAbsPath.trim();
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
  };
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
  const getAssetFilePath = deps.getAssetFilePath ?? defaultGetAssetFilePath;

  let media: MediaItem[] = [];
  let droppedElements: string[] = [];
  let taggedElements: TaggedElement[] | undefined;

  if (scene.videoMode === "first_last_frame") {
    const firstPath = scene.activeKeyframeFirstAssetId
      ? await getAssetFilePath(scene.activeKeyframeFirstAssetId)
      : undefined;

    if (!firstPath) {
      throw new WanValidationError(
        `Scene "${scene.title}" is in first_last_frame mode but has no keyframe asset. Generate a keyframe in Stage 2 first.`,
      );
    }

    const lastPath = scene.activeKeyframeLastAssetId
      ? await getAssetFilePath(scene.activeKeyframeLastAssetId)
      : undefined;

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

    const preparedUrls = await Promise.all(
      kept.map((el) => prepareImage(el.activeImagePath, kept.length)),
    );
    media = preparedUrls.map((url) => ({
      type: "reference_image",
      url,
    }));
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
  const size =
    options.size ??
    (project.aspectRatio === "9:16"
      ? "720*1280"
      : project.aspectRatio === "1:1"
        ? "1024*1024"
        : "1280*720");

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
