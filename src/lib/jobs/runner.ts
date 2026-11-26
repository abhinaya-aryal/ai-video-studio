import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import {
  getDb,
  jobs,
  type AssetRole,
  type Job,
  type JobModality,
} from "@/db";
import { getConfig } from "@/lib/config";
import {
  defaultDownload,
  persistResult,
  type DownloadFn,
  type ResultSource,
} from "@/lib/jobs/persist";
import {
  ProviderHttpError,
  mapProviderError,
  sanitizeErrorText,
} from "@/lib/providers/errors";
import {
  generateImage,
  getTaskStatus,
  submitVideoTask,
  synthesizeSpeech,
  type TaskStatusResult,
} from "@/lib/providers/qwen-client";
import { resolveQwenBaseUrl } from "@/lib/providers/qwen-endpoints";
import type { VideoSynthesisRequestBody } from "@/lib/providers/wan-payload";

export const MAX_JOB_ATTEMPTS = 3;
export const BASE_BACKOFF_MS = 1000;
/**
 * A claim older than this is assumed to belong to a dead process and is
 * released back to the queue. Provider calls time out well before this.
 */
export const CLAIM_STALE_MS = 5 * 60 * 1000;

export interface PreparedVideoRequest {
  modality?: "video";
  body: VideoSynthesisRequestBody | Record<string, unknown>;
  needsOssHeader?: boolean;
  prompt?: string;
  params?: Record<string, unknown>;
}

export interface PreparedImageRequest {
  modality?: "image";
  prompt: string;
  referenceImages?: string[];
  size?: string;
  n?: number;
  negativePrompt?: string;
  needsOssHeader?: boolean;
  params?: Record<string, unknown>;
}

export interface PreparedAudioRequest {
  modality?: "audio";
  text: string;
  voice?: string;
  format?: string;
  sampleRate?: number;
  prompt?: string;
  params?: Record<string, unknown>;
}

export type PreparedRequest =
  | PreparedVideoRequest
  | PreparedImageRequest
  | PreparedAudioRequest
  | Record<string, unknown>;

export interface EnqueueJobInput {
  projectId: string;
  sceneId?: string | null;
  elementId?: string | null;
  modality: JobModality;
  role: AssetRole;
  modelId: string;
  request: PreparedRequest;
}

export type SubmitResult =
  | { kind: "async"; taskId: string }
  | { kind: "sync"; source: ResultSource };

export interface RunnerDeps {
  submit?: (job: Job, request: PreparedRequest) => Promise<SubmitResult>;
  poll?: (job: Job) => Promise<TaskStatusResult>;
  download?: DownloadFn;
}

export interface RunnerOptions {
  maxConcurrent?: number;
  pollIntervalMs?: number;
}

/** Insert a new job into SQLite with status `QUEUED` and return it. */
export function enqueueJob(input: EnqueueJobInput): Job {
  const db = getDb();
  const now = Date.now();
  const job: Job = {
    id: randomUUID(),
    projectId: input.projectId,
    sceneId: input.sceneId ?? null,
    elementId: input.elementId ?? null,
    modality: input.modality,
    modelId: input.modelId,
    role: input.role,
    requestJson: JSON.stringify(input.request),
    externalTaskId: null,
    status: "QUEUED",
    claimedAt: null,
    attempts: 0,
    errorCode: null,
    errorMessage: null,
    resultAssetId: null,
    createdAt: now,
    updatedAt: now,
  };

  db.insert(jobs).values(job).run();
  return job;
}

function getQwenCredentials(): { baseUrl: string; apiKey: string } {
  const cfg = getConfig();
  const apiKey = cfg.qwen.apiKey?.trim();
  if (!apiKey) {
    throw new ProviderHttpError(
      mapProviderError("InvalidApiKey", 401),
      401,
      "QWEN_API_KEY is not configured.",
    );
  }
  return {
    baseUrl: resolveQwenBaseUrl(cfg.qwen),
    apiKey,
  };
}

