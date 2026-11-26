import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import {
  getDb,
  assets,
  jobs,
  projects,
  referenceElements,
  scenes,
  type Asset,
  type Job,
  type JobModality,
} from "@/db";
import {
  ensureProjectDirs,
  resolveInsideProjects,
  slugify,
} from "@/lib/storage/paths";
import { recordUsage } from "@/lib/usage/record";

export type ResultSource =
  | { url: string }
  | { bytes: Uint8Array; mime: string };

export type DownloadFn = (
  url: string,
) => Promise<{ bytes: Uint8Array; mime: string }>;

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
};

const MODALITY_DEFAULT_EXT: Record<JobModality, string> = {
  image: "png",
  video: "mp4",
  audio: "mp3",
};

function resolveExtension(
  modality: JobModality,
  mime?: string,
  url?: string,
): string {
  if (mime) {
    const normalized = mime.split(";")[0].trim().toLowerCase();
    if (MIME_TO_EXT[normalized]) {
      return MIME_TO_EXT[normalized];
    }
  }

  if (url) {
    try {
      const pathname = new URL(url).pathname;
      const ext = path.extname(pathname).replace(/^\./, "").toLowerCase();
      if (/^[a-z0-9]{2,5}$/.test(ext)) {
        return ext;
      }
    } catch {
      // Ignore malformed URLs and fall back to modality default.
    }
  }

  return MODALITY_DEFAULT_EXT[modality];
}

function extractPromptAndParams(requestJson: string): {
  prompt: string;
  paramsJson: string;
} {
  try {
    const parsed = JSON.parse(requestJson) as Record<string, unknown>;
    const body =
      typeof parsed.body === "object" && parsed.body !== null
        ? (parsed.body as Record<string, unknown>)
        : undefined;
    const input =
      typeof body?.input === "object" && body.input !== null
        ? (body.input as Record<string, unknown>)
        : undefined;

    const rawPrompt =
      (typeof parsed.prompt === "string" && parsed.prompt) ||
      (typeof parsed.text === "string" && parsed.text) ||
      (typeof input?.prompt === "string" && input.prompt) ||
      "";

    const rawParams =
      typeof parsed.params === "object" && parsed.params !== null
        ? parsed.params
        : typeof body?.parameters === "object" && body.parameters !== null
          ? body.parameters
          : {};

    return {
      prompt: rawPrompt,
      paramsJson: JSON.stringify(rawParams),
    };
  } catch {
    return { prompt: "", paramsJson: "{}" };
  }
}

