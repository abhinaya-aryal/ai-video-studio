import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getConfig } from "@/lib/config";

/** Thrown when a requested path escapes `projectsDir` or violates slug safety rules. */
export class UnsafePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafePathError";
  }
}

/** Convert arbitrary user text into a safe, lowercase, URL- and filesystem-friendly slug. */
export function slugify(input: string): string {
  const normalized = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized.length > 0 ? normalized : "untitled";
}

/**
 * Resolve a relative path inside the configured `PROJECTS_DIR`.
 * Throws `UnsafePathError` if the path is empty, absolute, contains null bytes,
 * or escapes `PROJECTS_DIR`.
 */
export function resolveInsideProjects(relPath: string): string {
  if (
    !relPath ||
    relPath.trim().length === 0 ||
    relPath.includes("\0") ||
    path.isAbsolute(relPath) ||
    path.posix.isAbsolute(relPath) ||
    path.win32.isAbsolute(relPath) ||
    relPath.startsWith("\\")
  ) {
    throw new UnsafePathError(`Invalid project-relative path: "${relPath}"`);
  }

  const projectsRoot = path.resolve(getConfig().projectsDir);
  const resolved = path.resolve(projectsRoot, relPath);
  const relative = path.relative(projectsRoot, resolved);

  if (
    relative === "" ||
    relative === "." ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new UnsafePathError(`Path escapes projects directory: "${relPath}"`);
  }

  return resolved;
}

function resolveProjectRoot(slug: string): string {
  if (
    !slug ||
    slug === "." ||
    slug === ".." ||
    slug.includes("/") ||
    slug.includes("\\") ||
    slug.includes("\0")
  ) {
    throw new UnsafePathError(`Invalid project slug: "${slug}"`);
  }

  const root = resolveInsideProjects(slug);
  const projectsRoot = path.resolve(getConfig().projectsDir);
  if (path.dirname(root) !== projectsRoot) {
    throw new UnsafePathError(`Project slug must be a single directory: "${slug}"`);
  }
  return root;
}

export interface ProjectDirs {
  root: string;
  elements: string;
  scenes: string;
}

/** Create and return the directory layout for a project under `PROJECTS_DIR/<slug>`. */
export function ensureProjectDirs(slug: string): ProjectDirs {
  const root = resolveProjectRoot(slug);
  const elements = path.join(root, "elements");
  const scenes = path.join(root, "scenes");

  mkdirSync(elements, { recursive: true });
  mkdirSync(scenes, { recursive: true });

  return { root, elements, scenes };
}

/** Write `story.md` inside `PROJECTS_DIR/<slug>/story.md` and return its absolute path. */
export function writeStoryMarkdown(slug: string, md: string): string {
  const { root } = ensureProjectDirs(slug);
  const storyPath = path.join(root, "story.md");
  writeFileSync(storyPath, md, "utf8");
  return storyPath;
}