async function defaultSubmit(
  job: Job,
  request: PreparedRequest,
): Promise<SubmitResult> {
  const { baseUrl, apiKey } = getQwenCredentials();
  const req = request as Record<string, unknown>;

  if (job.modality === "video") {
    const body = (req.body ?? req) as Record<string, unknown>;
    const needsOssHeader = Boolean(req.needsOssHeader);
    const { taskId } = await submitVideoTask({
      baseUrl,
      apiKey,
      body,
      needsOssHeader,
    });
    return { kind: "async", taskId };
  }

  if (job.modality === "image") {
    const result = await generateImage({
      baseUrl,
      apiKey,
      model: job.modelId,
      prompt: typeof req.prompt === "string" ? req.prompt : "",
      referenceImages: Array.isArray(req.referenceImages)
        ? (req.referenceImages as string[])
        : undefined,
      size: typeof req.size === "string" ? req.size : undefined,
      n: typeof req.n === "number" ? req.n : undefined,
      negativePrompt:
        typeof req.negativePrompt === "string" ? req.negativePrompt : undefined,
      needsOssHeader:
        typeof req.needsOssHeader === "boolean"
          ? req.needsOssHeader
          : undefined,
    });

    if (result.kind === "async") {
      return { kind: "async", taskId: result.taskId };
    }
    return { kind: "sync", source: { url: result.urls[0] } };
  }

  const ttsText =
    typeof req.text === "string"
      ? req.text
      : typeof req.prompt === "string"
        ? req.prompt
        : "";
  const speech = await synthesizeSpeech({
    baseUrl,
    apiKey,
    model: job.modelId,
    text: ttsText,
    voice: typeof req.voice === "string" ? req.voice : undefined,
    format: typeof req.format === "string" ? req.format : undefined,
    sampleRate: typeof req.sampleRate === "number" ? req.sampleRate : undefined,
  });

  if (speech.kind === "url") {
    return { kind: "sync", source: { url: speech.url } };
  }
  return {
    kind: "sync",
    source: { bytes: speech.data, mime: speech.mime },
  };
}

async function defaultPoll(job: Job): Promise<TaskStatusResult> {
  if (!job.externalTaskId) {
    throw new Error(`Cannot poll job ${job.id} without externalTaskId`);
  }
  const { baseUrl, apiKey } = getQwenCredentials();
  return getTaskStatus({
    baseUrl,
    apiKey,
    taskId: job.externalTaskId,
  });
}

function classifyError(err: unknown): {
  code: string;
  message: string;
  retryable: boolean;
} {
  if (err instanceof ProviderHttpError) {
    return {
      code: err.code,
      message: err.message,
      retryable: err.retryable,
    };
  }
  const rawMessage = err instanceof Error ? err.message : String(err);
  return {
    code: "JobError",
    message: sanitizeErrorText(rawMessage),
    retryable: false,
  };
}

function parseRequest(requestJson: string): PreparedRequest {
  try {
    return JSON.parse(requestJson) as PreparedRequest;
  } catch {
    return {};
  }
}

/**
 * Background job runner managing concurrency caps, exponential backoff on
 * rate-limit/transient errors, task polling, resume across restarts, and local
 * asset persistence.
 */
export class JobRunner {
  private readonly deps: Required<RunnerDeps>;
  private readonly maxConcurrentOverride?: number;
  private readonly pollIntervalOverride?: number;
  private readonly nextEligibleAt = new Map<string, number>();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private tickPromise: Promise<void> | null = null;

  constructor(deps: RunnerDeps = {}, options: RunnerOptions = {}) {
    this.deps = {
      submit: deps.submit ?? defaultSubmit,
      poll: deps.poll ?? defaultPoll,
      download: deps.download ?? defaultDownload,
    };
    this.maxConcurrentOverride = options.maxConcurrent;
    this.pollIntervalOverride = options.pollIntervalMs;
  }

  private getMaxConcurrent(): number {
    return this.maxConcurrentOverride ?? getConfig().jobs.maxConcurrent;
  }

  private getPollIntervalMs(): number {
    return this.pollIntervalOverride ?? getConfig().jobs.pollIntervalMs;
  }

  /** Return the epoch-ms timestamp when a throttled job is next eligible to retry. */
  getNextEligibleAt(jobId: string): number | undefined {
    return this.nextEligibleAt.get(jobId);
  }

  /** Start the periodic polling interval (idempotent). */
  start(): void {
    if (this.intervalId !== null) {
      return;
    }
    this.intervalId = setInterval(() => {
      void this.tick();
    }, this.getPollIntervalMs());
    if (typeof this.intervalId.unref === "function") {
      this.intervalId.unref();
    }
  }

  /** Stop the periodic polling interval if active. */
  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Re-adopt non-terminal jobs after a server restart or dev hot-reload.
   * `PENDING` / `RUNNING` jobs stay pollable without resubmission; interrupted
   * `DOWNLOADING` jobs are recovered to `READY` (if already persisted) or
   * `RUNNING` / `QUEUED`.
   */
  resume(): void {
    this.reconcileJobs();
  }