/** Default HTTP downloader used when `persistResult` receives a remote URL. */
export async function defaultDownload(
  url: string,
): Promise<{ bytes: Uint8Array; mime: string }> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download result (${res.status} ${res.statusText})`);
  }
  const buf = await res.arrayBuffer();
  const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  return {
    bytes: new Uint8Array(buf),
    mime,
  };
}

/**
 * Persist a completed job's output locally under `PROJECTS_DIR`, insert an
 * `assets` row, link the scene/element active pointer if unset, and mark the
 * job `READY`. Idempotent: if `job.resultAssetId` is already set, returns the
 * existing asset without writing a duplicate file or row.
 */
export async function persistResult(
  job: Job,
  source: ResultSource,
  deps?: { download?: DownloadFn },
): Promise<Asset> {
  const db = getDb();

  const currentJob = db.select().from(jobs).where(eq(jobs.id, job.id)).get();
  const existingAssetId = currentJob?.resultAssetId ?? job.resultAssetId;
  if (existingAssetId) {
    const existingAsset = db
      .select()
      .from(assets)
      .where(eq(assets.id, existingAssetId))
      .get();
    if (existingAsset) {
      return existingAsset;
    }
  }

  const downloadFn = deps?.download ?? defaultDownload;
  const { bytes, mime } =
    "bytes" in source ? source : await downloadFn(source.url);
  const sourceUrl = "url" in source ? source.url : undefined;

  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, job.projectId))
    .get();
  if (!project) {
    throw new Error(`Project not found for job ${job.id}: ${job.projectId}`);
  }

  ensureProjectDirs(project.slug);

  const scopeConditions = [
    eq(assets.projectId, job.projectId),
    eq(assets.role, job.role),
    job.sceneId ? eq(assets.sceneId, job.sceneId) : isNull(assets.sceneId),
    job.elementId
      ? eq(assets.elementId, job.elementId)
      : isNull(assets.elementId),
  ];

  const existingVersions = db
    .select({ version: assets.version })
    .from(assets)
    .where(and(...scopeConditions))
    .all();

  const maxVersion = existingVersions.reduce(
    (max, row) => Math.max(max, row.version),
    0,
  );
  const version = maxVersion + 1;
  const ext = resolveExtension(job.modality, mime, sourceUrl);

  const element = job.elementId
    ? db
        .select()
        .from(referenceElements)
        .where(eq(referenceElements.id, job.elementId))
        .get()
    : undefined;

  const scene = job.sceneId
    ? db.select().from(scenes).where(eq(scenes.id, job.sceneId)).get()
    : undefined;

  let relInsideProject: string;
  if (job.role === "element_sheet" && job.elementId) {
    const elemKind = element?.kind ?? "element";
    const elemSlug = slugify(element?.name ?? job.elementId);
    relInsideProject = `elements/${elemKind}_${elemSlug}_v${version}.${ext}`;
  } else if (job.sceneId) {
    const nn = String(scene?.orderIndex ?? 0).padStart(2, "0");
    const sceneSlug = scene?.slug
      ? slugify(scene.slug)
      : slugify(scene?.title ?? job.sceneId);
    const baseName =
      job.role === "video_clip" ? "clip" : job.role;
    relInsideProject = `scenes/${nn}_${sceneSlug}/${baseName}_v${version}.${ext}`;
  } else {
    const baseName = job.role === "quick_clip" ? "clip" : job.role;
    relInsideProject = `quick_clips/${baseName}_v${version}.${ext}`;
  }

  const filePath = `${project.slug}/${relInsideProject}`;
  const absPath = resolveInsideProjects(filePath);
  mkdirSync(path.dirname(absPath), { recursive: true });
  writeFileSync(absPath, bytes);

  const { prompt, paramsJson } = extractPromptAndParams(job.requestJson);
  const now = Date.now();
  const assetId = randomUUID();

  return db.transaction((tx) => {
    const recheckJob = tx
      .select()
      .from(jobs)
      .where(eq(jobs.id, job.id))
      .get();
    if (recheckJob?.resultAssetId) {
      const existing = tx
        .select()
        .from(assets)
        .where(eq(assets.id, recheckJob.resultAssetId))
        .get();
      if (existing) {
        return existing;
      }
    }

    const newAsset: Asset = {
      id: assetId,
      projectId: job.projectId,
      sceneId: job.sceneId ?? null,
      elementId: job.elementId ?? null,
      type: job.modality,
      role: job.role,
      version,
      filePath,
      prompt,
      paramsJson,
      createdAt: now,
    };

    tx.insert(assets).values(newAsset).run();

    if (job.elementId && job.role === "element_sheet" && element) {
      if (!element.activeImagePath) {
        tx.update(referenceElements)
          .set({ activeImagePath: filePath, updatedAt: now })
          .where(eq(referenceElements.id, element.id))
          .run();
      }
    }

    if (job.sceneId && scene) {
      if (job.role === "keyframe_first" && !scene.activeKeyframeFirstAssetId) {
        tx.update(scenes)
          .set({ activeKeyframeFirstAssetId: assetId, updatedAt: now })
          .where(eq(scenes.id, scene.id))
          .run();
      } else if (
        job.role === "keyframe_last" &&
        !scene.activeKeyframeLastAssetId
      ) {
        tx.update(scenes)
          .set({ activeKeyframeLastAssetId: assetId, updatedAt: now })
          .where(eq(scenes.id, scene.id))
          .run();
      } else if (job.role === "video_clip" && !scene.activeVideoAssetId) {
        tx.update(scenes)
          .set({ activeVideoAssetId: assetId, updatedAt: now })
          .where(eq(scenes.id, scene.id))
          .run();
      } else if (job.role === "voiceover" && !scene.activeAudioAssetId) {
        tx.update(scenes)
          .set({ activeAudioAssetId: assetId, updatedAt: now })
          .where(eq(scenes.id, scene.id))
          .run();
      }
    }

    tx.update(jobs)
      .set({
        resultAssetId: assetId,
        status: "READY",
        errorCode: null,
        errorMessage: null,
        updatedAt: now,
      })
      .where(eq(jobs.id, job.id))
      .run();

    recordUsage(db, {
      jobId: job.id,
      projectId: job.projectId,
      modality: job.modality,
      modelId: job.modelId,
      units: 1,
    });

    return newAsset;
  });
}
