import fs from "node:fs/promises";
import path from "node:path";
import {
  RouteError,
  handleRouteError,
} from "@/lib/api/route-helpers";
import { UnsafePathError, resolveInsideProjects } from "@/lib/storage/paths";

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".kdenlive": "application/xml; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

function sanitizeSegments(rawSegments: string[]): string {
  if (!Array.isArray(rawSegments) || rawSegments.length === 0) {
    throw new UnsafePathError("File path must not be empty.");
  }

  const decodedSegments: string[] = [];
  for (const raw of rawSegments) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      throw new UnsafePathError(`Malformed path segment: "${raw}"`);
    }

    if (
      !decoded ||
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("..") ||
      decoded.includes("/") ||
      decoded.includes("\\") ||
      decoded.includes("\0")
    ) {
      throw new UnsafePathError(`Unsafe path segment: "${raw}"`);
    }

    decodedSegments.push(decoded);
  }

  return decodedSegments.join("/");
}

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(_req: Request, context: RouteContext) {
  try {
    const { path: rawSegments } = await context.params;
    const relPath = sanitizeSegments(rawSegments);
    const absPath = resolveInsideProjects(relPath);

    let stat;
    try {
      stat = await fs.stat(absPath);
    } catch {
      throw new RouteError("NOT_FOUND", "File not found.", 404);
    }

    if (!stat.isFile()) {
      throw new RouteError("NOT_FOUND", "File not found.", 404);
    }

    const bytes = await fs.readFile(absPath);
    const ext = path.extname(absPath).toLowerCase();
    const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";

    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
