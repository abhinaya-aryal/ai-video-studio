import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { ELEMENT_KINDS, getDb, referenceElements } from "@/db";
import {
  RouteError,
  apiOk,
  handleRouteError,
  parseJsonBody,
  requireElement,
  requireProject,
} from "@/lib/api/route-helpers";

const CreateElementSchema = z.object({
  kind: z.enum(ELEMENT_KINDS),
  name: z.string().trim().min(1),
  description: z.string().default(""),
  activeImagePath: z.string().nullable().optional(),
});

const UpdateElementSchema = z.object({
  id: z.string().trim().min(1),
  kind: z.enum(ELEMENT_KINDS).optional(),
  name: z.string().trim().min(1).optional(),
  description: z.string().optional(),
  activeImagePath: z.string().nullable().optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    requireProject(id);
    const rows = getDb()
      .select()
      .from(referenceElements)
      .where(eq(referenceElements.projectId, id))
      .orderBy(asc(referenceElements.createdAt))
      .all();
    return apiOk({ elements: rows });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    requireProject(id);
    const input = await parseJsonBody(req, CreateElementSchema);
    const now = Date.now();
    const element = {
      id: randomUUID(),
      projectId: id,
      kind: input.kind,
      name: input.name,
      description: input.description,
      activeImagePath: input.activeImagePath ?? null,
      createdAt: now,
      updatedAt: now,
    };
    getDb().insert(referenceElements).values(element).run();
    return apiOk({ element }, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    requireProject(id);
    const input = await parseJsonBody(req, UpdateElementSchema);
    requireElement(id, input.id);

    const { id: elementId, ...patch } = input;
    getDb()
      .update(referenceElements)
      .set({
        ...patch,
        updatedAt: Date.now(),
      })
      .where(
        and(
          eq(referenceElements.id, elementId),
          eq(referenceElements.projectId, id),
        ),
      )
      .run();

    const element = requireElement(id, elementId);
    return apiOk({ element });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function DELETE(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    requireProject(id);

    const url = new URL(req.url);
    let elementId = url.searchParams.get("elementId")?.trim();
    if (!elementId) {
      try {
        const body = (await req.json()) as { id?: string };
        elementId = body.id?.trim();
      } catch {
        // Ignore empty body
      }
    }

    if (!elementId) {
      throw new RouteError(
        "VALIDATION_ERROR",
        "Provide elementId to delete.",
        400,
      );
    }

    requireElement(id, elementId);
    getDb()
      .delete(referenceElements)
      .where(
        and(
          eq(referenceElements.id, elementId),
          eq(referenceElements.projectId, id),
        ),
      )
      .run();

    return apiOk({ deleted: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
