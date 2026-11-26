import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
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

function parseByteRange(
  rangeHeader: string,
  size: number,
): { start: number; end: number } | "unsatisfiable" | null {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return "unsatisfiable";
  if (size === 0) return "unsatisfiable";

  let start: number;
  let end: number;

  if (!rawStart) {
    const suffix = Number.parseInt(rawEnd, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return "unsatisfiable";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number.parseInt(rawStart, 10);
    end = rawEnd ? Number.parseInt(rawEnd, 10) : size - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return "unsatisfiable";
    }
    if (start >= size || start > end) return "unsatisfiable";
    end = Math.min(end, size - 1);
  }

  return { start, end };
}

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(req: Request, context: RouteContext) {
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

    const ext = path.extname(absPath).toLowerCase();
    const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
    const etag = `W/"${stat.size}-${Math.trunc(stat.mtimeMs)}"`;
    const lastModified = stat.mtime.toUTCString();

    const baseHeaders: Record<string, string> = {
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
      ETag: etag,
      "Last-Modified": lastModified,
      "Cache-Control": "private, no-cache",
    };

    const ifNoneMatch = req.headers.get("if-none-match");
    if (ifNoneMatch && ifNoneMatch.trim() === etag) {
      return new Response(null, { status: 304, headers: baseHeaders });
    }

    const rangeHeader = req.headers.get("range");
    if (rangeHeader) {
      const parsed = parseByteRange(rangeHeader, stat.size);
      if (parsed === "unsatisfiable") {
        return new Response(null, {
          status: 416,
          headers: {
            ...baseHeaders,
            "Content-Range": `bytes */${stat.size}`,
          },
        });
      }
      if (parsed) {
        const { start, end } = parsed;
        const chunkLength = end - start + 1;
        const stream = Readable.toWeb(
          createReadStream(absPath, { start, end }),
        ) as ReadableStream;
        return new Response(stream, {
          status: 206,
          headers: {
            ...baseHeaders,
            "Content-Range": `bytes ${start}-${end}/${stat.size}`,
            "Content-Length": String(chunkLength),
          },
        });
      }
    }

    if (stat.size === 0) {
      return new Response(new Uint8Array(0), {
        status: 200,
        headers: {
          ...baseHeaders,
          "Content-Length": "0",
        },
      });
    }

    const stream = Readable.toWeb(createReadStream(absPath)) as ReadableStream;
    return new Response(stream, {
      status: 200,
      headers: {
        ...baseHeaders,
        "Content-Length": String(stat.size),
      },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
