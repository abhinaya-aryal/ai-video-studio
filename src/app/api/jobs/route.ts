import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { JOB_STATUSES, getDb, jobs, type JobStatus } from "@/db";
import {
  PUBLIC_JOB_COLUMNS,
  RouteError,
  apiOk,
  handleRouteError,
  kickRunner,
  parseJsonBody,
} from "@/lib/api/route-helpers";
import { getRunner } from "@/lib/jobs/runner";

const JobActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("tick") }),
  z.object({
    action: z.literal("retry"),
    jobId: z.string().trim().min(1),
  }),
]);

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const projectId = url.searchParams.get("projectId")?.trim();
    const statusParam = url.searchParams.get("status")?.trim();

    const conditions = [];
    if (projectId) {
      conditions.push(eq(jobs.projectId, projectId));
    }
    if (statusParam) {
      const requested = statusParam
        .split(",")
        .map((s) => s.trim())
        .filter((s): s is JobStatus =>
          (JOB_STATUSES as readonly string[]).includes(s),
        );
      if (requested.length > 0) {
        conditions.push(inArray(jobs.status, requested));
      }
    }

    const db = getDb();
    const rows =
      conditions.length > 0
        ? db
            .select(PUBLIC_JOB_COLUMNS)
            .from(jobs)
            .where(and(...conditions))
            .orderBy(desc(jobs.createdAt))
            .all()
        : db
            .select(PUBLIC_JOB_COLUMNS)
            .from(jobs)
            .orderBy(desc(jobs.createdAt))
            .all();

    return apiOk({ jobs: rows });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST(req: Request) {
  try {
    const input = await parseJsonBody(req, JobActionSchema);
    if (input.action === "tick") {
      await getRunner().tick();
      return apiOk({ ok: true });
    }

    const db = getDb();
    const existing = db
      .select()
      .from(jobs)
      .where(eq(jobs.id, input.jobId))
      .get();
    if (!existing) {
      throw new RouteError("NOT_FOUND", `Job "${input.jobId}" not found.`, 404);
    }

    db.update(jobs)
      .set({
        status: "QUEUED",
        attempts: 0,
        externalTaskId: null,
        resultAssetId: null,
        claimedAt: null,
        errorCode: null,
        errorMessage: null,
        updatedAt: Date.now(),
      })
      .where(eq(jobs.id, input.jobId))
      .run();

    const updated = db
      .select(PUBLIC_JOB_COLUMNS)
      .from(jobs)
      .where(eq(jobs.id, input.jobId))
      .get();

    kickRunner();
    return apiOk({ job: updated });
  } catch (err) {
    return handleRouteError(err);
  }
}
