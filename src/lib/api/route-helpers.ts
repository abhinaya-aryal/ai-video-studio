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
import { getConfig } from "@/lib/config";
import { getRunner } from "@/lib/jobs/runner";
import {
  ProviderHttpError,
  mapProviderError,
  sanitizeErrorText,
} from "@/lib/providers/errors";
import { resolveQwenBaseUrl } from "@/lib/providers/qwen-endpoints";
import { prepareImageMedia } from "@/lib/providers/qwen-oss";
import { UnknownModelError, WanValidationError } from "@/lib/providers/types";
import { RefinerError } from "@/lib/refiner/story-refiner";
import { UnsafePathError, resolveInsideProjects } from "@/lib/storage/paths";

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

const IMAGE_SIZE_BY_RATIO: Record<string, string> = {
  "16:9": "1280*720",
  "9:16": "720*1280",
  "1:1": "1024*1024",
};

export function aspectRatioToImageSize(aspectRatio: string): string {
  return IMAGE_SIZE_BY_RATIO[aspectRatio.trim()] ?? "1280*720";
}

/**
 * Prepare an image path (project-relative or already a URL/data/oss URI) for a
 * Qwen/Wan API request using Base64 or temporary DashScope OSS upload.
 */
export async function prepareProjectImagePath(
  relOrUrl: string,
  modelId: string,
  imageCountInRequest: number,
): Promise<string> {
  const trimmed = relOrUrl.trim();
  if (
    trimmed.startsWith("oss://") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("data:")
  ) {
    return trimmed;
  }

  const cfg = getConfig();
  const apiKey = cfg.qwen.apiKey?.trim();
  if (!apiKey) {
    throw new ProviderHttpError(
      mapProviderError("InvalidApiKey", 401),
      401,
      "QWEN_API_KEY is missing in .env.local",
    );
  }

  const absPath = resolveInsideProjects(trimmed);
  return prepareImageMedia({
    baseUrl: resolveQwenBaseUrl(cfg.qwen),
    apiKey,
    model: modelId,
    filePath: absPath,
    imageCountInRequest,
  });
}

export function kickRunner(): void {
  void getRunner().tick();
}
