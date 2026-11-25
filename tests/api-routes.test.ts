import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDbForTests, getDb, jobs, projects, scenes } from "@/db";
import { resetRunnerForTests } from "@/lib/jobs/runner";
import { GET as getFile } from "@/app/api/files/[...path]/route";
import { POST as generateBatch } from "@/app/api/generate/batch/route";
import { POST as generateVideo } from "@/app/api/generate/video/route";
import { POST as createProject } from "@/app/api/projects/route";
import { POST as refineProject } from "@/app/api/projects/[id]/refine/route";
import { GET as getSettingsStatus } from "@/app/api/settings/status/route";

describe("API Route Handlers", () => {
  let tmpRoot: string;
  let origEnv: Record<string, string | undefined>;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(os.tmpdir(), "aivs-api-test-"));
    origEnv = {
      DATA_DIR: process.env.DATA_DIR,
      PROJECTS_DIR: process.env.PROJECTS_DIR,
      QWEN_API_KEY: process.env.QWEN_API_KEY,
      QWEN_REGION: process.env.QWEN_REGION,
    };
    process.env.DATA_DIR = path.join(tmpRoot, "data");
    process.env.PROJECTS_DIR = path.join(tmpRoot, "projects");
    process.env.QWEN_API_KEY = "sk-sp-supersecretkeyvalue9999";
    process.env.QWEN_REGION = "ap-southeast-1";
  });

  afterEach(() => {
    resetRunnerForTests();
    closeDbForTests();
    for (const [k, v] of Object.entries(origEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("GET /api/settings/status never contains the raw API key and never 500s on missing env", async () => {
    const res = await getSettingsStatus();
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("sk-sp-supersecretkeyvalue9999");

    const json = JSON.parse(text) as {
      configured: boolean;
      qwen: { maskedApiKey: string; keyType: string };
    };
    expect(json.configured).toBe(true);
    expect(json.qwen.maskedApiKey).toBe("sk-sp-****9999");
    expect(json.qwen.keyType).toBe("token_plan");

    // Also verify missing key does not return 500
    delete process.env.QWEN_API_KEY;
    const unconfiguredRes = await getSettingsStatus();
    expect(unconfiguredRes.status).toBe(200);
    const unconfiguredJson = (await unconfiguredRes.json()) as {
      configured: boolean;
    };
    expect(unconfiguredJson.configured).toBe(false);
  });

  it("POST /api/projects/[id]/refine requires confirmation before replacing an existing storyboard", async () => {
    const db = getDb();
    const now = Date.now();
    db.insert(projects)
      .values({
        id: "proj-refine",
        slug: "proj-refine",
        title: "Refine Project",
        roughIdea: "A detective in neon rain.",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(scenes)
      .values({
        id: "sc-refine",
        projectId: "proj-refine",
        orderIndex: 0,
        slug: "01-rain",
        title: "Rain",
        visualPrompt: "Neon rain",
        duration: 5,
        videoMode: "text_to_video",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const req = new Request("http://localhost/api/projects/proj-refine/refine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roughIdea: "A new idea" }),
    });

    const res = await refineProject(req, {
      params: Promise.resolve({ id: "proj-refine" }),
    });

    expect(res.status).toBe(409);
    const json = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(json.error.code).toBe("CONFIRM_REQUIRED");
    expect(json.error.message.toLowerCase()).toContain("confirm");

    // The existing storyboard must survive an unconfirmed refine attempt.
    const remainingScenes = db.select().from(scenes).all();
    expect(remainingScenes).toHaveLength(1);
    expect(remainingScenes[0].id).toBe("sc-refine");
  });

  it("POST /api/projects creates the DB row and project directory", async () => {
    const req = new Request("http://localhost/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Cyberpunk Rain",
        roughIdea: "A detective in neon rain.",
        aspectRatio: "16:9",
        resolution: "720P",
      }),
    });

    const res = await createProject(req);
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      project: { id: string; slug: string; title: string };
    };
    expect(json.project.title).toBe("Cyberpunk Rain");
    expect(json.project.slug).toBe("cyberpunk-rain");

    const db = getDb();
    const rows = db.select().from(projects).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(json.project.id);

    const projectDir = path.join(
      process.env.PROJECTS_DIR!,
      json.project.slug,
    );
    expect(existsSync(projectDir)).toBe(true);
    expect(existsSync(path.join(projectDir, "elements"))).toBe(true);
    expect(existsSync(path.join(projectDir, "scenes"))).toBe(true);
    expect(existsSync(path.join(projectDir, "export_kdenlive"))).toBe(true);
  });

  it("POST /api/generate/batch with confirm: false returns totals and enqueues 0 jobs", async () => {
    const db = getDb();
    const now = Date.now();
    db.insert(projects)
      .values({
        id: "proj-batch",
        slug: "proj-batch",
        title: "Batch Project",
        resolution: "1080P",
        defaultVideoModel: "wan3.0-video",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    db.insert(scenes)
      .values([
        {
          id: "sc-1",
          projectId: "proj-batch",
          orderIndex: 0,
          slug: "01-a",
          title: "Scene A",
          visualPrompt: "Wide shot of ocean",
          duration: 5,
          videoMode: "text_to_video",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "sc-2",
          projectId: "proj-batch",
          orderIndex: 1,
          slug: "02-b",
          title: "Scene B",
          visualPrompt: "Close up of lighthouse",
          duration: 8,
          videoMode: "text_to_video",
          createdAt: now,
          updatedAt: now,
        },
      ])
      .run();

    const req = new Request("http://localhost/api/generate/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: "proj-batch",
        kind: "clips",
        sceneIds: ["sc-1", "sc-2"],
        confirm: false,
      }),
    });

    const res = await generateBatch(req);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      count: number;
      totalSeconds: number;
      resolution: string;
      model: string;
    };
    expect(json.count).toBe(2);
    expect(json.totalSeconds).toBe(13);
    expect(json.resolution).toBe("1080P");
    expect(json.model).toBe("wan3.0-video");

    const enqueued = db.select().from(jobs).all();
    expect(enqueued).toHaveLength(0);
  });

  it("GET /api/files/..%2F..%2Fetc%2Fpasswd returns 400", async () => {
    const req = new Request(
      "http://localhost/api/files/..%2F..%2Fetc%2Fpasswd",
    );
    const res = await getFile(req, {
      params: Promise.resolve({ path: ["..%2F..%2Fetc%2Fpasswd"] }),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("UNSAFE_PATH");
  });

  it("POST /api/generate/video with mixed frame + reference input returns 400 with code WAN_VALIDATION", async () => {
    const req = new Request("http://localhost/api/generate/video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "A futuristic car driving through Tokyo",
        modelId: "wan3.0-video",
        media: [
          { type: "first_frame", url: "https://example.com/first.png" },
          { type: "reference_image", url: "https://example.com/ref.png" },
        ],
      }),
    });

    const res = await generateVideo(req);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe("WAN_VALIDATION");
  });
});
