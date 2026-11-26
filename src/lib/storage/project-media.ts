import {
  copyFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { asc, eq } from "drizzle-orm";
import {
  assets,
  getDb,
  projects,
  referenceElements,
  scenes,
  type Asset,
  type AssetRole,
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

/** Manifest of flat media files written into `PROJECTS_DIR/<slug>/`. */
export const MEDIA_MANIFEST_FILE = ".project-media.json";

export interface ProjectMediaState {
  dir: string;
  files: string[];
}

interface MediaManifest {
  version: 1;
  files: string[];
}

const ROLE_LABELS: Record<AssetRole, string> = {
  video_clip: "clip",
  keyframe_first: "keyframe-first",
  keyframe_last: "keyframe-last",
  voiceover: "voiceover",
  element_sheet: "sheet",
  quick_clip: "quick-clip",
};

const MEDIA_EXTENSIONS = new Set([
  ".mp4",
  ".webm",
  ".mov",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".mp3",
  ".wav",
  ".ogg",
]);

const SOURCE_FILE_LABELS: Record<string, string> = {
  clip: "clip",
  keyframe_first: "keyframe-first",
  keyframe_last: "keyframe-last",
  voiceover: "voiceover",
};

function extensionOf(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return /^\.[a-z0-9]{2,5}$/.test(ext) ? ext : "";
}

function listMediaFiles(dir: string): string[] {
  const out: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listMediaFiles(abs));
    } else if (
      entry.isFile() &&
      MEDIA_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
    ) {
      out.push(abs);
    }
  }
  return out;
}

function splitVersionedStem(stem: string): {
  base: string;
  version: number | null;
} {
  const match = /^(.*)_v(\d+)$/.exec(stem);
  if (!match) return { base: stem, version: null };
  return { base: match[1], version: Number(match[2]) };
}

/**
 * Flat name for a media file found in the source folders but absent from the
 * `assets` table, e.g. a leftover alternate take or an older element image.
 */
function orphanFlatName(relPath: string): string | null {
  const parts = relPath.split("/");
  if (parts.length < 2) return null;

  const ext = extensionOf(relPath);
  if (!ext) return null;

  const file = parts[parts.length - 1];
  const stem = file.slice(0, file.length - ext.length);

  if (parts[0] === "scenes" && parts.length >= 3) {
    const sceneSlug = parts[1].replace(/^\d+_/, "");
    const { base, version } = splitVersionedStem(stem);
    const label = SOURCE_FILE_LABELS[base] ?? slugify(base);
    const suffix = version === null ? "" : `_v${version}`;
    return `${slugify(sceneSlug)}_${label}${suffix}${ext}`;
  }

  if (parts[0] === "elements" && parts.length === 2) {
    const elementMatch = /^(character|prop|location)_(.+?)_v(\d+)$/.exec(stem);
    if (elementMatch) {
      const [, kind, name, version] = elementMatch;
      return `element_${kind}_${slugify(name)}_v${version}${ext}`;
    }
    return `element_${slugify(stem)}${ext}`;
  }

  if (parts[0] === "quick_clips" && parts.length === 2) {
    const { base, version } = splitVersionedStem(stem);
    const label =
      base === "clip"
        ? "quick-clip"
        : (SOURCE_FILE_LABELS[base] ?? slugify(base));
    const suffix = version === null ? "" : `_v${version}`;
    return `${label}${suffix}${ext}`;
  }

  return null;
}

/**
 * Stable flat filename for an asset, e.g. `01-lights-camera_clip_v2.mp4`,
 * `element_character_kira_v1.png`, or `quick-clip_v1.mp4`. Scene slugs do not
 * change on reorder, so regenerating media never renames existing files.
 */
export function flatAssetFileName(
  asset: Asset,
  scene: Scene | undefined,
  element: ReferenceElement | undefined,
): string {
  const ext = extensionOf(asset.filePath);
  const version = `_v${asset.version}`;

  if (asset.elementId) {
    const kind = element?.kind ?? "element";
    const name = slugify(element?.name ?? asset.elementId);
    return `element_${kind}_${name}${version}${ext}`;
  }

  const label = ROLE_LABELS[asset.role] ?? asset.role;
  if (asset.sceneId) {
    const sceneSlug = slugify(scene?.slug || scene?.title || asset.sceneId);
    return `${sceneSlug}_${label}${version}${ext}`;
  }

  return `${label}${version}${ext}`;
}