  /**
   * Repair jobs left in an inconsistent state by a crash or by two runners
   * sharing the database. Idempotent, so it runs on every tick.
   */
  private reconcileJobs(): void {
    const db = getDb();
    const now = Date.now();

    // Release claims owned by a process that died mid-submit.
    db.update(jobs)
      .set({ claimedAt: null, updatedAt: now })
      .where(
        and(
          eq(jobs.status, "QUEUED"),
          isNotNull(jobs.claimedAt),
          lt(jobs.claimedAt, now - CLAIM_STALE_MS),
        ),
      )
      .run();

    const activeJobs = db
      .select()
      .from(jobs)
      .where(inArray(jobs.status, ["PENDING", "RUNNING", "DOWNLOADING"]))
      .all();

    for (const job of activeJobs) {
      if (job.resultAssetId) {
        // A duplicate submit can write DOWNLOADING after the asset was
        // persisted. The output exists, so the job is actually finished.
        db.update(jobs)
          .set({ status: "READY", claimedAt: null, updatedAt: now })
          .where(eq(jobs.id, job.id))
          .run();
        continue;
      }

      if (job.externalTaskId) {
        if (job.status === "DOWNLOADING") {
          db.update(jobs)
            .set({ status: "RUNNING", updatedAt: now })
            .where(eq(jobs.id, job.id))
            .run();
        }
        continue;
      }

      // No provider task was recorded, so this submission was interrupted.
      if (job.attempts >= MAX_JOB_ATTEMPTS) {
        db.update(jobs)
          .set({
            status: "FAILED",
            errorCode: "Interrupted",
            errorMessage: "Job was interrupted before receiving a task ID.",
            claimedAt: null,
            updatedAt: now,
          })
          .where(eq(jobs.id, job.id))
          .run();
      } else {
        db.update(jobs)
          .set({ status: "QUEUED", claimedAt: null, updatedAt: now })
          .where(eq(jobs.id, job.id))
          .run();
      }
    }
  }

  /** Run a single poll-and-submit cycle, coalescing overlapping calls. */
  tick(): Promise<void> {
    if (this.tickPromise) {
      return this.tickPromise;
    }
    this.tickPromise = this.runTick().finally(() => {
      this.tickPromise = null;
    });
    return this.tickPromise;
  }

  private async runTick(): Promise<void> {
    this.reconcileJobs();
    await this.pollActiveJobs();
    await this.submitQueuedJobs();
  }

  private async pollActiveJobs(): Promise<void> {
    const db = getDb();
    const activeJobs = db
      .select()
      .from(jobs)
      .where(inArray(jobs.status, ["PENDING", "RUNNING"]))
      .all();

    for (const job of activeJobs) {
      if (!job.externalTaskId) {
        continue;
      }

      if (job.resultAssetId) {
        db.update(jobs)
          .set({ status: "READY", claimedAt: null, updatedAt: Date.now() })
          .where(eq(jobs.id, job.id))
          .run();
        continue;
      }

      let statusResult: TaskStatusResult;
      try {
        statusResult = await this.deps.poll(job);
      } catch (err) {
        const classified = classifyError(err);
        if (!classified.retryable) {
          db.update(jobs)
            .set({
              status: "FAILED",
              errorCode: classified.code,
              errorMessage: classified.message,
              updatedAt: Date.now(),
            })
            .where(eq(jobs.id, job.id))
            .run();
        }
        continue;
      }

      const now = Date.now();
      if (statusResult.status === "PENDING" || statusResult.status === "RUNNING") {
        if (job.status !== statusResult.status) {
          db.update(jobs)
            .set({ status: statusResult.status, updatedAt: now })
            .where(eq(jobs.id, job.id))
            .run();
        }
        continue;
      }

      if (statusResult.status === "FAILED") {
        const mapped = mapProviderError(statusResult.errorCode, 400);
        const detail = statusResult.errorMessage
          ? ` (${sanitizeErrorText(statusResult.errorMessage)})`
          : "";
        db.update(jobs)
          .set({
            status: "FAILED",
            errorCode: statusResult.errorCode ?? mapped.code,
            errorMessage: `${mapped.userMessage}${detail}`,
            updatedAt: now,
          })
          .where(eq(jobs.id, job.id))
          .run();
        continue;
      }

      // SUCCEEDED
      const url = statusResult.resultUrls[0];
      if (!url) {
        const mapped = mapProviderError("InvalidResponse", 502);
        db.update(jobs)
          .set({
            status: "FAILED",
            errorCode: mapped.code,
            errorMessage: `${mapped.userMessage} (Task succeeded without output URLs)`,
            updatedAt: now,
          })
          .where(eq(jobs.id, job.id))
          .run();
        continue;
      }

      db.update(jobs)
        .set({ status: "DOWNLOADING", updatedAt: now })
        .where(eq(jobs.id, job.id))
        .run();

      try {
        await persistResult(job, { url }, { download: this.deps.download });
      } catch (err) {
        const classified = classifyError(err);
        db.update(jobs)
          .set({
            status: "FAILED",
            errorCode: classified.code,
            errorMessage: classified.message,
            updatedAt: Date.now(),
          })
          .where(eq(jobs.id, job.id))
          .run();
      }
    }
  }

