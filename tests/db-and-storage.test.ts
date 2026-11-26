import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDbForTests, getDb, getOrCreateQuickClipProject } from "@/db";
import {
  assets,
  customModels,
  jobs,
  projects,
  referenceElements,
  scenes,
  stylePresets,
} from "@/db/schema";
import {
  UnsafePathError,
  ensureProjectDirs,
  resolveInsideProjects,
  slugify,
  writeStoryMarkdown,
} from "@/lib/storage/paths";

describe("SQLite database, migrations, and safe project storage", () => {
  let tmpRoot: string;
  let dataDir: string;
  let projectsDir: string;
  let prevDataDir: string | undefined;
  let prevProjectsDir: string | undefined;

  beforeEach(() => {
    prevDataDir = process.env.DATA_DIR;
    prevProjectsDir = process.env.PROJECTS_DIR;

    tmpRoot = mkdtempSync(path.join(os.tmpdir(), "aivs-task2-"));
    dataDir = path.join(tmpRoot, "data");
    projectsDir = path.join(tmpRoot, "projects");

    process.env.DATA_DIR = dataDir;
    process.env.PROJECTS_DIR = projectsDir;
  });

  afterEach(() => {
    closeDbForTests();

    if (prevDataDir === undefined) {
      delete process.env.DATA_DIR;
    } else {
      process.env.DATA_DIR = prevDataDir;
    }

    if (prevProjectsDir === undefined) {
      delete process.env.PROJECTS_DIR;
    } else {
      process.env.PROJECTS_DIR = prevProjectsDir;
    }

    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("migrates SQLite on first open, seeds built-in style presets, and inserts/reads project, prop element, and scene", () => {
    const db = getDb();
    expect(getDb()).toBe(db);
    expect(existsSync(path.join(dataDir, "studio.db"))).toBe(true);

    const presets = db.select().from(stylePresets).all();
    expect(presets.map((p) => p.name).sort()).toEqual([
      "Anime",
      "Cinematic",
      "Documentary",
      "Epic Hindu Mythology 3D",
      "Product",
    ]);
    expect(presets.every((p) => p.isBuiltin === 1)).toBe(true);

    db.insert(projects)
      .values({
        id: "proj-1",
        slug: "neon-rain",
        title: "Neon Rain",
        roughIdea: "A courier runs through a neon alley.",
      })
      .run();

    db.insert(referenceElements)
      .values({
        id: "elem-1",
        projectId: "proj-1",
        kind: "prop",
        name: "Katana",
        description: "Glowing carbon-fiber katana",
      })
      .run();

    db.insert(scenes)
      .values({
        id: "scene-1",
        projectId: "proj-1",
        orderIndex: 1,
        slug: "opening-rain",
        title: "Opening: Rain",
        visualPrompt: "Wide shot in pouring neon rain",
        linkedElementIdsJson: JSON.stringify(["elem-1"]),
      })
      .run();

    const [loadedProject] = db
      .select()
      .from(projects)
      .where(eq(projects.id, "proj-1"))
      .all();
    expect(loadedProject?.slug).toBe("neon-rain");

    const [loadedElement] = db
      .select()
      .from(referenceElements)
      .where(eq(referenceElements.id, "elem-1"))
      .all();
    expect(loadedElement?.kind).toBe("prop");
    expect(loadedElement?.name).toBe("Katana");

    const [loadedScene] = db
      .select()
      .from(scenes)
      .where(eq(scenes.id, "scene-1"))
      .all();
    expect(loadedScene?.title).toBe("Opening: Rain");
    expect(loadedScene?.orderIndex).toBe(1);

    db.insert(assets)
      .values({
        id: "asset-1",
        projectId: "proj-1",
        sceneId: "scene-1",
        type: "video",
        role: "video_clip",
        version: 1,
        filePath: "neon-rain/scenes/01_opening-rain/clip_v1.mp4",
      })
      .run();

    db.insert(jobs)
      .values({
        id: "job-1",
        projectId: "proj-1",
        sceneId: "scene-1",
        modality: "video",
        modelId: "wan3.0-video",
        role: "video_clip",
        requestJson: JSON.stringify({ prompt: "Wide shot" }),
        resultAssetId: "asset-1",
        status: "READY",
      })
      .run();

    db.insert(customModels)
      .values({
        id: "cm-1",
        modelId: "wan-custom-1",
        displayName: "Wan Custom",
        modality: "video",
        family: "wan3",
      })
      .run();

    expect(db.select().from(assets).all()).toHaveLength(1);
    expect(db.select().from(jobs).all()[0]?.status).toBe("READY");
    expect(db.select().from(customModels).all()[0]?.modelId).toBe(
      "wan-custom-1",
    );
  });

  it("returns the same hidden _quick-clips project id across repeated calls", () => {
    const first = getOrCreateQuickClipProject();
    const second = getOrCreateQuickClipProject();

    expect(first.id).toBe(second.id);
    expect(first.slug).toBe("_quick-clips");
    expect(first.isHidden).toBe(1);
  });

  it("keeps valid relative paths inside projectsDir and rejects escapes with UnsafePathError", () => {
    const safePath = resolveInsideProjects("a/scenes/01_x/clip_v1.mp4");
    const resolvedProjects = path.resolve(projectsDir);
    expect(safePath).toBe(
      path.join(resolvedProjects, "a", "scenes", "01_x", "clip_v1.mp4"),
    );

    expect(() => resolveInsideProjects("../etc/passwd")).toThrow(
      UnsafePathError,
    );
    expect(() => resolveInsideProjects("/etc/passwd")).toThrow(UnsafePathError);
    expect(() => resolveInsideProjects("a/../../outside.txt")).toThrow(
      UnsafePathError,
    );
    expect(() => resolveInsideProjects("..\0/etc/passwd")).toThrow(
      UnsafePathError,
    );
    expect(() =>
      resolveInsideProjects(`../${path.basename(projectsDir)}-other/secret.txt`),
    ).toThrow(UnsafePathError);
    expect(() => resolveInsideProjects(".")).toThrow(UnsafePathError);
  });

  it("slugifies titles safely and handles dot-traversal inputs without dots or slashes", () => {
    expect(slugify("Opening: Rain!! ")).toBe("opening-rain");

    const unsafeSlug = slugify("../..");
    expect(unsafeSlug.length).toBeGreaterThan(0);
    expect(unsafeSlug).not.toContain(".");
    expect(unsafeSlug).not.toContain("/");
    expect(unsafeSlug).not.toContain("\\");
  });

  it("creates project directories and writes story.md inside the project root", () => {
    const dirs = ensureProjectDirs("my-short");
    expect(dirs.root).toBe(path.join(path.resolve(projectsDir), "my-short"));
    expect(existsSync(dirs.root)).toBe(true);
    expect(existsSync(dirs.elements)).toBe(true);
    expect(existsSync(dirs.scenes)).toBe(true);
    expect(existsSync(dirs.exportDir)).toBe(true);

    const storyPath = writeStoryMarkdown("my-short", "# My Short\n\nRain.");
    expect(storyPath).toBe(path.join(dirs.root, "story.md"));
    expect(readFileSync(storyPath, "utf8")).toBe("# My Short\n\nRain.");

    expect(() => ensureProjectDirs("../escape")).toThrow(UnsafePathError);
  });
});