function uniqueName(base: string, used: Set<string>, assetId: string): string {
  if (!used.has(base)) return base;
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  const candidate = `${stem}-${assetId.slice(0, 6)}${ext}`;
  let name = candidate;
  let suffix = 2;
  while (used.has(name)) {
    name = `${stem}-${assetId.slice(0, 6)}-${suffix}${ext}`;
    suffix += 1;
  }
  return name;
}

function readManifest(root: string): string[] {
  try {
    const parsed = JSON.parse(
      readFileSync(path.join(root, MEDIA_MANIFEST_FILE), "utf8"),
    ) as Partial<MediaManifest>;
    if (!Array.isArray(parsed.files)) return [];
    return parsed.files.filter(
      (file): file is string =>
        typeof file === "string" &&
        file.length > 0 &&
        !file.includes("/") &&
        !file.includes("\\") &&
        file !== "." &&
        file !== "..",
    );
  } catch {
    return [];
  }
}

function writeManifest(root: string, files: string[]): void {
  const manifest: MediaManifest = { version: 1, files };
  writeFileSync(
    path.join(root, MEDIA_MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

function copyIfChanged(src: string, dest: string): void {
  try {
    const srcStat = statSync(src);
    if (existsSync(dest)) {
      const destStat = statSync(dest);
      if (
        destStat.size === srcStat.size &&
        destStat.mtimeMs >= srcStat.mtimeMs
      ) {
        return;
      }
    }
  } catch {
    // Fall through to the copy so a missing stat cannot skip a real file.
  }
  copyFileSync(src, dest);
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

/**
 * Mirror every stored asset of a project into `PROJECTS_DIR/<slug>/` as one
 * flat file per version, refresh `story.md`, and prune files from the previous
 * manifest whose asset row is gone. Files the app did not write are untouched.
 */
export async function syncProjectMedia(
  projectId: string,
): Promise<ProjectMediaState> {
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

  const orderedScenes = db
    .select()
    .from(scenes)
    .where(eq(scenes.projectId, projectId))
    .orderBy(asc(scenes.orderIndex), asc(scenes.createdAt), asc(scenes.id))
    .all();

  const elements = db
    .select()
    .from(referenceElements)
    .where(eq(referenceElements.projectId, projectId))
    .orderBy(asc(referenceElements.createdAt), asc(referenceElements.id))
    .all();

  const projectAssets = db
    .select()
    .from(assets)
    .where(eq(assets.projectId, projectId))
    .orderBy(asc(assets.createdAt), asc(assets.id))
    .all();

  const sceneById = new Map(orderedScenes.map((scene) => [scene.id, scene]));
  const elementById = new Map(elements.map((element) => [element.id, element]));
  const previous = readManifest(dirs.root);
  const used = new Set<string>();
  const files: string[] = [];

  for (const asset of projectAssets) {
    const src = resolveInsideProjects(asset.filePath);
    if (!existsSync(src)) continue;

    const base = flatAssetFileName(
      asset,
      asset.sceneId ? sceneById.get(asset.sceneId) : undefined,
      asset.elementId ? elementById.get(asset.elementId) : undefined,
    );
    const name = uniqueName(base, used, asset.id);
    used.add(name);

    copyIfChanged(src, path.join(dirs.root, name));
    files.push(name);
  }

  const referenced = new Set(projectAssets.map((asset) => asset.filePath));
  const orphanCandidates = [
    ...listMediaFiles(path.join(dirs.root, "scenes")),
    ...listMediaFiles(path.join(dirs.root, "elements")),
    ...listMediaFiles(path.join(dirs.root, "quick_clips")),
  ].sort();

  for (const abs of orphanCandidates) {
    const rel = path.relative(dirs.root, abs).split(path.sep).join("/");
    if (referenced.has(`${project.slug}/${rel}`)) continue;

    const name = orphanFlatName(rel);
    if (!name || used.has(name)) continue;

    used.add(name);
    copyIfChanged(abs, path.join(dirs.root, name));
    files.push(name);
  }

  files.sort();

  for (const stale of previous) {
    if (used.has(stale)) continue;
    const stalePath = path.join(dirs.root, stale);
    if (path.dirname(stalePath) === dirs.root) {
      rmSync(stalePath, { force: true });
    }
  }

  writeManifest(dirs.root, files);
  writeStoryMarkdown(
    project.slug,
    formatStoryMarkdown(project, orderedScenes, elements),
  );

  return { dir: dirs.root, files };
}

/** Read the last synced flat-media manifest without touching the filesystem. */
export function readProjectMedia(projectId: string): ProjectMediaState {
  const project = getDb()
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();

  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const dir = resolveInsideProjects(project.slug);
  return { dir, files: readManifest(dir) };
}