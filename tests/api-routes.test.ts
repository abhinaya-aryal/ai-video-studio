import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assets,
  closeDbForTests,
  customModels,
  getDb,
  jobs,
  projects,
  referenceElements,
  scenes,
} from "@/db";
import { resetRunnerForTests } from "@/lib/jobs/runner";
import { GET as getFile } from "@/app/api/files/[...path]/route";
import { POST as generateBatch } from "@/app/api/generate/batch/route";
import { POST as generateVideo } from "@/app/api/generate/video/route";
import { GET as listJobs } from "@/app/api/jobs/route";
import { POST as createProject } from "@/app/api/projects/route";
import {
  DELETE as deleteProject,
  GET as getProject,
} from "@/app/api/projects/[id]/route";
import { POST as refineProject } from "@/app/api/projects/[id]/refine/route";
import { GET as getSettingsStatus } from "@/app/api/settings/status/route";
import { POST as uploadFile } from "@/app/api/upload/route";

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

    getDb()
      .insert(customModels)
      .values([
        {
          id: "seed-video",
          modelId: "wan3.0-video",
          displayName: "wan3.0-video",
          modality: "video",
          family: "wan3",
          capabilitiesJson: "{}",
          source: "discovered",
          available: 1,
        },
        {
          id: "seed-image",
          modelId: "wan2.7-image-pro",
          displayName: "wan2.7-image-pro",
          modality: "image",
          family: "wan2.7",
          capabilitiesJson: "{}",
          source: "discovered",
          available: 1,
        },
      ])
      .run();
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

  it("DELETE /api/projects/:id removes DB rows and leaves the project folder on disk", async () => {
    const createRes = await createProject(
      new Request("http://localhost/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Delete Me", roughIdea: "Temporary." }),
      }),
    );
    const { project } = (await createRes.json()) as {
      project: { id: string; slug: string };
    };

    const db = getDb();
    const now = Date.now();
    db.insert(referenceElements)
      .values({
        id: "elem-del",
        projectId: project.id,
        kind: "character",
        name: "Kira",
        description: "",
      })
      .run();
    db.insert(scenes)
      .values({
        id: "scene-del",
        projectId: project.id,
        orderIndex: 0,
        slug: "01-test",
        title: "Test",
        visualPrompt: "Test scene",
        duration: 5,
        videoMode: "text_to_video",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(assets)
      .values({
        id: "asset-del",
        projectId: project.id,
        sceneId: "scene-del",
        type: "image",
        role: "keyframe_first",
        version: 1,
        filePath: `${project.slug}/scenes/01-test/keyframe_first_v1.png`,
        prompt: "",
        paramsJson: "{}",
        createdAt: now,
      })
      .run();
    db.insert(jobs)
      .values({
        id: "job-del",
        projectId: project.id,
        sceneId: "scene-del",
        modality: "image",
        role: "keyframe_first",
        modelId: "wan2.7-image-pro",
        requestJson: "{}",
        status: "QUEUED",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const projectDir = path.join(process.env.PROJECTS_DIR!, project.slug);
    expect(existsSync(projectDir)).toBe(true);

    const res = await deleteProject(
      new Request(`http://localhost/api/projects/${project.id}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: project.id }) },
    );
    expect(res.status).toBe(200);

    expect(db.select().from(projects).all()).toHaveLength(0);
    expect(db.select().from(referenceElements).all()).toHaveLength(0);
    expect(db.select().from(scenes).all()).toHaveLength(0);
    expect(db.select().from(assets).all()).toHaveLength(0);
    expect(db.select().from(jobs).all()).toHaveLength(0);
    expect(existsSync(projectDir)).toBe(true);
  });

  it("DELETE /api/projects/:id refuses to remove the hidden Quick Clips project", async () => {
    const db = getDb();
    const now = Date.now();
    db.insert(projects)
      .values({
        id: "proj-hidden",
        slug: "_quick-clips",
        title: "Quick Clips",
        isHidden: 1,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const res = await deleteProject(
      new Request("http://localhost/api/projects/proj-hidden", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "proj-hidden" }) },
    );

    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("PROJECT_PROTECTED");
    expect(db.select().from(projects).all()).toHaveLength(1);
  });

  it("POST /api/upload keeps only the newest image per element", async () => {
    const createRes = await createProject(
      new Request("http://localhost/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Kira Project", roughIdea: "A courier." }),
      }),
    );
    const { project } = (await createRes.json()) as {
      project: { id: string; slug: string };
    };

    const db = getDb();
    db.insert(referenceElements)
      .values({
        id: "elem-upload",
        projectId: project.id,
        kind: "character",
        name: "Kira Vance",
        description: "Courier",
      })
      .run();

    const form = new FormData();
    form.append(
      "file",
      new File([new Uint8Array([137, 80, 78, 71])], "kira.png", {
        type: "image/png",
      }),
    );
    form.append("projectId", project.id);
    form.append("elementId", "elem-upload");

    const res = await uploadFile(
      new Request("http://localhost/api/upload", { method: "POST", body: form }),
    );
    expect(res.status).toBe(201);
    const json = (await res.json()) as { filePath: string };

    const elementAssets = db
      .select()
      .from(assets)
      .where(eq(assets.elementId, "elem-upload"))
      .all();
    expect(elementAssets).toHaveLength(1);
    expect(elementAssets[0].role).toBe("element_sheet");
    expect(elementAssets[0].version).toBe(1);
    expect(elementAssets[0].filePath).toBe(json.filePath);

    const element = db
      .select()
      .from(referenceElements)
      .where(eq(referenceElements.id, "elem-upload"))
      .get()!;
    expect(element.activeImagePath).toBe(json.filePath);

    const firstAbs = path.join(process.env.PROJECTS_DIR!, json.filePath);
    expect(existsSync(firstAbs)).toBe(true);

    const secondForm = new FormData();
    secondForm.append(
      "file",
      new File([new Uint8Array([137, 80, 78, 71, 2])], "kira-v2.png", {
        type: "image/png",
      }),
    );
    secondForm.append("projectId", project.id);
    secondForm.append("elementId", "elem-upload");

    const secondRes = await uploadFile(
      new Request("http://localhost/api/upload", {
        method: "POST",
        body: secondForm,
      }),
    );
    expect(secondRes.status).toBe(201);
    const secondJson = (await secondRes.json()) as { filePath: string };

    const remainingAssets = db
      .select()
      .from(assets)
      .where(eq(assets.elementId, "elem-upload"))
      .all();
    expect(remainingAssets).toHaveLength(1);
    expect(remainingAssets[0].filePath).toBe(secondJson.filePath);
    expect(existsSync(firstAbs)).toBe(false);

    const updatedElement = db
      .select()
      .from(referenceElements)
      .where(eq(referenceElements.id, "elem-upload"))
      .get()!;
    expect(updatedElement.activeImagePath).toBe(secondJson.filePath);
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

  it("GET /api/jobs and GET /api/projects/[id] omit requestJson from job payloads", async () => {
    const db = getDb();
    const now = Date.now();
    db.insert(projects)
      .values({
        id: "proj-jobs-lean",
        slug: "proj-jobs-lean",
        title: "Lean Jobs",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(jobs)
      .values({
        id: "job-heavy",
        projectId: "proj-jobs-lean",
        modality: "image",
        modelId: "wan2.7-image",
        role: "element_sheet",
        requestJson: JSON.stringify({ hugeBase64: "A".repeat(2048) }),
        status: "QUEUED",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const jobsRes = await listJobs(
      new Request("http://localhost/api/jobs?projectId=proj-jobs-lean"),
    );
    expect(jobsRes.status).toBe(200);
    const jobsJson = (await jobsRes.json()) as {
      jobs: Array<Record<string, unknown>>;
    };
    expect(jobsJson.jobs).toHaveLength(1);
    expect(jobsJson.jobs[0].id).toBe("job-heavy");
    expect("requestJson" in jobsJson.jobs[0]).toBe(false);

    const projRes = await getProject(
      new Request("http://localhost/api/projects/proj-jobs-lean"),
      { params: Promise.resolve({ id: "proj-jobs-lean" }) },
    );
    expect(projRes.status).toBe(200);
    const projJson = (await projRes.json()) as {
      jobs: Array<Record<string, unknown>>;
    };
    expect(projJson.jobs).toHaveLength(1);
    expect("requestJson" in projJson.jobs[0]).toBe(false);
  });

  it("GET /api/files/[...path] supports Range requests (206) and ETag revalidation (304)", async () => {
    const sampleDir = path.join(process.env.PROJECTS_DIR!, "demo-proj");
    mkdirSync(sampleDir, { recursive: true });
    writeFileSync(path.join(sampleDir, "clip.mp4"), "0123456789abcdef");

    const fullRes = await getFile(
      new Request("http://localhost/api/files/demo-proj/clip.mp4"),
      { params: Promise.resolve({ path: ["demo-proj", "clip.mp4"] }) },
    );
    expect(fullRes.status).toBe(200);
    expect(fullRes.headers.get("accept-ranges")).toBe("bytes");
    expect(fullRes.headers.get("cache-control")).toBe("private, no-cache");
    const etag = fullRes.headers.get("etag");
    expect(etag).toBeTruthy();
    expect(await fullRes.text()).toBe("0123456789abcdef");

    const notModifiedRes = await getFile(
      new Request("http://localhost/api/files/demo-proj/clip.mp4", {
        headers: { "If-None-Match": etag! },
      }),
      { params: Promise.resolve({ path: ["demo-proj", "clip.mp4"] }) },
    );
    expect(notModifiedRes.status).toBe(304);

    const rangeRes = await getFile(
      new Request("http://localhost/api/files/demo-proj/clip.mp4", {
        headers: { Range: "bytes=4-9" },
      }),
      { params: Promise.resolve({ path: ["demo-proj", "clip.mp4"] }) },
    );
    expect(rangeRes.status).toBe(206);
    expect(rangeRes.headers.get("content-range")).toBe("bytes 4-9/16");
    expect(rangeRes.headers.get("content-length")).toBe("6");
    expect(await rangeRes.text()).toBe("456789");
  });
});
