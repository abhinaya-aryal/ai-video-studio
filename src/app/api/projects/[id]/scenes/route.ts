import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { AUDIO_MODES, VIDEO_MODES, getDb, scenes } from "@/db";
import {
  RouteError,
  apiOk,
  handleRouteError,
  parseJsonBody,
  requireProject,
  requireScene,
} from "@/lib/api/route-helpers";
import { slugify } from "@/lib/storage/paths";

const CreateSceneSchema = z.object({
  title: z.string().trim().min(1),
  visualPrompt: z.string().default(""),
  cameraDirection: z.string().default(""),
  audioMode: z.enum(AUDIO_MODES).default("ambient_only"),
  audioScript: z.string().default(""),
  duration: z.number().int().min(2).max(30).default(5),
  videoMode: z.enum(VIDEO_MODES).default("omni_reference"),
  linkedElementIds: z.array(z.string()).default([]),
  orderIndex: z.number().int().min(0).optional(),
});

const PatchSceneSchema = z.union([
  z.object({
    reorder: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    id: z.string().trim().min(1),
    title: z.string().trim().min(1).optional(),
    visualPrompt: z.string().optional(),
    cameraDirection: z.string().optional(),
    audioMode: z.enum(AUDIO_MODES).optional(),
    audioScript: z.string().optional(),
    duration: z.number().int().min(2).max(30).optional(),
    videoMode: z.enum(VIDEO_MODES).optional(),
    linkedElementIds: z.array(z.string()).optional(),
    orderIndex: z.number().int().min(0).optional(),
    activeKeyframeFirstAssetId: z.string().nullable().optional(),
    activeKeyframeLastAssetId: z.string().nullable().optional(),
    activeVideoAssetId: z.string().nullable().optional(),
    activeAudioAssetId: z.string().nullable().optional(),
  }),
]);

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    requireProject(id);
    const rows = getDb()
      .select()
      .from(scenes)
      .where(eq(scenes.projectId, id))
      .orderBy(asc(scenes.orderIndex))
      .all();
    return apiOk({ scenes: rows });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    requireProject(id);
    const input = await parseJsonBody(req, CreateSceneSchema);
    const db = getDb();

    const existing = db
      .select({ orderIndex: scenes.orderIndex })
      .from(scenes)
      .where(eq(scenes.projectId, id))
      .all();
    const nextOrder =
      input.orderIndex ??
      existing.reduce((max, s) => Math.max(max, s.orderIndex), -1) + 1;

    const now = Date.now();
    const nn = String(nextOrder + 1).padStart(2, "0");
    const scene = {
      id: randomUUID(),
      projectId: id,
      orderIndex: nextOrder,
      slug: `${nn}-${slugify(input.title)}`,
      title: input.title,
      visualPrompt: input.visualPrompt,
      cameraDirection: input.cameraDirection,
      audioMode: input.audioMode,
      audioScript: input.audioScript,
      duration: input.duration,
      videoMode: input.videoMode,
      linkedElementIdsJson: JSON.stringify(input.linkedElementIds),
      activeKeyframeFirstAssetId: null,
      activeKeyframeLastAssetId: null,
      activeVideoAssetId: null,
      activeAudioAssetId: null,
      createdAt: now,
      updatedAt: now,
    };

    db.insert(scenes).values(scene).run();
    return apiOk({ scene }, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    requireProject(id);
    const input = await parseJsonBody(req, PatchSceneSchema);
    const db = getDb();
    const now = Date.now();

    if ("reorder" in input) {
      db.transaction((tx) => {
        input.reorder.forEach((sceneId, index) => {
          tx.update(scenes)
            .set({ orderIndex: index, updatedAt: now })
            .where(and(eq(scenes.id, sceneId), eq(scenes.projectId, id)))
            .run();
        });
      });
      const updatedScenes = db
        .select()
        .from(scenes)
        .where(eq(scenes.projectId, id))
        .orderBy(asc(scenes.orderIndex))
        .all();
      return apiOk({ scenes: updatedScenes });
    }

    const { id: sceneId, linkedElementIds, ...rest } = input;
    requireScene(id, sceneId);

    db.update(scenes)
      .set({
        ...rest,
        ...(linkedElementIds !== undefined
          ? { linkedElementIdsJson: JSON.stringify(linkedElementIds) }
          : {}),
        updatedAt: now,
      })
      .where(and(eq(scenes.id, sceneId), eq(scenes.projectId, id)))
      .run();

    const scene = requireScene(id, sceneId);
    return apiOk({ scene });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function DELETE(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    requireProject(id);

    const url = new URL(req.url);
    let sceneId = url.searchParams.get("sceneId")?.trim();
    if (!sceneId) {
      try {
        const body = (await req.json()) as { id?: string };
        sceneId = body.id?.trim();
      } catch {
        // Ignore empty body
      }
    }

    if (!sceneId) {
      throw new RouteError(
        "VALIDATION_ERROR",
        "Provide sceneId to delete.",
        400,
      );
    }

    requireScene(id, sceneId);
    getDb()
      .delete(scenes)
      .where(and(eq(scenes.id, sceneId), eq(scenes.projectId, id)))
      .run();

    return apiOk({ deleted: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
