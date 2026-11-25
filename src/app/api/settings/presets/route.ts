import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, stylePresets } from "@/db";
import {
  RouteError,
  apiOk,
  handleRouteError,
  parseJsonBody,
} from "@/lib/api/route-helpers";

const CreatePresetSchema = z.object({
  name: z.string().trim().min(1),
  styleBible: z.string().trim().min(1),
});

export async function GET() {
  try {
    const presets = getDb()
      .select()
      .from(stylePresets)
      .orderBy(asc(stylePresets.name))
      .all();
    return apiOk({ presets });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST(req: Request) {
  try {
    const input = await parseJsonBody(req, CreatePresetSchema);
    const db = getDb();
    const existing = db
      .select()
      .from(stylePresets)
      .where(eq(stylePresets.name, input.name))
      .get();

    if (existing) {
      throw new RouteError(
        "DUPLICATE_PRESET",
        `Style preset "${input.name}" already exists.`,
        409,
      );
    }

    const preset = {
      id: randomUUID(),
      name: input.name,
      styleBible: input.styleBible,
      isBuiltin: 0,
    };
    db.insert(stylePresets).values(preset).run();
    return apiOk({ preset }, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    let id = url.searchParams.get("id")?.trim();
    if (!id) {
      try {
        const body = (await req.json()) as { id?: string };
        id = body.id?.trim();
      } catch {
        // Ignore empty body
      }
    }

    if (!id) {
      throw new RouteError(
        "VALIDATION_ERROR",
        "Provide preset id to delete.",
        400,
      );
    }

    const db = getDb();
    const existing = db
      .select()
      .from(stylePresets)
      .where(eq(stylePresets.id, id))
      .get();

    if (!existing) {
      throw new RouteError("NOT_FOUND", `Preset "${id}" not found.`, 404);
    }
    if (existing.isBuiltin === 1) {
      throw new RouteError(
        "BUILTIN_PRESET",
        "Built-in style presets cannot be deleted.",
        400,
      );
    }

    db.delete(stylePresets).where(eq(stylePresets.id, id)).run();
    return apiOk({ deleted: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