  private async submitQueuedJobs(): Promise<void> {
    const db = getDb();
    const maxConcurrent = this.getMaxConcurrent();

    const activeRows = db
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        or(
          inArray(jobs.status, ["PENDING", "RUNNING", "DOWNLOADING"]),
          isNotNull(jobs.claimedAt),
        ),
      )
      .all();

    let availableSlots = maxConcurrent - activeRows.length;
    if (availableSlots <= 0) {
      return;
    }

    const queuedJobs = db
      .select()
      .from(jobs)
      .where(and(eq(jobs.status, "QUEUED"), isNull(jobs.claimedAt)))
      .orderBy(asc(jobs.createdAt))
      .all();

    const now = Date.now();
    for (const job of queuedJobs) {
      if (availableSlots <= 0) {
        break;
      }

      const eligibleAt = this.nextEligibleAt.get(job.id);
      if (eligibleAt !== undefined && now < eligibleAt) {
        continue;
      }

      // Atomic claim: only one process may move this job into submission.
      const claim = db
        .update(jobs)
        .set({ claimedAt: now, updatedAt: now })
        .where(
          and(
            eq(jobs.id, job.id),
            eq(jobs.status, "QUEUED"),
            isNull(jobs.claimedAt),
          ),
        )
        .run();
      if (claim.changes !== 1) {
        continue;
      }

      availableSlots -= 1;
      await this.submitSingleJob(job);
    }
  }

  private async submitSingleJob(job: Job): Promise<void> {
    const db = getDb();
    const request = parseRequest(job.requestJson);

    try {
      const result = await this.deps.submit(job, request);
      const nextAttempts = job.attempts + 1;
      const now = Date.now();
      this.nextEligibleAt.delete(job.id);

      if (result.kind === "async") {
        db.update(jobs)
          .set({
            status: "PENDING",
            externalTaskId: result.taskId,
            attempts: nextAttempts,
            errorCode: null,
            errorMessage: null,
            claimedAt: null,
            updatedAt: now,
          })
          .where(eq(jobs.id, job.id))
          .run();
        return;
      }

      db.update(jobs)
        .set({
          status: "DOWNLOADING",
          attempts: nextAttempts,
          errorCode: null,
          errorMessage: null,
          claimedAt: null,
          updatedAt: now,
        })
        .where(eq(jobs.id, job.id))
        .run();

      await persistResult(job, result.source, {
        download: this.deps.download,
      });
    } catch (err) {
      const now = Date.now();
      const nextAttempts = job.attempts + 1;
      const classified = classifyError(err);

      if (classified.retryable && nextAttempts < MAX_JOB_ATTEMPTS) {
        const delayMs = BASE_BACKOFF_MS * Math.pow(2, nextAttempts - 1);
        this.nextEligibleAt.set(job.id, now + delayMs);
        db.update(jobs)
          .set({
            status: "QUEUED",
            attempts: nextAttempts,
            errorCode: classified.code,
            errorMessage: classified.message,
            claimedAt: null,
            updatedAt: now,
          })
          .where(eq(jobs.id, job.id))
          .run();
        return;
      }

      this.nextEligibleAt.delete(job.id);
      db.update(jobs)
        .set({
          status: "FAILED",
          attempts: nextAttempts,
          errorCode: classified.code,
          errorMessage: classified.message,
          claimedAt: null,
          updatedAt: now,
        })
        .where(eq(jobs.id, job.id))
        .run();
    }
  }
}

const globalForRunner = globalThis as typeof globalThis & {
  __aivsRunner?: JobRunner;
};

/** Return the process-wide `JobRunner` singleton stored on `globalThis.__aivsRunner`. */
export function getRunner(
  deps?: RunnerDeps,
  options?: RunnerOptions,
): JobRunner {
  if (!globalForRunner.__aivsRunner) {
    globalForRunner.__aivsRunner = new JobRunner(deps, options);
  }
  return globalForRunner.__aivsRunner;
}

/** Stop and clear the `globalThis.__aivsRunner` singleton (intended for tests). */
export function resetRunnerForTests(): void {
  if (globalForRunner.__aivsRunner) {
    globalForRunner.__aivsRunner.stop();
    delete globalForRunner.__aivsRunner;
  }
}
