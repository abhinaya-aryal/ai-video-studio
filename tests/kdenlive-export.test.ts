import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDbForTests, getDb } from "@/db";
import { assets, projects, referenceElements, scenes } from "@/db/schema";
import {
  rebuildKdenliveExport,
  streamExportZip,
  writeKdenliveProject,
} from "@/lib/export/kdenlive";
import { ensureProjectDirs, resolveInsideProjects } from "@/lib/storage/paths";

/**
 * Minimal strict XML well-formedness validator and tag extractor for testing
 * generated `.kdenlive` MLT XML without spawning external binaries.
 */
function parseAndValidateXml(xml: string): {
  rootTag: string;
  tags: Array<{ name: string; attrs: Record<string, string> }>;
} {
  const trimmed = xml.trim();
  if (!trimmed.startsWith("<?xml ")) {
    throw new Error("Missing XML declaration");
  }

  const withoutDecl = trimmed.replace(/^<\?xml[^?]*\?>\s*/, "");
  const stack: string[] = [];
  const tags: Array<{ name: string; attrs: Record<string, string> }> = [];
  let rootTag = "";

  const tagRegex = /<\/?([A-Za-z_][\w:.-]*)((?:\s+[^<>]*?)?)\s*(\/?)>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(withoutDecl)) !== null) {
    const textBetween = withoutDecl.slice(lastIndex, match.index);
    if (textBetween.includes("<") || textBetween.includes(">")) {
      throw new Error(`Unescaped angle bracket in text: ${textBetween}`);
    }
    lastIndex = tagRegex.lastIndex;

    const full = match[0];
    const name = match[1];
    const attrStr = match[2] ?? "";
    const selfClosing = match[3] === "/";
    const isClosing = full.startsWith("</");

    if (isClosing) {
      const open = stack.pop();
      if (open !== name) {
        throw new Error(`Mismatched closing tag </${name}>, expected </${open}>`);
      }
      continue;
    }

    const attrs: Record<string, string> = {};
    const attrRegex = /([A-Za-z_][\w:.-]*)\s*=\s*"([^"]*)"/g;
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrRegex.exec(attrStr)) !== null) {
      attrs[attrMatch[1]] = attrMatch[2];
    }

    if (!rootTag) {
      rootTag = name;
    }
    tags.push({ name, attrs });

    if (!selfClosing) {
      stack.push(name);
    }
  }

  if (stack.length !== 0) {
    throw new Error(`Unclosed XML tags: ${stack.join(", ")}`);
  }
  if (!rootTag) {
    throw new Error("Empty XML document");
  }

  return { rootTag, tags };
}

async function readStreamToBuffer(
  stream: ReadableStream<Uint8Array>,
): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

