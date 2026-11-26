import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDbForTests, getDb } from "@/db";
import { customModels, modelSelections } from "@/db/schema";
import {
  ModelSelectionError,
  costTier,
  pickAutoModel,
  resolveSlotModel,
  setAutoPreset,
} from "@/lib/providers/model-selection";
import type { CustomModel } from "@/db/schema";

let tmpRoot: string;
let prevDataDir: string | undefined;
let prevProjectsDir: string | undefined;

beforeEach(() => {
  prevDataDir = process.env.DATA_DIR;
  prevProjectsDir = process.env.PROJECTS_DIR;
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), "aivs-selection-"));
  process.env.DATA_DIR = path.join(tmpRoot, "data");
  process.env.PROJECTS_DIR = path.join(tmpRoot, "projects");
});

afterEach(() => {
  closeDbForTests();
  if (prevDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = prevDataDir;
  if (prevProjectsDir === undefined) delete process.env.PROJECTS_DIR;
  else process.env.PROJECTS_DIR = prevProjectsDir;
  rmSync(tmpRoot, { recursive: true, force: true });
});

function seedModel(
  modelId: string,
  modality: CustomModel["modality"],
  createdAt: number,
  overrides: Partial<CustomModel> = {},
): CustomModel {
  const row: CustomModel = {
    id: `row-${modelId}`,
    modelId,
    displayName: modelId,
    modality,
    family: modality === "video" ? "wan3" : modality === "image" ? "qwen-image" : modality === "audio" ? "qwen-tts" : "text",
    capabilitiesJson: "{}",
    source: "discovered",
    providerCreatedAt: createdAt,
    lastSeenAt: createdAt,
    available: 1,
    ignored: 0,
    capabilitiesEdited: 0,
    ...overrides,
  };
  getDb().insert(customModels).values(row).run();
  return row;
}

describe("cost tiers", () => {
  it("classifies ids", () => {
    expect(costTier("qwen4-max")).toBe("high");
    expect(costTier("qwen3.6-flash")).toBe("low");
    expect(costTier("qwen-plus")).toBe("mid");
    expect(costTier("wan2.7-image-pro")).toBe("mid");
  });
});

describe("auto pick", () => {
  it("quality picks the high tier and balanced polish picks a cheap model", () => {
    const rows = [
      seedModel("qwen4-max", "text", 4),
      seedModel("glm-5.3", "text", 5),
      seedModel("qwen3.6-flash", "text", 6),
      seedModel("auto", "text", 9),
    ];
    expect(pickAutoModel(rows, "text_refine", "quality")).toBe("qwen4-max");
    expect(pickAutoModel(rows, "text_refine", "balanced")).toBe("glm-5.3");
    expect(pickAutoModel(rows, "text_polish", "balanced")).toBe("qwen3.6-flash");
    expect(pickAutoModel(rows, "text_polish", "economy")).toBe("qwen3.6-flash");
  });

  it("prefers the newest model within a tier", () => {
    const rows = [
      seedModel("qwen3.7-max", "text", 1),
      seedModel("qwen4-max", "text", 2),
    ];
    expect(pickAutoModel(rows, "text_refine", "quality")).toBe("qwen4-max");
  });

  it("throws when nothing fits", () => {
    expect(() => pickAutoModel([], "video", "balanced")).toThrow(
      ModelSelectionError,
    );
  });
});

describe("slot resolution", () => {
  it("fails with MODEL_NOT_SELECTED when no selection exists", () => {
    seedModel("wan3.0-video", "video", 1);
    expect(() => resolveSlotModel(getDb(), "video")).toThrowError(
      /No video model is selected/,
    );
  });

  it("resolves a manual selection", () => {
    seedModel("wan3.0-video", "video", 1);
    getDb()
      .insert(modelSelections)
      .values({ slot: "video", mode: "manual", modelId: "wan3.0-video" })
      .run();
    expect(resolveSlotModel(getDb(), "video")).toMatchObject({
      modelId: "wan3.0-video",
      source: "manual",
    });
  });

  it("rejects an unavailable manual selection", () => {
    seedModel("wan3.0-video", "video", 1, { available: 0 });
    getDb()
      .insert(modelSelections)
      .values({ slot: "video", mode: "manual", modelId: "wan3.0-video" })
      .run();
    expect(() => resolveSlotModel(getDb(), "video")).toThrowError(
      /not available to this token/,
    );
  });

  it("resolves auto with the saved preset", () => {
    seedModel("wan3.0-video", "video", 1);
    seedModel("cheap-video-model", "video", 2);
    getDb()
      .insert(modelSelections)
      .values({ slot: "video", mode: "auto", modelId: null })
      .run();
    setAutoPreset(getDb(), "quality");
    expect(resolveSlotModel(getDb(), "video").modelId).toBe("wan3.0-video");
    setAutoPreset(getDb(), "economy");
    expect(resolveSlotModel(getDb(), "video").modelId).toBe("cheap-video-model");
  });

  it("uses a project override for video", () => {
    seedModel("wan3.0-video", "video", 1);
    seedModel("other-video", "video", 2);
    expect(
      resolveSlotModel(getDb(), "video", { projectModelId: "other-video" }),
    ).toMatchObject({ modelId: "other-video", reason: "Project override" });
  });
});