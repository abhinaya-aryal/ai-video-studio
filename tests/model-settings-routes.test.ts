import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDbForTests, getDb } from "@/db";
import { customModels, modelSelections } from "@/db/schema";
import { PUT as putSelections } from "@/app/api/settings/models/selections/route";
import { PUT as putPreferences } from "@/app/api/settings/models/preferences/route";
import { GET as getUsage } from "@/app/api/settings/usage/route";
import { GET as getModels } from "@/app/api/settings/models/route";

let tmpRoot: string;
let prevDataDir: string | undefined;
let prevProjectsDir: string | undefined;
let prevKey: string | undefined;

beforeEach(() => {
  prevDataDir = process.env.DATA_DIR;
  prevProjectsDir = process.env.PROJECTS_DIR;
  prevKey = process.env.QWEN_API_KEY;
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), "aivs-model-routes-"));
  process.env.DATA_DIR = path.join(tmpRoot, "data");
  process.env.PROJECTS_DIR = path.join(tmpRoot, "projects");
  delete process.env.QWEN_API_KEY;

  getDb()
    .insert(customModels)
    .values([
      {
        id: "m-video",
        modelId: "wan3.0-video",
        displayName: "wan3.0-video",
        modality: "video",
        family: "wan3",
        capabilitiesJson: "{}",
        source: "discovered",
        available: 1,
      },
      {
        id: "m-tts",
        modelId: "qwen-audio-3.0-tts-plus",
        displayName: "tts",
        modality: "audio",
        family: "qwen-tts",
        capabilitiesJson: "{}",
        source: "discovered",
        available: 1,
      },
      {
        id: "m-asr",
        modelId: "qwen-audio-3.0-asr-flash",
        displayName: "asr",
        modality: "audio",
        family: "qwen-tts",
        capabilitiesJson: '{"ttsCapable":false}',
        source: "discovered",
        available: 1,
      },
      {
        id: "m-gone",
        modelId: "wan2.7-t2v",
        displayName: "gone",
        modality: "video",
        family: "wan2.7",
        capabilitiesJson: "{}",
        source: "discovered",
        available: 0,
      },
    ])
    .run();
});

afterEach(() => {
  closeDbForTests();
  if (prevDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = prevDataDir;
  if (prevProjectsDir === undefined) delete process.env.PROJECTS_DIR;
  else process.env.PROJECTS_DIR = prevProjectsDir;
  if (prevKey === undefined) delete process.env.QWEN_API_KEY;
  else process.env.QWEN_API_KEY = prevKey;
  rmSync(tmpRoot, { recursive: true, force: true });
});

function put(body: unknown): Request {
  return new Request("http://test/api/settings/models/selections", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("model selection routes", () => {
  it("saves a manual selection and resolves it", async () => {
    const res = await putSelections(
      put({
        updates: [
          { slot: "video", mode: "manual", modelId: "wan3.0-video" },
        ],
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(
      json.resolved.find((row: { slot: string }) => row.slot === "video")
        .modelId,
    ).toBe("wan3.0-video");
  });

  it("rejects an unavailable manual model with 409", async () => {
    const res = await putSelections(
      put({
        updates: [{ slot: "video", mode: "manual", modelId: "wan2.7-t2v" }],
      }),
    );
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error.code).toBe("MODEL_UNAVAILABLE");
  });

  it("rejects an ASR model for the voiceover role", async () => {
    const res = await putSelections(
      put({
        updates: [
          {
            slot: "audio",
            mode: "manual",
            modelId: "qwen-audio-3.0-asr-flash",
          },
        ],
      }),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("MODEL_UNSUPPORTED");
  });

  it("returns MODEL_NOT_SELECTED from GET when nothing is chosen", async () => {
    const res = await getModels();
    const json = await res.json();
    const video = json.resolved.find(
      (row: { slot: string }) => row.slot === "video",
    );
    expect(video.modelId).toBeNull();
    expect(video.reason).toContain("No video model");
  });
});

describe("preferences route", () => {
  it("saves the Auto preset", async () => {
    const res = await putPreferences(
      new Request("http://test/api/settings/models/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoPreset: "economy" }),
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).autoPreset).toBe("economy");
  });

  it("rejects an unknown preset", async () => {
    const res = await putPreferences(
      new Request("http://test/api/settings/models/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoPreset: "cheapest" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("usage route", () => {
  it("returns zero totals without calling a provider", async () => {
    const res = await getUsage(
      new Request("http://test/api/settings/usage?range=7d"),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.totals.totalTokens).toBe(0);
    expect(json.byModality).toEqual([]);
  });

  it("aggregates by modality", async () => {
    const db = getDb();
    const now = Date.now();
    db.insert(modelSelections)
      .values({ slot: "video", mode: "manual", modelId: "wan3.0-video" })
      .run();
    const { usageEvents } = await import("@/db");
    db.insert(usageEvents)
      .values([
        {
          id: "u1",
          modality: "text",
          modelId: "qwen-plus",
          totalTokens: 100,
          createdAt: now,
        },
        {
          id: "u2",
          modality: "text",
          modelId: "qwen-plus",
          totalTokens: 50,
          createdAt: now,
        },
      ])
      .run();

    const res = await getUsage(
      new Request("http://test/api/settings/usage?range=today"),
    );
    const json = await res.json();
    expect(json.totals.totalTokens).toBe(150);
    expect(json.byModality[0]).toMatchObject({
      modality: "text",
      totalTokens: 150,
      events: 2,
    });
  });
});