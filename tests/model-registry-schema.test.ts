import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeDbForTests,
  getDb,
  modelPreferences,
  modelSelections,
  usageEvents,
} from "@/db";

let tmp: string;
let prevDataDir: string | undefined;
let prevProjectsDir: string | undefined;

beforeEach(() => {
  prevDataDir = process.env.DATA_DIR;
  prevProjectsDir = process.env.PROJECTS_DIR;
  tmp = mkdtempSync(path.join(os.tmpdir(), "aivs-schema-"));
  process.env.DATA_DIR = path.join(tmp, "data");
  process.env.PROJECTS_DIR = path.join(tmp, "projects");
});

afterEach(() => {
  closeDbForTests();
  if (prevDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = prevDataDir;
  if (prevProjectsDir === undefined) delete process.env.PROJECTS_DIR;
  else process.env.PROJECTS_DIR = prevProjectsDir;
  rmSync(tmp, { recursive: true, force: true });
});

describe("model registry schema", () => {
  it("creates selection, preference, and usage tables", () => {
    const db = getDb();

    db.insert(modelSelections)
      .values({ slot: "video", mode: "auto", modelId: null })
      .run();
    expect(db.select().from(modelSelections).all()).toHaveLength(1);

    db.insert(modelPreferences)
      .values({ id: 1, autoPreset: "balanced" })
      .run();
    expect(db.select().from(modelPreferences).get()?.autoPreset).toBe("balanced");

    db.insert(usageEvents)
      .values({
        id: "usage-1",
        modality: "text",
        modelId: "qwen-plus",
        totalTokens: 12,
      })
      .run();
    expect(db.select().from(usageEvents).all()).toHaveLength(1);
  });
});