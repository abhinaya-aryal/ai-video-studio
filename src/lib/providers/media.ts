import fs from "node:fs";
import path from "node:path";
import { getDb, type CustomModel } from "@/db";
import { getConfig } from "@/lib/config";
import { getModelCapabilities } from "@/lib/providers/catalog";
import {
  ProviderHttpError,
  mapProviderError,
} from "@/lib/providers/errors";
import {
  ModelSelectionError,
  resolveSlotModel,
  type ResolveSlotOptions,
} from "@/lib/providers/model-selection";
import type { ModelCapability } from "@/lib/providers/types";
import {
  normalizeCachedProviderItems,
  readProviderModelsCache,
} from "@/lib/settings/provider-models";
import { readCredentialsFile } from "@/lib/settings/store";
import { resolveInsideProjects } from "@/lib/storage/paths";

export type MediaSlot = "image" | "video" | "audio";

export type ResolvedMediaTarget =
  | {
      providerKind: "gemini";
      providerId: string;
      providerName: string;
      apiKey: string;
      baseUrl?: string;
      modelId: string;
      capabilities: ModelCapability;
    }
  | {
      providerKind: "qwen";
      modelId: string;
      capabilities: ModelCapability;
    };

/** Build studio capability metadata for a Gemini image, video, or TTS model. */
export function getGeminiModelCapabilities(
  modelId: string,
  modality: MediaSlot,
): ModelCapability {
  const clean = modelId.trim();
  if (modality === "image") {
    const isImagen = /^imagen-/i.test(clean);
    return {
      modelId: clean,
      modality: "image",
      family: "qwen-image",
      allowedMediaTypes: isImagen ? [] : ["reference_image"],
      maxCounts: isImagen ? {} : { reference_image: 4 },
      maxReferenceImages: isImagen ? 0 : 4,
      durations: { min: 0, max: 0, smart: false },
      resolutions: ["1024*1024", "1280*720", "720*1280"],
      nativeAudio: false,
      ttsCapable: false,
    };
  }
  if (modality === "video") {
    return {
      modelId: clean,
      modality: "video",
      family: "wan2.7",
      allowedMediaTypes: ["first_frame", "last_frame"],
      maxCounts: { first_frame: 1, last_frame: 1 },
      durations: { min: 4, max: 8, smart: false },
      resolutions: ["720P", "1080P"],
      nativeAudio: true,
      ttsCapable: false,
    };
  }
  return {
    modelId: clean,
    modality: "audio",
    family: "qwen-tts",
    allowedMediaTypes: [],
    maxCounts: {},
    durations: { min: 0, max: 0, smart: false },
    resolutions: [],
    nativeAudio: false,
    ttsCapable: true,
  };
}

function findGeminiModelMatch(
  slot: MediaSlot,
  modelId: string,
): ResolvedMediaTarget | null {
  const cfg = getConfig();
  const providers = (cfg.providers ?? []).filter(
    (p) => p.kind === "gemini" && p.enabled,
  );
  if (providers.length === 0) return null;

  const cache = readProviderModelsCache(cfg.dataDir);
  const creds = readCredentialsFile(cfg.dataDir);

  for (const provider of providers) {
    const items = normalizeCachedProviderItems(cache[provider.id]);
    const match = items.find(
      (item) => item.modelId === modelId && item.modality === slot,
    );
    if (match) {
      const apiKey = creds[provider.id]?.trim();
      if (!apiKey) {
        throw new ProviderHttpError(
          mapProviderError("InvalidApiKey", 401),
          401,
          `API key for "${provider.name}" is missing. Add it in Settings → Providers.`,
        );
      }
      return {
        providerKind: "gemini",
        providerId: provider.id,
        providerName: provider.name,
        apiKey,
        baseUrl: provider.baseUrl,
        modelId: match.modelId,
        capabilities: getGeminiModelCapabilities(match.modelId, slot),
      };
    }
  }
  return null;
}

/**
 * Resolve which provider and model should serve a media generation task
 * (`image`, `video`, or `audio`). Supports explicit overrides, UI role bindings
 * for Google Gemini (`settings.json`), and QwenCloud SQLite slot selections.
 */
export function resolveMediaTarget(
  slot: MediaSlot,
  options: ResolveSlotOptions = {},
  customRows?: CustomModel[],
): ResolvedMediaTarget {
  const cfg = getConfig();

  const explicit = options.explicitModelId?.trim();
  if (explicit) {
    const geminiExplicit = findGeminiModelMatch(slot, explicit);
    if (geminiExplicit) return geminiExplicit;
  }

  const projectModel =
    slot === "video" ? options.projectModelId?.trim() : undefined;
  if (!explicit && projectModel) {
    const geminiProject = findGeminiModelMatch(slot, projectModel);
    if (geminiProject) return geminiProject;
  }

  // Check UI role binding when no explicit Qwen override was requested.
  if (!explicit && !projectModel) {
    const binding = cfg.roleProviders?.[slot];
    if (binding?.providerId && binding.modelId?.trim()) {
      const provider = (cfg.providers ?? []).find(
        (p) => p.id === binding.providerId && p.enabled,
      );
      if (provider && provider.kind === "gemini") {
        const creds = readCredentialsFile(cfg.dataDir);
        const apiKey = creds[provider.id]?.trim();
        if (!apiKey) {
          throw new ProviderHttpError(
            mapProviderError("InvalidApiKey", 401),
            401,
            `API key for "${provider.name}" is missing. Add it in Settings → Providers.`,
          );
        }
        const modelId = binding.modelId.trim();
        return {
          providerKind: "gemini",
          providerId: provider.id,
          providerName: provider.name,
          apiKey,
          baseUrl: provider.baseUrl,
          modelId,
          capabilities: getGeminiModelCapabilities(modelId, slot),
        };
      }
    }
  }

  const db = getDb();
  try {
    const resolved = resolveSlotModel(db, slot, options);
    const capabilities = getModelCapabilities(resolved.modelId, customRows);
    return {
      providerKind: "qwen",
      modelId: resolved.modelId,
      capabilities,
    };
  } catch (err) {
    if (err instanceof ModelSelectionError) throw err;
    throw err;
  }
}

const EXT_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/**
 * Convert a project-relative image path or `data:` URI into a `data:<mime>;base64,...`
 * URI for inline Gemini multimodal requests without requiring DashScope OSS.
 */
export async function prepareGeminiImageDataUri(
  relOrUrl: string,
): Promise<string> {
  const trimmed = relOrUrl.trim();
  if (trimmed.startsWith("data:")) {
    return trimmed;
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    const res = await fetch(trimmed, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      throw new Error(`Failed to fetch reference image (${res.status})`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = (res.headers.get("content-type") ?? "image/png")
      .split(";")[0]
      .trim();
    return `data:${mime};base64,${buf.toString("base64")}`;
  }
  const absPath = resolveInsideProjects(trimmed);
  const bytes = fs.readFileSync(absPath);
  const ext = path.extname(absPath).toLowerCase();
  const mime = EXT_TO_MIME[ext] ?? "image/png";
  return `data:${mime};base64,${bytes.toString("base64")}`;
}
