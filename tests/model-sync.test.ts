import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDbForTests, getDb } from "@/db";
import { customModels } from "@/db/schema";
import { syncProviderModels } from "@/lib/providers/model-sync";

let tmpRoot: string;
const originalEnv = { ...process.env };

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), "aivs-sync-"));
  process.env.DATA_DIR = path.join(tmpRoot, "data");
  process.env.PROJECTS_DIR = path.join(tmpRoot, "projects");
  process.env.QWEN_API_KEY = "sk-sp-test-key";
  process.env.QWEN_KEY_TYPE = "token_plan";
  process.env.QWEN_REGION = "ap-southeast-1";
});

afterEach(() => {
  closeDbForTests();
  process.env = { ...originalEnv };
  rmSync(tmpRoot, { recursive: true, force: true });
});

function modelsResponse(ids: string[]): Response {
  return new Response(
    JSON.stringify({
      data: ids.map((id, index) => ({ id, created: index + 1 })),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("syncProviderModels", () => {
  it("adds discovered models", async () => {
    const fetchFn = vi.fn(async () =>
      modelsResponse(["wan3.0-video", "qwen3.8-max"]),
    );
    const result = await syncProviderModels({ fetchFn });

    expect(result.added).toBe(2);
    expect(result.total).toBe(2);
    expect(fetchFn).toHaveBeenCalledOnce();
    const rows = getDb().select().from(customModels).all();
    expect(rows.map((row) => row.modelId).sort()).toEqual([
      "qwen3.8-max",
      "wan3.0-video",
    ]);
    expect(rows.every((row) => row.source === "discovered")).toBe(true);
  });

  it("marks missing discovered models unavailable without deleting them", async () => {
    await syncProviderModels({
      fetchFn: async () => modelsResponse(["wan3.0-video", "qwen3.8-max"]),
    });
    const result = await syncProviderModels({
      fetchFn: async () => modelsResponse(["wan3.0-video"]),
    });

    expect(result.unavailable).toBe(1);
    const rows = getDb().select().from(customModels).all();
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.modelId === "qwen3.8-max")?.available).toBe(0);
    expect(rows.find((row) => row.modelId === "wan3.0-video")?.available).toBe(1);
  });

  it("preserves capabilities edited by the user", async () => {
    await syncProviderModels({
      fetchFn: async () => modelsResponse(["wan3.0-video"]),
    });
    const db = getDb();
    db.update(customModels)
      .set({ capabilitiesJson: '{"maxCounts":{"reference_image":3}}', capabilitiesEdited: 1 })
      .run();

    await syncProviderModels({
      fetchFn: async () => modelsResponse(["wan3.0-video"]),
    });

    const row = db.select().from(customModels).get();
    expect(row?.capabilitiesJson).toContain('"reference_image":3');
  });
});