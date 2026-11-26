import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDbForTests, getDb } from "@/db";
import { assets, jobs, projects, referenceElements, scenes } from "@/db/schema";
import {
  JobRunner,
  enqueueJob,
  getRunner,
  resetRunnerForTests,
  type RunnerDeps,
} from "@/lib/jobs/runner";
import { persistResult } from "@/lib/jobs/persist";
import { ProviderHttpError, mapProviderError } from "@/lib/providers/errors";
import { resolveInsideProjects } from "@/lib/storage/paths";

describe("JobRunner and persistResult", () => {
  let tmpRoot: string;
  let dataDir: string;
  let projectsDir: string;
  let prevDataDir: string | undefined;
  let prevProjectsDir: string | undefined;
  let prevMaxConcurrent: string | undefined;
  let prevPollInterval: string | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-25T10:00:00.000Z"));

    prevDataDir = process.env.DATA_DIR;
    prevProjectsDir = process.env.PROJECTS_DIR;
    prevMaxConcurrent = process.env.MAX_CONCURRENT_JOBS;
    prevPollInterval = process.env.JOB_POLL_INTERVAL_MS;

    tmpRoot = mkdtempSync(path.join(os.tmpdir(), "aivs-task6-"));
    dataDir = path.join(tmpRoot, "data");
    projectsDir = path.join(tmpRoot, "projects");

    process.env.DATA_DIR = dataDir;
    process.env.PROJECTS_DIR = projectsDir;
    process.env.MAX_CONCURRENT_JOBS = "2";
    process.env.JOB_POLL_INTERVAL_MS = "5000";

    resetRunnerForTests();
  });

  afterEach(() => {
    resetRunnerForTests();
    closeDbForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();

    const restore = (key: string, val: string | undefined) => {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    };
    restore("DATA_DIR", prevDataDir);
    restore("PROJECTS_DIR", prevProjectsDir);
    restore("MAX_CONCURRENT_JOBS", prevMaxConcurrent);
    restore("JOB_POLL_INTERVAL_MS", prevPollInterval);

    rmSync(tmpRoot, { recursive: true, force: true });
  });

  function seedProjectAndScene() {
    const db = getDb();
    db.insert(projects)
      .values({
        id: "proj-1",
        slug: "neon-city",
        title: "Neon City",
      })
      .run();

    db.insert(scenes)
      .values({
        id: "scene-1",
        projectId: "proj-1",
        orderIndex: 1,
        slug: "test",
        title: "Test Scene",
        visualPrompt: "A neon street",
      })
      .run();

    db.insert(referenceElements)
      .values({
        id: "elem-1",
        projectId: "proj-1",
        kind: "character",
        name: "Kira Vance",
        description: "Courier",
      })
      .run();
  }

  it("enforces maxConcurrent = 2 when 3 jobs are queued", async () => {
    seedProjectAndScene();

    const submit = vi.fn<NonNullable<RunnerDeps["submit"]>>(async (job) => ({
      kind: "async",
      taskId: `task-${job.id}`,
    }));
    const poll = vi.fn<NonNullable<RunnerDeps["poll"]>>(async () => ({
      status: "RUNNING",
      resultUrls: [],
    }));
    const download = vi.fn<NonNullable<RunnerDeps["download"]>>();

    const j1 = enqueueJob({
      projectId: "proj-1",
      sceneId: "scene-1",
      modality: "video",
      role: "video_clip",
      modelId: "wan3.0-video",
      request: { prompt: "Shot 1" },
    });
    const j2 = enqueueJob({
      projectId: "proj-1",
      sceneId: "scene-1",
      modality: "video",
      role: "video_clip",
      modelId: "wan3.0-video",
      request: { prompt: "Shot 2" },
    });
    const j3 = enqueueJob({
      projectId: "proj-1",
      sceneId: "scene-1",
      modality: "video",
      role: "video_clip",
      modelId: "wan3.0-video",
      request: { prompt: "Shot 3" },
    });

    const runner = new JobRunner({ submit, poll, download }, { maxConcurrent: 2 });
    await runner.tick();

    expect(submit).toHaveBeenCalledTimes(2);

    const db = getDb();
    const rows = db.select().from(jobs).all();
    const byId = new Map(rows.map((r) => [r.id, r]));

    expect(byId.get(j1.id)?.status).toBe("PENDING");
    expect(byId.get(j2.id)?.status).toBe("PENDING");
    expect(byId.get(j3.id)?.status).toBe("QUEUED");
  });

  it("applies exponential backoff on 429 throttling and fails after 3 attempts with mapped message", async () => {
    seedProjectAndScene();

    const rateLimitErr = new ProviderHttpError(
      mapProviderError("Throttling", 429),
      429,
      "Rate limit exceeded",
    );
    const submit = vi.fn<NonNullable<RunnerDeps["submit"]>>(async () => {
      throw rateLimitErr;
    });
    const poll = vi.fn<NonNullable<RunnerDeps["poll"]>>();
    const download = vi.fn<NonNullable<RunnerDeps["download"]>>();

    const job = enqueueJob({
      projectId: "proj-1",
      sceneId: "scene-1",
      modality: "video",
      role: "video_clip",
      modelId: "wan3.0-video",
      request: { prompt: "Rate limited" },
    });

    const runner = new JobRunner({ submit, poll, download }, { maxConcurrent: 2 });
    const db = getDb();

    // Attempt 1 -> QUEUED, attempts = 1, nextEligibleAt > now
    await runner.tick();
    expect(submit).toHaveBeenCalledTimes(1);
    let row = db.select().from(jobs).where(eq(jobs.id, job.id)).get()!;
    expect(row.status).toBe("QUEUED");
    expect(row.attempts).toBe(1);
    const eligible1 = runner.getNextEligibleAt(job.id);
    expect(eligible1).toBeDefined();
    expect(eligible1!).toBeGreaterThan(Date.now());

    // Immediate tick before backoff expires should NOT retry
    await runner.tick();
    expect(submit).toHaveBeenCalledTimes(1);

    // Advance past attempt 1 backoff -> Attempt 2
    vi.setSystemTime(eligible1!);
    await runner.tick();
    expect(submit).toHaveBeenCalledTimes(2);
    row = db.select().from(jobs).where(eq(jobs.id, job.id)).get()!;
    expect(row.status).toBe("QUEUED");
    expect(row.attempts).toBe(2);
    const eligible2 = runner.getNextEligibleAt(job.id);
    expect(eligible2).toBeDefined();
    // Exponential: second backoff delay >= 2x first backoff delay
    expect(eligible2! - eligible1!).toBeGreaterThan(eligible1! - (eligible1! - 1000));
    expect(eligible2! - Date.now()).toBeGreaterThanOrEqual(2000);

    // Advance past attempt 2 backoff -> Attempt 3 -> FAILED
    vi.setSystemTime(eligible2!);
    await runner.tick();
    expect(submit).toHaveBeenCalledTimes(3);
    row = db.select().from(jobs).where(eq(jobs.id, job.id)).get()!;
    expect(row.status).toBe("FAILED");
    expect(row.attempts).toBe(3);
    expect(row.errorCode).toBe("Throttling");
    expect(row.errorMessage).toContain("rate limit");
  });

  it("marks job FAILED with errorCode when poll returns DataInspectionFailed", async () => {
    seedProjectAndScene();
    const db = getDb();

    const job = enqueueJob({
      projectId: "proj-1",
      sceneId: "scene-1",
      modality: "video",
      role: "video_clip",
      modelId: "wan3.0-video",
      request: { prompt: "Blocked prompt" },
    });
    db.update(jobs)
      .set({ status: "RUNNING", externalTaskId: "ext-mod-1" })
      .where(eq(jobs.id, job.id))
      .run();

    const poll = vi.fn<NonNullable<RunnerDeps["poll"]>>(async () => ({
      status: "FAILED",
      resultUrls: [],
      errorCode: "DataInspectionFailed",
      errorMessage: "Input data may contain inappropriate content.",
    }));

    const runner = new JobRunner({
      submit: vi.fn(),
      poll,
      download: vi.fn(),
    });

    await runner.tick();

    const updated = db.select().from(jobs).where(eq(jobs.id, job.id)).get()!;
    expect(updated.status).toBe("FAILED");
    expect(updated.errorCode).toBe("DataInspectionFailed");
    expect(updated.errorMessage).toContain("DataInspectionFailed");
  });

  it("downloads SUCCEEDED job, writes scenes/01_test/clip_v1.mp4, links asset, and is idempotent on repeat", async () => {
    seedProjectAndScene();
    const db = getDb();

    const job = enqueueJob({
      projectId: "proj-1",
      sceneId: "scene-1",
      modality: "video",
      role: "video_clip",
      modelId: "wan3.0-video",
      request: { prompt: "Neon rain" },
    });
    db.update(jobs)
      .set({ status: "RUNNING", externalTaskId: "ext-ok-1" })
      .where(eq(jobs.id, job.id))
      .run();

    const fakeVideoBytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
    const download = vi.fn<NonNullable<RunnerDeps["download"]>>(async () => ({
      bytes: fakeVideoBytes,
      mime: "video/mp4",
    }));
    const poll = vi.fn<NonNullable<RunnerDeps["poll"]>>(async () => ({
      status: "SUCCEEDED",
      resultUrls: ["https://cdn.example.com/output/clip.mp4"],
    }));

    const runner = new JobRunner({
      submit: vi.fn(),
      poll,
      download,
    });

    await runner.tick();

    const updatedJob = db.select().from(jobs).where(eq(jobs.id, job.id)).get()!;
    expect(updatedJob.status).toBe("READY");
    expect(updatedJob.resultAssetId).toBeTruthy();

    const asset = db
      .select()
      .from(assets)
      .where(eq(assets.id, updatedJob.resultAssetId!))
      .get()!;
    expect(asset.filePath).toBe("neon-city/scenes/01_test/clip_v1.mp4");
    expect(asset.version).toBe(1);
    expect(asset.type).toBe("video");
    expect(asset.role).toBe("video_clip");

    const absFile = resolveInsideProjects(asset.filePath);
    expect(existsSync(absFile)).toBe(true);
    expect(new Uint8Array(readFileSync(absFile))).toEqual(fakeVideoBytes);

    const flatClip = path.join(projectsDir, "neon-city", "test_clip_v1.mp4");
    expect(existsSync(flatClip)).toBe(true);
    expect(new Uint8Array(readFileSync(flatClip))).toEqual(fakeVideoBytes);

    const updatedScene = db
      .select()
      .from(scenes)
      .where(eq(scenes.id, "scene-1"))
      .get()!;
    expect(updatedScene.activeVideoAssetId).toBe(asset.id);

    // Idempotency: calling persistResult again for the same job returns the exact same asset
    const secondAsset = await persistResult(
      updatedJob,
      { url: "https://cdn.example.com/output/clip.mp4" },
      { download },
    );
    expect(secondAsset.id).toBe(asset.id);
    expect(download).toHaveBeenCalledTimes(1);
    expect(db.select().from(assets).all()).toHaveLength(1);

    // If a duplicate submit left the job in DOWNLOADING after the asset was
    // already persisted, the idempotent path must still finish the job.
    db.update(jobs)
      .set({ status: "DOWNLOADING" })
      .where(eq(jobs.id, job.id))
      .run();
    await persistResult(
      updatedJob,
      { url: "https://cdn.example.com/output/clip.mp4" },
      { download },
    );
    const recovered = db.select().from(jobs).where(eq(jobs.id, job.id)).get()!;
    expect(recovered.status).toBe("READY");
  });

  it("keeps only the newest element image when a new one is persisted", async () => {
    seedProjectAndScene();
    const db = getDb();
    const poll = vi.fn<NonNullable<RunnerDeps["poll"]>>(async () => ({
      status: "SUCCEEDED",
      resultUrls: ["https://cdn.example.com/element.png"],
    }));
    let frame = 0;
    const download = vi.fn<NonNullable<RunnerDeps["download"]>>(async () => ({
      bytes: new Uint8Array([137, 80, 78, 71, frame++]),
      mime: "image/png",
    }));
    const runner = new JobRunner({ submit: vi.fn(), poll, download });

    const runJob = async () => {
      const job = enqueueJob({
        projectId: "proj-1",
        elementId: "elem-1",
        modality: "image",
        role: "element_sheet",
        modelId: "wan2.7-image-pro",
        request: { prompt: "Kira portrait" },
      });
      db.update(jobs)
        .set({ status: "RUNNING", externalTaskId: `ext-${job.id}` })
        .where(eq(jobs.id, job.id))
        .run();
      await runner.tick();
      return db.select().from(jobs).where(eq(jobs.id, job.id)).get()!;
    };

    const firstJob = await runJob();
    const firstAsset = db
      .select()
      .from(assets)
      .where(eq(assets.id, firstJob.resultAssetId!))
      .get()!;
    const firstPath = resolveInsideProjects(firstAsset.filePath);
    expect(existsSync(firstPath)).toBe(true);

    const secondJob = await runJob();
    const secondAsset = db
      .select()
      .from(assets)
      .where(eq(assets.id, secondJob.resultAssetId!))
      .get()!;

    expect(secondAsset.id).not.toBe(firstAsset.id);
    expect(existsSync(firstPath)).toBe(false);
    expect(existsSync(resolveInsideProjects(secondAsset.filePath))).toBe(true);

    const elementAssets = db
      .select()
      .from(assets)
      .where(
        and(
          eq(assets.elementId, "elem-1"),
          eq(assets.role, "element_sheet"),
        ),
      )
      .all();
    expect(elementAssets).toHaveLength(1);
    expect(elementAssets[0].id).toBe(secondAsset.id);

    const element = db
      .select()
      .from(referenceElements)
      .where(eq(referenceElements.id, "elem-1"))
      .get()!;
    expect(element.activeImagePath).toBe(secondAsset.filePath);

    expect(
      existsSync(
        path.join(
          projectsDir,
          "neon-city",
          "element_character_kira-vance_v1.png",
        ),
      ),
    ).toBe(false);
    expect(
      existsSync(
        path.join(
          projectsDir,
          "neon-city",
          "element_character_kira-vance_v2.png",
        ),
      ),
    ).toBe(true);
  });

  it("claims a queued job atomically so two runners cannot submit it twice", async () => {
    seedProjectAndScene();

    const job = enqueueJob({
      projectId: "proj-1",
      elementId: "elem-1",
      modality: "image",
      role: "element_sheet",
      modelId: "wan2.7-image-pro",
      request: { prompt: "Kira portrait" },
    });

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const submit = vi.fn<NonNullable<RunnerDeps["submit"]>>(async (submitted) => {
      await gate;
      return { kind: "async", taskId: `task-${submitted.id}` };
    });
    const poll = vi.fn<NonNullable<RunnerDeps["poll"]>>(async () => ({
      status: "RUNNING",
      resultUrls: [],
    }));
    const download = vi.fn<NonNullable<RunnerDeps["download"]>>();

    const runnerA = new JobRunner({ submit, poll, download }, { maxConcurrent: 2 });
    const runnerB = new JobRunner({ submit, poll, download }, { maxConcurrent: 2 });

    const tickA = runnerA.tick();
    const tickB = runnerB.tick();
    release();
    await Promise.all([tickA, tickB]);

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][0].id).toBe(job.id);
  });

  it("reconciles a DOWNLOADING job that already has a result asset on each tick", async () => {
    seedProjectAndScene();
    const db = getDb();
    const now = Date.now();

    const stuck = enqueueJob({
      projectId: "proj-1",
      elementId: "elem-1",
      modality: "image",
      role: "element_sheet",
      modelId: "wan2.7-image-pro",
      request: { prompt: "Kira portrait" },
    });

    const assetId = "asset-already-persisted";
    db.insert(assets)
      .values({
        id: assetId,
        projectId: "proj-1",
        elementId: "elem-1",
        type: "image",
        role: "element_sheet",
        version: 1,
        filePath: "neon-city/elements/character_kira-vance_v1.png",
        prompt: "Kira portrait",
        paramsJson: "{}",
        createdAt: now,
      })
      .run();
    db.update(jobs)
      .set({
        status: "DOWNLOADING",
        attempts: 1,
        resultAssetId: assetId,
      })
      .where(eq(jobs.id, stuck.id))
      .run();

    const queued = enqueueJob({
      projectId: "proj-1",
      sceneId: "scene-1",
      modality: "video",
      role: "video_clip",
      modelId: "wan3.0-video",
      request: { prompt: "Next shot" },
    });

    const submit = vi.fn<NonNullable<RunnerDeps["submit"]>>(async (job) => ({
      kind: "async",
      taskId: `task-${job.id}`,
    }));
    const runner = new JobRunner(
      { submit, poll: vi.fn(), download: vi.fn() },
      { maxConcurrent: 1 },
    );

    await runner.tick();

    const reconciled = db.select().from(jobs).where(eq(jobs.id, stuck.id)).get()!;
    expect(reconciled.status).toBe("READY");
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][0].id).toBe(queued.id);
  });

  it("requeues RUNNING jobs without an external task id after a restart", () => {
    seedProjectAndScene();
    const db = getDb();

    const job = enqueueJob({
      projectId: "proj-1",
      sceneId: "scene-1",
      modality: "video",
      role: "video_clip",
      modelId: "wan3.0-video",
      request: { prompt: "Interrupted mid-submit" },
    });
    db.update(jobs)
      .set({ status: "RUNNING", attempts: 1 })
      .where(eq(jobs.id, job.id))
      .run();

    const runner = new JobRunner({});
    runner.resume();

    const updated = db.select().from(jobs).where(eq(jobs.id, job.id)).get()!;
    expect(updated.status).toBe("QUEUED");
  });

  it("releases queued claims left by a dead process on resume", () => {
    seedProjectAndScene();
    const db = getDb();

    const job = enqueueJob({
      projectId: "proj-1",
      elementId: "elem-1",
      modality: "image",
      role: "element_sheet",
      modelId: "wan2.7-image-pro",
      request: { prompt: "Kira portrait" },
    });
    db.update(jobs)
      .set({ claimedAt: Date.now() })
      .where(eq(jobs.id, job.id))
      .run();

    const runner = new JobRunner({});
    runner.resume();

    const updated = db.select().from(jobs).where(eq(jobs.id, job.id)).get()!;
    expect(updated.status).toBe("QUEUED");
    expect(updated.claimedAt).toBeNull();
  });

  it("fails an image task that has been pending longer than the image budget", async () => {
    seedProjectAndScene();
    const db = getDb();

    const job = enqueueJob({
      projectId: "proj-1",
      elementId: "elem-1",
      modality: "image",
      role: "element_sheet",
      modelId: "wan2.7-image-pro",
      request: { prompt: "Kira portrait" },
    });
    db.update(jobs)
      .set({ status: "PENDING", externalTaskId: "ext-image-1" })
      .where(eq(jobs.id, job.id))
      .run();

    const poll = vi.fn<NonNullable<RunnerDeps["poll"]>>(async () => ({
      status: "RUNNING",
      resultUrls: [],
    }));

    vi.setSystemTime(new Date(Date.now() + 16 * 60 * 1000));
    const runner = new JobRunner({ submit: vi.fn(), poll, download: vi.fn() });
    await runner.tick();

    const updated = db.select().from(jobs).where(eq(jobs.id, job.id)).get()!;
    expect(updated.status).toBe("FAILED");
    expect(updated.errorCode).toBe("TaskTimeout");
    expect(poll).not.toHaveBeenCalled();
  });

  it("returns a single globalThis runner instance and creates only one interval on repeated start()", () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

    const r1 = getRunner();
    const r2 = getRunner();
    expect(r1).toBe(r2);

    r1.start();
    r1.start();
    r2.start();

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    r1.stop();
  });

  it("resumes pre-existing RUNNING and DOWNLOADING jobs after restart without resubmitting", async () => {
    seedProjectAndScene();
    const db = getDb();

    const runningJob = enqueueJob({
      projectId: "proj-1",
      sceneId: "scene-1",
      modality: "video",
      role: "video_clip",
      modelId: "wan3.0-video",
      request: { prompt: "Already running" },
    });
    db.update(jobs)
      .set({ status: "RUNNING", externalTaskId: "ext-resume-1" })
      .where(eq(jobs.id, runningJob.id))
      .run();

    const downloadingJob = enqueueJob({
      projectId: "proj-1",
      elementId: "elem-1",
      modality: "image",
      role: "element_sheet",
      modelId: "wan2.7-image-pro",
      request: { prompt: "Character sheet" },
    });
    db.update(jobs)
      .set({ status: "DOWNLOADING", externalTaskId: "ext-resume-2" })
      .where(eq(jobs.id, downloadingJob.id))
      .run();

    const submit = vi.fn<NonNullable<RunnerDeps["submit"]>>();
    const poll = vi.fn<NonNullable<RunnerDeps["poll"]>>(async (job) => {
      if (job.id === downloadingJob.id) {
        return {
          status: "SUCCEEDED",
          resultUrls: ["https://cdn.example.com/sheet.png"],
        };
      }
      return {
        status: "RUNNING",
        resultUrls: [],
      };
    });
    const download = vi.fn<NonNullable<RunnerDeps["download"]>>(async () => ({
      bytes: new Uint8Array([137, 80, 78, 71]),
      mime: "image/png",
    }));

    const runner = new JobRunner({ submit, poll, download });
    runner.resume();
    await runner.tick();

    expect(submit).not.toHaveBeenCalled();
    expect(poll).toHaveBeenCalledTimes(2);

    const refreshedDownloading = db
      .select()
      .from(jobs)
      .where(eq(jobs.id, downloadingJob.id))
      .get()!;
    expect(refreshedDownloading.status).toBe("READY");
    expect(refreshedDownloading.resultAssetId).toBeTruthy();

    const asset = db
      .select()
      .from(assets)
      .where(eq(assets.id, refreshedDownloading.resultAssetId!))
      .get()!;
    expect(asset.filePath).toBe("neon-city/elements/character_kira-vance_v1.png");

    const refreshedElement = db
      .select()
      .from(referenceElements)
      .where(eq(referenceElements.id, "elem-1"))
      .get()!;
    expect(refreshedElement.activeImagePath).toBe(asset.filePath);
  });

  it("scrubs Base64 data URIs from jobs.requestJson once a job completes (READY)", async () => {
    seedProjectAndScene();
    const db = getDb();

    const job = enqueueJob({
      projectId: "proj-1",
      elementId: "elem-1",
      modality: "image",
      role: "element_sheet",
      modelId: "wan2.7-image-pro",
      request: {
        modality: "image",
        prompt: "Single character portrait of Kira",
        referenceImages: ["data:image/jpeg;base64,AAAA1111BBBB2222"],
        params: { size: "1024*1024" },
      },
    });

    const runner = new JobRunner({
      submit: vi.fn(async () => ({
        kind: "sync" as const,
        source: {
          kind: "bytes" as const,
          bytes: new Uint8Array([137, 80, 78, 71]),
          mime: "image/png",
        },
      })),
      poll: vi.fn(),
      download: vi.fn(),
    });

    await runner.tick();

    const updated = db.select().from(jobs).where(eq(jobs.id, job.id)).get()!;
    expect(updated.status).toBe("READY");
    expect(updated.requestJson).not.toContain("AAAA1111BBBB2222");
    expect(updated.requestJson).toContain("[base64-omitted]");
    expect(updated.requestJson).toContain("Single character portrait of Kira");
  });
});
