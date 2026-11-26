import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { getConfig, maskApiKey } from "@/lib/config";

const ENV_KEYS = [
  "DATA_DIR",
  "PROJECTS_DIR",
  "QWEN_API_KEY",
  "QWEN_KEY_TYPE",
  "QWEN_REGION",
  "QWEN_WORKSPACE_ID",
  "QWEN_BASE_URL",
  "QWEN_TEXT_MODEL",
  "QWEN_IMAGE_MODEL",
  "QWEN_VIDEO_MODEL",
  "QWEN_TTS_MODEL",
  "TEXT_PROVIDER",
  "OPENAI_COMPAT_BASE_URL",
  "OPENAI_COMPAT_API_KEY",
  "OPENAI_COMPAT_MODEL",
  "MAX_CONCURRENT_JOBS",
  "JOB_POLL_INTERVAL_MS",
] as const;

describe("config and maskApiKey", () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  });

  it("auto-detects token_plan keyType for sk-sp- keys", () => {
    process.env.QWEN_API_KEY = "sk-sp-1234567890abcdef";
    const config = getConfig();
    expect(config.qwen.keyType).toBe("token_plan");
  });

  it("auto-detects standard keyType for non-token-plan keys", () => {
    process.env.QWEN_API_KEY = "sk-abc";
    const config = getConfig();
    expect(config.qwen.keyType).toBe("standard");
  });

  it("throws a zod error naming QWEN_REGION when region is invalid", () => {
    process.env.QWEN_REGION = "mars";

    let caught: unknown;
    try {
      getConfig();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ZodError);
    expect((caught as Error).message).toContain("QWEN_REGION");
  });

  it("resolves default paths, concurrency, and video model", () => {
    const config = getConfig();

    expect(config.dataDir).toBe(path.resolve(process.cwd(), "data"));
    expect(config.projectsDir).toBe(path.join(os.homedir(), "projects"));
    expect(config.jobs.maxConcurrent).toBe(3);
    expect(config.jobs.pollIntervalMs).toBe(10000);
    expect(config.qwen.region).toBe("ap-southeast-1");
    expect(config.textProvider).toBe("qwen");
  });

  it("treats empty string env vars as unset defaults", () => {
    process.env.DATA_DIR = "";
    process.env.PROJECTS_DIR = "";
    process.env.QWEN_API_KEY = "";
    process.env.QWEN_REGION = "";
    process.env.QWEN_VIDEO_MODEL = "";
    process.env.MAX_CONCURRENT_JOBS = "";

    const config = getConfig();
    expect(config.dataDir).toBe(path.resolve(process.cwd(), "data"));
    expect(config.projectsDir).toBe(path.join(os.homedir(), "projects"));
    expect(config.qwen.apiKey).toBeUndefined();
    expect(config.qwen.region).toBe("ap-southeast-1");
    expect(config.jobs.maxConcurrent).toBe(3);
  });

  it("expands a leading tilde in path settings", () => {
    process.env.DATA_DIR = "~/studio-data";
    process.env.PROJECTS_DIR = "~/media/video";

    const config = getConfig();
    expect(config.dataDir).toBe(path.join(os.homedir(), "studio-data"));
    expect(config.projectsDir).toBe(path.join(os.homedir(), "media", "video"));
  });

  it("reads openaiCompat configuration when TEXT_PROVIDER=openai_compat", () => {
    process.env.TEXT_PROVIDER = "openai_compat";
    process.env.OPENAI_COMPAT_BASE_URL = "http://localhost:11434/v1";
    process.env.OPENAI_COMPAT_API_KEY = "local-key";
    process.env.OPENAI_COMPAT_MODEL = "qwen2.5:14b";

    const config = getConfig();
    expect(config.textProvider).toBe("openai_compat");
    expect(config.openaiCompat).toEqual({
      baseUrl: "http://localhost:11434/v1",
      apiKey: "local-key",
      model: "qwen2.5:14b",
    });
  });

  it("masks API keys preserving sk-sp- prefix and last 4 characters", () => {
    expect(maskApiKey("sk-sp-1234567890abcdef")).toBe("sk-sp-****cdef");
    expect(maskApiKey("sk-1234567890abcdef")).toBe("sk-****cdef");
    expect(maskApiKey("short")).toBe("****");
    expect(maskApiKey("")).toBe("");
  });
});
