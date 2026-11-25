import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import type { z } from "zod";
import {
  customModels,
  getDb,
  projects,
  referenceElements,
  scenes,
  type CustomModel,
  type Project,
  type ReferenceElement,
  type Scene,
} from "@/db";
import { getRunner } from "@/lib/jobs/runner";
import {
  ProviderHttpError,
  sanitizeErrorText,
} from "@/lib/providers/errors";
import { UnknownModelError, WanValidationError } from "@/lib/providers/types";
import { RefinerError } from "@/lib/refiner/story-refiner";
import { UnsafePathError } from "@/lib/storage/paths";

/** Structured HTTP error thrown by API route helpers and handlers. */
export class RouteError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "RouteError";
    this.code = code;
    this.status = status;
  }
}

export function apiOk<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function apiError(
  code: string,
  message: string,
  status = 400,
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Parse and validate a JSON request body against a Zod schema. */
export async function parseJsonBody<T>(
  req: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new RouteError("INVALID_JSON", "Request body must be valid JSON.", 400);
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) =>
        issue.path.length > 0
          ? `${issue.path.join(".")}: ${issue.message}`
          : issue.message,
      )
      .join("; ");
    throw new RouteError("VALIDATION_ERROR", detail || "Invalid request body.", 400);
  }

  return parsed.data;
}

/** Map domain and provider errors into standard `{ error: { code, message } }` JSON responses. */
export function handleRouteError(err: unknown): NextResponse {
  if (err instanceof RouteError) {
    return apiError(err.code, err.message, err.status);
  }
  if (err instanceof WanValidationError) {
    return apiError("WAN_VALIDATION", err.message, 400);
  }
  if (err instanceof UnknownModelError) {
    return apiError("UNKNOWN_MODEL", err.message, 400);
  }
  if (err instanceof UnsafePathError) {
    return apiError("UNSAFE_PATH", err.message, 400);
  }
  if (err instanceof RefinerError) {
    return apiError("REFINER_ERROR", err.message, 502);
  }
  if (err instanceof ProviderHttpError) {
    const status =
      err.httpStatus >= 400 && err.httpStatus < 600 ? err.httpStatus : 502;
    return apiError(err.code, err.userMessage, status);
  }

  const message =
    err instanceof Error ? sanitizeErrorText(err.message) : "Internal server error";
  return apiError("INTERNAL_ERROR", message, 500);
}

export function requireProject(projectId: string): Project {
  const row = getDb()
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  if (!row) {
    throw new RouteError("NOT_FOUND", `Project "${projectId}" not found.`, 404);
  }
  return row;
}

export function requireScene(projectId: string, sceneId: string): Scene {
  const row = getDb()
    .select()
    .from(scenes)
    .where(and(eq(scenes.id, sceneId), eq(scenes.projectId, projectId)))
    .get();
  if (!row) {
    throw new RouteError("NOT_FOUND", `Scene "${sceneId}" not found.`, 404);
  }
  return row;
}

export function requireElement(
  projectId: string,
  elementId: string,
): ReferenceElement {
  const row = getDb()
    .select()
    .from(referenceElements)
    .where(
      and(
        eq(referenceElements.id, elementId),
        eq(referenceElements.projectId, projectId),
      ),
    )
    .get();
  if (!row) {
    throw new RouteError("NOT_FOUND", `Element "${elementId}" not found.`, 404);
  }
  return row;
}

export function getCustomModelRows(): CustomModel[] {
  return getDb().select().from(customModels).all();
}

export {
  aspectRatioToImageSize,
  prepareProjectImagePath,
} from "@/lib/studio/scene-request";

export function kickRunner(): void {
  void getRunner().tick();
}