describe("Kdenlive export builder", () => {
  let tmpRoot: string;
  let prevDataDir: string | undefined;
  let prevProjectsDir: string | undefined;

  beforeEach(() => {
    prevDataDir = process.env.DATA_DIR;
    prevProjectsDir = process.env.PROJECTS_DIR;

    tmpRoot = mkdtempSync(path.join(os.tmpdir(), "aivs-task7-"));
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

  function seedAssetFile(relPath: string, contents: string | Buffer): string {
    const absPath = resolveInsideProjects(relPath);
    mkdirSync(path.dirname(absPath), { recursive: true });
    writeFileSync(absPath, contents);
    return absPath;
  }

  it("rebuilds export_kdenlive in current scene order and clears stale files on reorder", async () => {
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
        aspectRatio: "16:9",
        resolution: "720P",
      })
      .run();

    db.insert(referenceElements)
      .values({
        id: "elem-1",
        projectId: "proj-1",
        kind: "character",
        name: "Kai",
        description: "Courier in a drenched trenchcoat",
      })
      .run();

    db.insert(scenes)
      .values([
        {
          id: "scene-a",
          projectId: "proj-1",
          orderIndex: 1,
          slug: "a",
          title: "Scene A",
          visualPrompt: "Rain falls on the rooftop",
          duration: 5,
          activeVideoAssetId: "asset-a1",
        },
        {
          id: "scene-b",
          projectId: "proj-1",
          orderIndex: 2,
          slug: "b",
          title: "Scene B",
          visualPrompt: "Neon alley sprint",
          duration: 7,
          activeVideoAssetId: "asset-b1",
        },
      ])
      .run();

    seedAssetFile("cyber-short/scenes/01_a/clip_v1.mp4", "VIDEO-A-V1");
    seedAssetFile("cyber-short/scenes/02_b/clip_v1.mp4", "VIDEO-B-V1");

    db.insert(assets)
      .values([
        {
          id: "asset-a1",
          projectId: "proj-1",
          sceneId: "scene-a",
          type: "video",
          role: "video_clip",
          version: 1,
          filePath: "cyber-short/scenes/01_a/clip_v1.mp4",
        },
        {
          id: "asset-b1",
          projectId: "proj-1",
          sceneId: "scene-b",
          type: "video",
          role: "video_clip",
          version: 1,
          filePath: "cyber-short/scenes/02_b/clip_v1.mp4",
        },
      ])
      .run();

    // Seed a stale file in export_kdenlive/ before first export
    const exportDir = path.join(
      path.resolve(process.env.PROJECTS_DIR!),
      "cyber-short",
      "export_kdenlive",
    );
    writeFileSync(path.join(exportDir, "99_stale.mp4"), "STALE");

    const first = await rebuildKdenliveExport("proj-1");
    expect(first.dir).toBe(exportDir);
    expect(first.missingScenes).toEqual([]);

    const firstEntries = readdirSync(exportDir).sort();
    expect(firstEntries).toEqual(["01_a.mp4", "02_b.mp4", "project.kdenlive"]);
    expect(firstEntries).not.toContain("99_stale.mp4");
    expect(readFileSync(path.join(exportDir, "01_a.mp4"), "utf8")).toBe(
      "VIDEO-A-V1",
    );
    expect(readFileSync(path.join(exportDir, "02_b.mp4"), "utf8")).toBe(
      "VIDEO-B-V1",
    );

    // Reorder scenes to B, A
    db.update(scenes)
      .set({ orderIndex: 1 })
      .where(eq(scenes.id, "scene-b"))
      .run();
    db.update(scenes)
      .set({ orderIndex: 2 })
      .where(eq(scenes.id, "scene-a"))
      .run();

    const second = await rebuildKdenliveExport("proj-1");
    expect(second.missingScenes).toEqual([]);

    const secondEntries = readdirSync(exportDir).sort();
    expect(secondEntries).toEqual(["01_b.mp4", "02_a.mp4", "project.kdenlive"]);
    expect(secondEntries).not.toContain("01_a.mp4");
    expect(secondEntries).not.toContain("02_b.mp4");
    expect(readFileSync(path.join(exportDir, "01_b.mp4"), "utf8")).toBe(
      "VIDEO-B-V1",
    );
    expect(readFileSync(path.join(exportDir, "02_a.mp4"), "utf8")).toBe(
      "VIDEO-A-V1",
    );

    // story.md should be written in project root reflecting new order
    const storyPath = path.join(
      path.resolve(process.env.PROJECTS_DIR!),
      "cyber-short",
      "story.md",
    );
    expect(existsSync(storyPath)).toBe(true);
    const storyText = readFileSync(storyPath, "utf8");
    expect(storyText).toContain("Cyber Short");
    expect(storyText.indexOf("Scene B")).toBeLessThan(
      storyText.indexOf("Scene A"),
    );
  });

  it("uses the active video take and voiceover when switched from v1 to v2", async () => {
    const db = getDb();
    ensureProjectDirs("take-switch");

    db.insert(projects)
      .values({
        id: "proj-2",
        slug: "take-switch",
        title: "Take Switch",
      })
      .run();

    db.insert(scenes)
      .values({
        id: "scene-a",
        projectId: "proj-2",
        orderIndex: 1,
        slug: "a",
        title: "Scene A",
        duration: 5,
        activeVideoAssetId: "asset-v1",
        activeAudioAssetId: "audio-v1",
      })
      .run();

    const v1Bytes = Buffer.from([0x01, 0x02, 0x03, 0x04]);
    const v2Bytes = Buffer.from([0xaa, 0xbb, 0xcc, 0xdd, 0xee]);
    const audioBytes = Buffer.from("MP3-VOICEOVER-V1");

    seedAssetFile("take-switch/scenes/01_a/clip_v1.mp4", v1Bytes);
    seedAssetFile("take-switch/scenes/01_a/clip_v2.mp4", v2Bytes);
    seedAssetFile("take-switch/scenes/01_a/voiceover_v1.mp3", audioBytes);

    db.insert(assets)
      .values([
        {
          id: "asset-v1",
          projectId: "proj-2",
          sceneId: "scene-a",
          type: "video",
          role: "video_clip",
          version: 1,
          filePath: "take-switch/scenes/01_a/clip_v1.mp4",
        },
        {
          id: "asset-v2",
          projectId: "proj-2",
          sceneId: "scene-a",
          type: "video",
          role: "video_clip",
          version: 2,
          filePath: "take-switch/scenes/01_a/clip_v2.mp4",
        },
        {
          id: "audio-v1",
          projectId: "proj-2",
          sceneId: "scene-a",
          type: "audio",
          role: "voiceover",
          version: 1,
          filePath: "take-switch/scenes/01_a/voiceover_v1.mp3",
        },
      ])
      .run();

    const first = await rebuildKdenliveExport("proj-2");
    expect(readFileSync(path.join(first.dir, "01_a.mp4"))).toEqual(v1Bytes);
    expect(readFileSync(path.join(first.dir, "01_a_voiceover.mp3"))).toEqual(
      audioBytes,
    );

    // Switch active take from v1 to v2
    db.update(scenes)
      .set({ activeVideoAssetId: "asset-v2" })
      .where(eq(scenes.id, "scene-a"))
      .run();

    const second = await rebuildKdenliveExport("proj-2");
    expect(readFileSync(path.join(second.dir, "01_a.mp4"))).toEqual(v2Bytes);
  });

  it("records scenes without an active clip in missingScenes without breaking numbering", async () => {
    const db = getDb();
    ensureProjectDirs("missing-test");

    db.insert(projects)
      .values({
        id: "proj-3",
        slug: "missing-test",
        title: "Missing Test",
      })
      .run();

    db.insert(scenes)
      .values([
        {
          id: "s1",
          projectId: "proj-3",
          orderIndex: 1,
          slug: "intro",
          title: "Intro",
          duration: 4,
          activeVideoAssetId: "a1",
        },
        {
          id: "s2",
          projectId: "proj-3",
          orderIndex: 2,
          slug: "middle",
          title: "Middle",
          duration: 5,
          activeVideoAssetId: null,
        },
        {
          id: "s3",
          projectId: "proj-3",
          orderIndex: 3,
          slug: "finale",
          title: "Finale",
          duration: 6,
          activeVideoAssetId: "a3",
        },
      ])
      .run();

    seedAssetFile("missing-test/scenes/01_intro/clip_v1.mp4", "CLIP-1");
    seedAssetFile("missing-test/scenes/03_finale/clip_v1.mp4", "CLIP-3");

    db.insert(assets)
      .values([
        {
          id: "a1",
          projectId: "proj-3",
          sceneId: "s1",
          type: "video",
          role: "video_clip",
          version: 1,
          filePath: "missing-test/scenes/01_intro/clip_v1.mp4",
        },
        {
          id: "a3",
          projectId: "proj-3",
          sceneId: "s3",
          type: "video",
          role: "video_clip",
          version: 1,
          filePath: "missing-test/scenes/03_finale/clip_v1.mp4",
        },
      ])
      .run();

    const result = await rebuildKdenliveExport("proj-3");
    expect(result.missingScenes).toEqual(["Middle"]);
    expect(readdirSync(result.dir).sort()).toEqual([
      "01_intro.mp4",
      "03_finale.mp4",
      "project.kdenlive",
    ]);
  });

  it("writes a valid MLT XML project.kdenlive containing each clip filename in order", () => {
    const outDir = path.join(tmpRoot, "xml-out");
    mkdirSync(outDir, { recursive: true });

    const kdenlivePath = writeKdenliveProject(
      outDir,
      [
        { file: "01_opening&rain.mp4", durationSec: 4 },
        { file: "02_alley.mp4", durationSec: 6 },
      ],
      { width: 1280, height: 720, fps: 25 },
    );

    expect(kdenlivePath).toBe(path.join(outDir, "project.kdenlive"));
    const xml = readFileSync(kdenlivePath, "utf8");
    const parsed = parseAndValidateXml(xml);

    expect(parsed.rootTag).toBe("mlt");
    const profile = parsed.tags.find((t) => t.name === "profile");
    expect(profile?.attrs.width).toBe("1280");
    expect(profile?.attrs.height).toBe("720");
    expect(profile?.attrs.frame_rate_num).toBe("25");

    expect(xml).toContain("01_opening&amp;rain.mp4");
    expect(xml).toContain("02_alley.mp4");
    expect(xml.indexOf("01_opening&amp;rain.mp4")).toBeLessThan(
      xml.indexOf("02_alley.mp4"),
    );

    // Check timeline playlist entries preserve producer order and frame durations (4*25=100 -> out=99, 6*25=150 -> out=149)
    const playlistIdx = xml.indexOf('<playlist id="playlist0">');
    expect(playlistIdx).toBeGreaterThan(-1);
    const playlistSection = xml.slice(playlistIdx);
    expect(playlistSection).toContain('producer="producer0" in="0" out="99"');
    expect(playlistSection).toContain('producer="producer1" in="0" out="149"');
  });

  it("streams a valid ZIP archive of export_kdenlive via archiver", async () => {
    const db = getDb();
    ensureProjectDirs("zip-proj");

    db.insert(projects)
      .values({
        id: "proj-zip",
        slug: "zip-proj",
        title: "Zip Project",
      })
      .run();

    db.insert(scenes)
      .values({
        id: "sz1",
        projectId: "proj-zip",
        orderIndex: 1,
        slug: "shot-one",
        title: "Shot One",
        duration: 5,
        activeVideoAssetId: "az1",
      })
      .run();

    seedAssetFile("zip-proj/scenes/01_shot-one/clip_v1.mp4", "ZIP-MP4-DATA");
    db.insert(assets)
      .values({
        id: "az1",
        projectId: "proj-zip",
        sceneId: "sz1",
        type: "video",
        role: "video_clip",
        version: 1,
        filePath: "zip-proj/scenes/01_shot-one/clip_v1.mp4",
      })
      .run();

    await rebuildKdenliveExport("proj-zip");

    const stream = streamExportZip("proj-zip");
    const buf = await readStreamToBuffer(stream);

    // ZIP local file header magic bytes: PK\x03\x04
    expect(buf.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(buf.toString("latin1")).toContain("01_shot-one.mp4");
    expect(buf.toString("latin1")).toContain("project.kdenlive");
  });
});
