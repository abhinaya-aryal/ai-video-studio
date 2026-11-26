import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDbForTests, getDb } from "@/db";
import { assets, projects, referenceElements, scenes } from "@/db/schema";
import {
  MEDIA_MANIFEST_FILE,
  flatAssetFileName,
  readProjectMedia,
  syncProjectMedia,
} from "@/lib/storage/project-media";
import { ensureProjectDirs, resolveInsideProjects } from "@/lib/storage/paths";

describe("flat project media", () => {
  let tmpRoot: string;
  let prevDataDir: string | undefined;
  let prevProjectsDir: string | undefined;

  beforeEach(() => {
    prevDataDir = process.env.DATA_DIR;
    prevProjectsDir = process.env.PROJECTS_DIR;

    tmpRoot = mkdtempSync(path.join(os.tmpdir(), "aivs-media-"));
    process.env.DATA_DIR = path.join(tmpRoot, "data");
    process.env.PROJECTS_DIR = path.join(tmpRoot, "projects");
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

  function seedFile(relPath: string, contents: string): void {
    const absPath = resolveInsideProjects(relPath);
    mkdirSync(path.dirname(absPath), { recursive: true });
    writeFileSync(absPath, contents);
  }

  function projectRoot(slug: string): string {
    return path.join(path.resolve(process.env.PROJECTS_DIR!), slug);
  }

  function flatFiles(slug: string): string[] {
    return readdirSync(projectRoot(slug))
      .filter((entry) => {
        if (entry === MEDIA_MANIFEST_FILE || entry === "story.md") return false;
        return statSync(path.join(projectRoot(slug), entry)).isFile();
      })
      .sort();
  }

  it("names every asset role with a stable flat filename", () => {
    const scene = {
      id: "scene-1",
      slug: "01-lights-camera",
      title: "Lights Camera",
    } as never;
    const element = {
      id: "elem-1",
      kind: "character",
      name: "Kira Voss",
    } as never;

    const base = {
      projectId: "proj-1",
      sceneId: "scene-1" as string | null,
      filePath: "unused",
    };

    expect(
      flatAssetFileName(
        { ...base, id: "a1", role: "video_clip", version: 2, filePath: "x/clip_v2.mp4" } as never,
        scene,
        undefined,
      ),
    ).toBe("01-lights-camera_clip_v2.mp4");
    expect(
      flatAssetFileName(
        { ...base, id: "a2", role: "keyframe_first", version: 1, filePath: "x/kf.png" } as never,
        scene,
        undefined,
      ),
    ).toBe("01-lights-camera_keyframe-first_v1.png");
    expect(
      flatAssetFileName(
        { ...base, id: "a3", role: "keyframe_last", version: 1, filePath: "x/kf.png" } as never,
        scene,
        undefined,
      ),
    ).toBe("01-lights-camera_keyframe-last_v1.png");
    expect(
      flatAssetFileName(
        { ...base, id: "a4", role: "voiceover", version: 1, filePath: "x/vo.mp3" } as never,
        scene,
        undefined,
      ),
    ).toBe("01-lights-camera_voiceover_v1.mp3");
    expect(
      flatAssetFileName(
        { ...base, id: "a5", role: "element_sheet", version: 3, filePath: "x/e.png", elementId: "elem-1" } as never,
        undefined,
        element,
      ),
    ).toBe("element_character_kira-voss_v3.png");
    expect(
      flatAssetFileName(
        { ...base, id: "a6", sceneId: null, role: "quick_clip", version: 1, filePath: "x/quick.mp4" } as never,
        undefined,
        undefined,
      ),
    ).toBe("quick-clip_v1.mp4");
  });

  it("copies every active and alternate asset flat, keeps user files, and writes story.md", async () => {
    const db = getDb();
    ensureProjectDirs("cyber-short");

    db.insert(projects)
      .values({
        id: "proj-1",
        slug: "cyber-short",
        title: "Cyber Short",
        roughIdea: "A neon chase.",
        refinedStory: "Act 1: Rain. Act 2: Alley.",
        styleBible: "Moody cyberpunk anamorphic.",
      })
      .run();

    db.insert(referenceElements)
      .values({
        id: "elem-1",
        projectId: "proj-1",
        kind: "character",
        name: "Kira Voss",
        description: "Courier in a drenched trenchcoat",
      })
      .run();

    db.insert(scenes)
      .values([
        {
          id: "scene-a",
          projectId: "proj-1",
          orderIndex: 0,
          slug: "01-lights-camera",
          title: "Lights Camera",
          duration: 5,
        },
        {
          id: "scene-b",
          projectId: "proj-1",
          orderIndex: 1,
          slug: "02-neon-alley",
          title: "Neon Alley",
          duration: 7,
        },
      ])
      .run();

    const seedRows = [
      {
        id: "asset-a1",
        sceneId: "scene-a",
        role: "video_clip",
        version: 1,
        type: "video",
        rel: "cyber-short/scenes/01_lights-camera/clip_v1.mp4",
        body: "VIDEO-A-V1",
      },
      {
        id: "asset-a2",
        sceneId: "scene-a",
        role: "video_clip",
        version: 2,
        type: "video",
        rel: "cyber-short/scenes/01_lights-camera/clip_v2.mp4",
        body: "VIDEO-A-V2",
      },
      {
        id: "asset-a3",
        sceneId: "scene-a",
        role: "keyframe_first",
        version: 1,
        type: "image",
        rel: "cyber-short/scenes/01_lights-camera/keyframe_first_v1.png",
        body: "KEYFRAME-A",
      },
      {
        id: "asset-b1",
        sceneId: "scene-b",
        role: "voiceover",
        version: 1,
        type: "audio",
        rel: "cyber-short/scenes/02_neon-alley/voiceover_v1.mp3",
        body: "VOICE-B",
      },
      {
        id: "asset-e1",
        elementId: "elem-1",
        role: "element_sheet",
        version: 1,
        type: "image",
        rel: "cyber-short/elements/character_kira-voss_v1.png",
        body: "ELEMENT-KIRA",
      },
      {
        id: "asset-q1",
        role: "quick_clip",
        version: 1,
        type: "video",
        rel: "cyber-short/quick_clips/clip_v1.mp4",
        body: "QUICK-CLIP",
      },
    ] as const;

    for (const row of seedRows) {
      seedFile(row.rel, row.body);
      db.insert(assets)
        .values({
          id: row.id,
          projectId: "proj-1",
          sceneId: "sceneId" in row ? row.sceneId : null,
          elementId: "elementId" in row ? row.elementId : null,
          type: row.type,
          role: row.role,
          version: row.version,
          filePath: row.rel,
          prompt: "",
          paramsJson: "{}",
          createdAt: 1,
        })
        .run();
    }

    writeFileSync(path.join(projectRoot("cyber-short"), "my-notes.txt"), "MINE");

    const state = await syncProjectMedia("proj-1");

    expect(state.dir).toBe(projectRoot("cyber-short"));
    expect(flatFiles("cyber-short")).toEqual([
      "01-lights-camera_clip_v1.mp4",
      "01-lights-camera_clip_v2.mp4",
      "01-lights-camera_keyframe-first_v1.png",
      "02-neon-alley_voiceover_v1.mp3",
      "element_character_kira-voss_v1.png",
      "my-notes.txt",
      "quick-clip_v1.mp4",
    ]);

    expect(
      readFileSync(
        path.join(projectRoot("cyber-short"), "01-lights-camera_clip_v2.mp4"),
        "utf8",
      ),
    ).toBe("VIDEO-A-V2");
    expect(
      readFileSync(
        path.join(projectRoot("cyber-short"), "element_character_kira-voss_v1.png"),
        "utf8",
      ),
    ).toBe("ELEMENT-KIRA");
    expect(
      readFileSync(path.join(projectRoot("cyber-short"), "my-notes.txt"), "utf8"),
    ).toBe("MINE");

    const story = readFileSync(
      path.join(projectRoot("cyber-short"), "story.md"),
      "utf8",
    );
    expect(story).toContain("# Cyber Short");
    expect(story.indexOf("Lights Camera")).toBeLessThan(
      story.indexOf("Neon Alley"),
    );

    const manifest = JSON.parse(
      readFileSync(
        path.join(projectRoot("cyber-short"), MEDIA_MANIFEST_FILE),
        "utf8",
      ),
    ) as { files: string[] };
    expect(manifest.files).toEqual(state.files);
    expect(state.files).toEqual(
      flatFiles("cyber-short").filter((file) => file !== "my-notes.txt"),
    );
  });

  it("removes flat files whose asset rows are gone but leaves unrelated files alone", async () => {
    const db = getDb();
    ensureProjectDirs("prune-short");

    db.insert(projects)
      .values({ id: "proj-2", slug: "prune-short", title: "Prune Short" })
      .run();

    db.insert(referenceElements)
      .values({
        id: "elem-2",
        projectId: "proj-2",
        kind: "character",
        name: "Kira",
        description: "",
      })
      .run();

    db.insert(scenes)
      .values({
        id: "scene-2",
        projectId: "proj-2",
        orderIndex: 0,
        slug: "01-open",
        title: "Open",
        duration: 4,
      })
      .run();

    seedFile("prune-short/scenes/01_open/clip_v1.mp4", "CLIP");
    seedFile("prune-short/elements/character_kira_v1.png", "OLD-ELEMENT");
    db.insert(assets)
      .values([
        {
          id: "clip-2",
          projectId: "proj-2",
          sceneId: "scene-2",
          type: "video",
          role: "video_clip",
          version: 1,
          filePath: "prune-short/scenes/01_open/clip_v1.mp4",
          prompt: "",
          paramsJson: "{}",
          createdAt: 1,
        },
        {
          id: "elem-asset-2",
          projectId: "proj-2",
          elementId: "elem-2",
          type: "image",
          role: "element_sheet",
          version: 1,
          filePath: "prune-short/elements/character_kira_v1.png",
          prompt: "",
          paramsJson: "{}",
          createdAt: 1,
        },
      ])
      .run();

    writeFileSync(path.join(projectRoot("prune-short"), "keep-me.txt"), "MINE");

    const first = await syncProjectMedia("proj-2");
    expect(first.files).toContain("element_character_kira_v1.png");

    db.delete(assets).where(eq(assets.id, "elem-asset-2")).run();
    rmSync(resolveInsideProjects("prune-short/elements/character_kira_v1.png"));

    const second = await syncProjectMedia("proj-2");
    expect(second.files).not.toContain("element_character_kira_v1.png");
    expect(flatFiles("prune-short")).toEqual([
      "01-open_clip_v1.mp4",
      "keep-me.txt",
    ]);
    expect(
      readFileSync(path.join(projectRoot("prune-short"), "keep-me.txt"), "utf8"),
    ).toBe("MINE");
  });

  it("mirrors leftover media files under scenes/ and elements/ that have no asset row", async () => {
    const db = getDb();
    ensureProjectDirs("orphan-short");
    db.insert(projects)
      .values({ id: "proj-4", slug: "orphan-short", title: "Orphan Short" })
      .run();

    db.insert(scenes)
      .values({
        id: "scene-4",
        projectId: "proj-4",
        orderIndex: 0,
        slug: "01-open",
        title: "Open",
        duration: 4,
      })
      .run();

    seedFile("orphan-short/scenes/00_01-open/clip_v2.mp4", "ORPHAN-CLIP");
    seedFile(
      "orphan-short/scenes/00_01-open/keyframe_first_v2.png",
      "ORPHAN-KEYFRAME",
    );
    seedFile("orphan-short/elements/character_kira_v2.png", "ORPHAN-ELEMENT");
    seedFile("orphan-short/elements/reference-upload.jpeg", "UPLOAD");

    const state = await syncProjectMedia("proj-4");
    expect(state.files).toEqual([
      "01-open_clip_v2.mp4",
      "01-open_keyframe-first_v2.png",
      "element_character_kira_v2.png",
      "element_reference-upload.jpeg",
    ]);
    expect(
      readFileSync(path.join(projectRoot("orphan-short"), "01-open_clip_v2.mp4"), "utf8"),
    ).toBe("ORPHAN-CLIP");

    rmSync(
      path.join(
        projectRoot("orphan-short"),
        "scenes",
        "00_01-open",
        "clip_v2.mp4",
      ),
    );
    const second = await syncProjectMedia("proj-4");
    expect(second.files).not.toContain("01-open_clip_v2.mp4");
    expect(existsSync(path.join(projectRoot("orphan-short"), "01-open_clip_v2.mp4"))).toBe(
      false,
    );
  });

  it("readProjectMedia returns the manifest files without syncing", async () => {
    const db = getDb();
    ensureProjectDirs("read-short");
    db.insert(projects)
      .values({ id: "proj-3", slug: "read-short", title: "Read Short" })
      .run();

    expect(readProjectMedia("proj-3")).toEqual({
      dir: projectRoot("read-short"),
      files: [],
    });
  });
});