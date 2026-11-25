import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { ZipArchive } from "archiver";
import { asc, eq } from "drizzle-orm";
import {
  assets,
  getDb,
  projects,
  referenceElements,
  scenes,
  type Asset,
  type Project,
  type ReferenceElement,
  type Scene,
} from "@/db";
import {
  ensureProjectDirs,
  resolveInsideProjects,
  slugify,
  writeStoryMarkdown,
} from "@/lib/storage/paths";

export interface KdenliveExportResult {
  dir: string;
  files: string[];
  missingScenes: string[];
}

export interface KdenliveClipInput {
  file: string;
  durationSec: number;
}

export interface KdenliveProjectOptions {
  width: number;
  height: number;
  fps: number;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toEvenInt(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

function resolveVideoDimensions(
  resolution: string,
  aspectRatio: string,
): { width: number; height: number } {
  const baseMap: Record<string, number> = {
    "480P": 480,
    "720P": 720,
    "1080P": 1080,
  };
  const base = baseMap[resolution.toUpperCase()] ?? 720;

  const ratioMatch = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(
    aspectRatio.trim(),
  );
  const wRatio = ratioMatch ? Number(ratioMatch[1]) : 16;
  const hRatio = ratioMatch ? Number(ratioMatch[2]) : 9;

  if (!Number.isFinite(wRatio) || !Number.isFinite(hRatio) || wRatio <= 0 || hRatio <= 0) {
    return { width: 1280, height: 720 };
  }

  if (wRatio >= hRatio) {
    return {
      width: toEvenInt((base * wRatio) / hRatio),
      height: toEvenInt(base),
    };
  }

  return {
    width: toEvenInt(base),
    height: toEvenInt((base * hRatio) / wRatio),
  };
}

function clearDirectory(dir: string): void {
  mkdirSync(dir, { recursive: true });
  for (const entry of readdirSync(dir)) {
    rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
}

function formatStoryMarkdown(
  project: Project,
  orderedScenes: Scene[],
  elements: ReferenceElement[],
): string {
  const lines: string[] = [`# ${project.title}`, ""];

  if (project.roughIdea.trim()) {
    lines.push("## Rough Idea", "", project.roughIdea.trim(), "");
  }

  if (project.refinedStory.trim()) {
    lines.push("## Refined Story", "", project.refinedStory.trim(), "");
  }

  if (project.styleBible.trim()) {
    lines.push("## Style Bible", "", project.styleBible.trim(), "");
  }

  if (elements.length > 0) {
    lines.push("## Reference Elements", "");
    for (const element of elements) {
      const desc = element.description.trim()
        ? ` — ${element.description.trim()}`
        : "";
      lines.push(`- **${element.name}** (${element.kind})${desc}`);
    }
    lines.push("");
  }

  lines.push("## Scenes", "");
  orderedScenes.forEach((scene, index) => {
    const nn = String(index + 1).padStart(2, "0");
    lines.push(`### ${nn}. ${scene.title}`, "");
    lines.push(`- **Duration:** ${scene.duration}s`);
    lines.push(`- **Audio Mode:** ${scene.audioMode}`);
    lines.push(`- **Video Mode:** ${scene.videoMode}`);
    if (scene.cameraDirection.trim()) {
      lines.push(`- **Camera:** ${scene.cameraDirection.trim()}`);
    }
    if (scene.visualPrompt.trim()) {
      lines.push("", scene.visualPrompt.trim());
    }
    if (scene.audioScript.trim()) {
      lines.push("", `> Audio Script: ${scene.audioScript.trim()}`);
    }
    lines.push("");
  });

  return lines.join("\n");
}

function resolveExistingAssetPath(
  assetId: string | null,
  assetById: Map<string, Asset>,
): string | null {
  if (!assetId) return null;
  const asset = assetById.get(assetId);
  if (!asset) return null;

  const absPath = resolveInsideProjects(asset.filePath);
  if (!existsSync(absPath)) return null;
  return absPath;
}

/**
 * Write a minimal MLT XML `project.kdenlive` file inside `dir` with the given
 * clips laid out sequentially on the timeline, and return its file path.
 */
export function writeKdenliveProject(
  dir: string,
  clips: KdenliveClipInput[],
  opts: KdenliveProjectOptions,
): string {
  mkdirSync(dir, { recursive: true });
  const fps = Math.max(1, Math.round(opts.fps));
  const width = toEvenInt(opts.width);
  const height = toEvenInt(opts.height);

  const normalizedClips = clips.map((clip, index) => {
    const frames = Math.max(1, Math.round(clip.durationSec * fps));
    return {
      id: `producer${index}`,
      file: clip.file,
      frames,
      out: frames - 1,
    };
  });

  const totalFrames = normalizedClips.reduce(
    (sum, clip) => sum + clip.frames,
    0,
  );
  const totalOut = Math.max(0, totalFrames - 1);

  const producerXml = normalizedClips
    .map(
      (clip) => `  <producer id="${clip.id}" in="0" out="${clip.out}">
    <property name="length">${clip.frames}</property>
    <property name="eof">pause</property>
    <property name="resource">${escapeXml(clip.file)}</property>
    <property name="mlt_service">avformat-novalidate</property>
    <property name="seekable">1</property>
  </producer>`,
    )
    .join("\n");

  const binEntriesXml = normalizedClips
    .map(
      (clip) =>
        `    <entry producer="${clip.id}" in="0" out="${clip.out}"/>`,
    )
    .join("\n");

  const trackEntriesXml = normalizedClips
    .map(
      (clip) =>
        `    <entry producer="${clip.id}" in="0" out="${clip.out}"/>`,
    )
    .join("\n");

  const xml = [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<mlt LC_NUMERIC="C" producer="main_bin" version="7.0.0" root=".">`,
    `  <profile description="AI Video Studio ${width}x${height} ${fps}fps" width="${width}" height="${height}" progressive="1" sample_aspect_num="1" sample_aspect_den="1" display_aspect_num="${width}" display_aspect_den="${height}" frame_rate_num="${fps}" frame_rate_den="1" colorspace="709"/>`,
    `  <producer id="black_track" in="0" out="${totalOut}">`,
    `    <property name="length">${Math.max(1, totalFrames)}</property>`,
    `    <property name="eof">pause</property>`,
    `    <property name="resource">black</property>`,
    `    <property name="mlt_service">color</property>`,
    `  </producer>`,
    producerXml,
    `  <playlist id="main_bin">`,
    `    <property name="kdenlive:docproperties.decimalPoint">.</property>`,
    `    <property name="kdenlive:docproperties.version">1.1</property>`,
    `    <property name="xml_retain">1</property>`,
    binEntriesXml,
    `  </playlist>`,
    `  <playlist id="playlist0">`,
    trackEntriesXml,
    `  </playlist>`,
    `  <tractor id="tractor0" in="0" out="${totalOut}">`,
    `    <track producer="black_track"/>`,
    `    <track producer="playlist0"/>`,
    `  </tractor>`,
    `</mlt>`,
    "",
  ]
    .filter((block) => block !== "")
    .join("\n");

  const projectFilePath = path.join(dir, "project.kdenlive");
  writeFileSync(projectFilePath, xml, "utf8");
  return projectFilePath;
}

/**
 * Rebuild `PROJECTS_DIR/<slug>/export_kdenlive/` from the project's current
 * scene order and active takes, removing any stale files, writing `story.md`,
 * and generating a starter `project.kdenlive` timeline when clips exist.
 */
export async function rebuildKdenliveExport(
  projectId: string,
): Promise<KdenliveExportResult> {
  const db = getDb();
  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();

  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const dirs = ensureProjectDirs(project.slug);
  clearDirectory(dirs.exportDir);

  const orderedScenes = db
    .select()
    .from(scenes)
    .where(eq(scenes.projectId, projectId))
    .orderBy(asc(scenes.orderIndex), asc(scenes.createdAt), asc(scenes.id))
    .all();

  const projectAssets = db
    .select()
    .from(assets)
    .where(eq(assets.projectId, projectId))
    .all();
  const assetById = new Map(projectAssets.map((asset) => [asset.id, asset]));

  const elements = db
    .select()
    .from(referenceElements)
    .where(eq(referenceElements.projectId, projectId))
    .orderBy(asc(referenceElements.createdAt), asc(referenceElements.id))
    .all();

  const files: string[] = [];
  const missingScenes: string[] = [];
  const exportedClips: KdenliveClipInput[] = [];

  for (let i = 0; i < orderedScenes.length; i += 1) {
    const scene = orderedScenes[i];
    const nn = String(i + 1).padStart(2, "0");
    const sceneSlug = slugify(scene.slug || scene.title || scene.id);

    const videoSrc = resolveExistingAssetPath(
      scene.activeVideoAssetId,
      assetById,
    );
    if (videoSrc) {
      const videoName = `${nn}_${sceneSlug}.mp4`;
      copyFileSync(videoSrc, path.join(dirs.exportDir, videoName));
      files.push(videoName);
      exportedClips.push({
        file: videoName,
        durationSec: scene.duration,
      });
    } else {
      missingScenes.push(scene.title || scene.slug || scene.id);
    }

    const audioSrc = resolveExistingAssetPath(
      scene.activeAudioAssetId,
      assetById,
    );
    if (audioSrc) {
      const audioName = `${nn}_${sceneSlug}_voiceover.mp3`;
      copyFileSync(audioSrc, path.join(dirs.exportDir, audioName));
      files.push(audioName);
    }
  }

  writeStoryMarkdown(
    project.slug,
    formatStoryMarkdown(project, orderedScenes, elements),
  );

  if (exportedClips.length > 0) {
    const dims = resolveVideoDimensions(project.resolution, project.aspectRatio);
    writeKdenliveProject(dirs.exportDir, exportedClips, {
      width: dims.width,
      height: dims.height,
      fps: 25,
    });
    files.push("project.kdenlive");
  }

  return {
    dir: dirs.exportDir,
    files,
    missingScenes,
  };
}

/**
 * Stream a ZIP archive of `PROJECTS_DIR/<slug>/export_kdenlive/` built with
 * `archiver` as a Web `ReadableStream`.
 */
export function streamExportZip(
  projectId: string,
): ReadableStream<Uint8Array> {
  const db = getDb();
  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();

  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const { exportDir } = ensureProjectDirs(project.slug);
  const archive = new ZipArchive({ zlib: { level: 9 } });
  let closed = false;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      archive.on("data", (chunk: Buffer) => {
        if (!closed) {
          controller.enqueue(new Uint8Array(chunk));
        }
      });

      archive.on("end", () => {
        if (!closed) {
          closed = true;
          controller.close();
        }
      });

      archive.on("warning", (err) => {
        if (err.code !== "ENOENT" && !closed) {
          closed = true;
          controller.error(err);
        }
      });

      archive.on("error", (err) => {
        if (!closed) {
          closed = true;
          controller.error(err);
        }
      });

      archive.directory(exportDir, false);
      void archive.finalize();
    },
    cancel() {
      closed = true;
      archive.abort();
      archive.destroy();
    },
  });
}
