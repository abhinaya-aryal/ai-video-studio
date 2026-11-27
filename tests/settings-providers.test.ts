import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDbForTests, getDb } from "@/db";
import { getConfig } from "@/lib/config";
import {
  classifyGeminiModel,
  isGeminiTextModel,
  pcm16ToWav,
  sizeToGeminiAspectRatio,
} from "@/lib/providers/gemini-client";
import { resolveMediaTarget } from "@/lib/providers/media";
import { getTextChat, resolveTextTarget } from "@/lib/providers/text";
import { polishPrompt } from "@/lib/refiner/story-refiner";
import {
  createProvider,
  credentialsFilePath,
  deleteProvider,
  readCredentialsFile,
  settingsFilePath,
  updateAppAndRoleSettings,
  updateProvider,
} from "@/lib/settings/store";
import {
  GET as getProvidersRoute,
  POST as postProvidersRoute,
} from "@/app/api/settings/providers/route";
import {
  DELETE as deleteProviderRoute,
  PATCH as patchProviderRoute,
} from "@/app/api/settings/providers/[id]/route";
import { PUT as putAppSettingsRoute } from "@/app/api/settings/app/route";

describe("UI multi-provider settings & provider-independent text routing", () => {
  let tmpDir: string;
  const origEnv: Record<string, string | undefined> = {};
  const envKeys = [
    "DATA_DIR",
    "PROJECTS_DIR",
    "QWEN_API_KEY",
    "QWEN_KEY_TYPE",
    "QWEN_REGION",
    "TEXT_PROVIDER",
    "OPENAI_COMPAT_BASE_URL",
    "OPENAI_COMPAT_API_KEY",
    "OPENAI_COMPAT_MODEL",
    "MAX_CONCURRENT_JOBS",
    "JOB_POLL_INTERVAL_MS",
  ];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-video-settings-"));
    for (const k of envKeys) {
      origEnv[k] = process.env[k];
      delete process.env[k];
    }
    process.env.DATA_DIR = tmpDir;
    closeDbForTests();
  });

  afterEach(() => {
    closeDbForTests();
    for (const k of envKeys) {
      if (origEnv[k] === undefined) delete process.env[k];
      else process.env[k] = origEnv[k];
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("stores provider keys in credentials.json (0600), never in settings.json, and layers into getConfig()", () => {
    const qwen = createProvider(tmpDir, {
      name: "QwenCloud",
      kind: "qwen",
      preset: "qwen",
      region: "cn-beijing",
      apiKey: "sk-sp-secret-qwen-key-9999",
    });

    updateAppAndRoleSettings(tmpDir, {
      app: {
        projectsDir: path.join(tmpDir, "my-projects"),
        maxConcurrentJobs: 5,
        jobPollIntervalMs: 4000,
      },
    });

    const settingsRaw = fs.readFileSync(settingsFilePath(tmpDir), "utf8");
    expect(settingsRaw).not.toContain("sk-sp-secret-qwen-key-9999");

    const credsStat = fs.statSync(credentialsFilePath(tmpDir));
    expect(credsStat.mode & 0o777).toBe(0o600);

    const cfg = getConfig();
    expect(cfg.qwen.apiKey).toBe("sk-sp-secret-qwen-key-9999");
    expect(cfg.qwen.keyType).toBe("token_plan");
    expect(cfg.qwen.region).toBe("cn-beijing");
    expect(cfg.projectsDir).toBe(path.join(tmpDir, "my-projects"));
    expect(cfg.jobs.maxConcurrent).toBe(5);
    expect(cfg.jobs.pollIntervalMs).toBe(4000);

    updateProvider(tmpDir, qwen.id, { region: "ap-southeast-1" });
    expect(getConfig().qwen.region).toBe("ap-southeast-1");
    expect(getConfig().qwen.apiKey).toBe("sk-sp-secret-qwen-key-9999");

    deleteProvider(tmpDir, qwen.id);
    expect(readCredentialsFile(tmpDir)[qwen.id]).toBeUndefined();
    expect(getConfig().qwen.apiKey).toBeUndefined();
  });

  it("routes native Google Gemini via @google/genai and filters non-text Gemini models", () => {
    const gemini = createProvider(tmpDir, {
      name: "Google Gemini",
      kind: "gemini",
      preset: "gemini",
      apiKey: "AQ.Ab8RN6FakeGeminiKey1234567890",
    });

    updateAppAndRoleSettings(tmpDir, {
      roleProviders: {
        text_refine: { providerId: gemini.id, modelId: "gemini-4-hydrogen" },
        text_polish: { providerId: gemini.id, modelId: "gemini-4-hydrogen" },
      },
    });

    const cfg = getConfig();
    const target = resolveTextTarget(cfg, getDb(), "text_polish");
    expect(target.kind).toBe("gemini");
    expect(target.modelId).toBe("gemini-4-hydrogen");
    expect(target.baseUrl).toBeUndefined();

    // Once settings.json exists, env QWEN_API_KEY must not leak into UI-managed providers.
    process.env.QWEN_API_KEY = "sk-sp-leaked-env-key";
    expect(getConfig().qwen.apiKey).toBeUndefined();
    delete process.env.QWEN_API_KEY;

    expect(
      isGeminiTextModel({
        name: "models/gemini-4-hydrogen",
        supportedActions: ["generateContent", "countTokens"],
      }),
    ).toBe(true);
    expect(
      isGeminiTextModel({
        name: "models/gemini-3.8-flash-tts",
        supportedActions: ["generateContent"],
      }),
    ).toBe(false);
    expect(
      isGeminiTextModel({
        name: "models/gemini-3-pro-image",
        supportedActions: ["generateContent"],
      }),
    ).toBe(false);
    expect(
      isGeminiTextModel({
        name: "models/lyria-3.5",
        supportedActions: ["generateContent"],
      }),
    ).toBe(false);
  });

  it("routes prompt polish through OpenAI-compatible providers while preserving vocabulary, style bible, and audio directives", async () => {
    const groq = createProvider(tmpDir, {
      name: "Groq",
      kind: "openai_compat",
      preset: "groq",
      baseUrl: "https://api.groq.com/openai/v1",
      defaultModel: "llama-3.3-70b-versatile",
      apiKey: "gsk_freekey1234",
    });

    updateAppAndRoleSettings(tmpDir, {
      roleProviders: {
        text_polish: {
          providerId: groq.id,
          modelId: "llama-3.3-70b-versatile",
        },
      },
    });

    const cfg = getConfig();
    const target = resolveTextTarget(cfg, getDb(), "text_polish");
    expect(target.kind).toBe("openai_compat");
    expect(target.baseUrl).toBe("https://api.groq.com/openai/v1");
    expect(target.modelId).toBe("llama-3.3-70b-versatile");
    expect(target.enableThinking).toBeUndefined();

    const mockFetch = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe(
        "https://api.groq.com/openai/v1/chat/completions",
      );
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer gsk_freekey1234");
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        enable_thinking?: unknown;
        messages: Array<{ role: string; content: string }>;
      };
      expect(body.model).toBe("llama-3.3-70b-versatile");
      expect(body.enable_thinking).toBeUndefined();
      // Prompt framework vocabulary & style bible remain intact
      expect(body.messages[0]?.content).toContain("Shot framing and motion");
      expect(body.messages[0]?.content).toContain("Dolly zoom");
      expect(body.messages[1]?.content).toContain("1990s Hong Kong noir");

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  visualPrompt:
                    "Medium tracking shot in 1990s Hong Kong noir rain alley. No text.",
                  cameraDirection: "Medium tracking shot, 35mm anamorphic",
                  audioScript: "Rain on awnings, distant neon hum.",
                }),
              },
            },
          ],
          usage: { prompt_tokens: 120, completion_tokens: 45, total_tokens: 165 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const chat = getTextChat(cfg, mockFetch, { role: "text_polish" });
    const polished = await polishPrompt({
      text: "woman walking in rain alley",
      context: {
        styleBible: "1990s Hong Kong noir",
        audioMode: "ambient_only",
      },
      chat,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(polished.visualPrompt).toContain("Hong Kong noir");
    expect(polished.cameraDirection).toContain("tracking");
  });

  it("exposes only masked keys via /api/settings/providers CRUD routes", async () => {
    const createRes = await postProvidersRoute(
      new Request("http://localhost/api/settings/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Groq Fast",
          kind: "openai_compat",
          preset: "groq",
          baseUrl: "https://api.groq.com/openai/v1",
          defaultModel: "llama-3.3-70b-versatile",
          apiKey: "gsk_supersecretgroqkey9876",
        }),
      }),
    );
    expect(createRes.status).toBe(201);
    const createdJson = await createRes.json();
    expect(createdJson.provider.hasApiKey).toBe(true);
    expect(createdJson.provider.maskedApiKey).toBe("****9876");
    expect(JSON.stringify(createdJson)).not.toContain(
      "gsk_supersecretgroqkey9876",
    );

    const id = createdJson.provider.id as string;

    const appRes = await putAppSettingsRoute(
      new Request("http://localhost/api/settings/app", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app: { maxConcurrentJobs: 4 },
          roleProviders: {
            text_polish: {
              providerId: id,
              modelId: "llama-3.3-70b-versatile",
            },
          },
        }),
      }),
    );
    expect(appRes.status).toBe(200);

    const listRes = await getProvidersRoute();
    const listJson = await listRes.json();
    expect(listJson.providers).toHaveLength(1);
    expect(listJson.roleProviders.text_polish.providerId).toBe(id);
    expect(listJson.app.maxConcurrentJobs).toBe(4);
    expect(JSON.stringify(listJson)).not.toContain(
      "gsk_supersecretgroqkey9876",
    );

    const patchRes = await patchProviderRoute(
      new Request(`http://localhost/api/settings/providers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Groq Updated" }),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(patchRes.status).toBe(200);
    const patchedJson = await patchRes.json();
    expect(patchedJson.provider.name).toBe("Groq Updated");
    expect(patchedJson.provider.maskedApiKey).toBe("****9876");

    const delRes = await deleteProviderRoute(
      new Request(`http://localhost/api/settings/providers/${id}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(delRes.status).toBe(200);

    const afterList = await (await getProvidersRoute()).json();
    expect(afterList.providers).toHaveLength(0);
    expect(afterList.roleProviders.text_polish).toBeUndefined();
  });

  it("classifies Gemini multimodal models (text, image, tts, veo) and resolves media targets", () => {
    expect(
      classifyGeminiModel({
        name: "models/gemini-3.5-flash-lite",
        displayName: "Gemini 3.5 Flash Lite",
        supportedActions: ["generateContent", "countTokens"],
      })?.modality,
    ).toBe("text");

    expect(
      classifyGeminiModel({
        name: "models/gemini-3.1-flash-image",
        displayName: "Nano Banana 2",
        supportedActions: ["generateContent", "countTokens"],
      })?.modality,
    ).toBe("image");

    expect(
      classifyGeminiModel({
        name: "models/imagen-4.0-generate-001",
        displayName: "Imagen 4",
        supportedActions: ["predict"],
      })?.modality,
    ).toBe("image");

    const tts = classifyGeminiModel({
      name: "models/gemini-3.8-flash-tts",
      displayName: "Gemini 3.8 Flash TTS",
      supportedActions: ["generateContent"],
    });
    expect(tts?.modality).toBe("audio");
    expect(tts?.ttsCapable).toBe(true);

    expect(
      classifyGeminiModel({
        name: "models/veo-3.0-generate-001",
        displayName: "Veo 3",
        supportedActions: ["predictLongRunning"],
      })?.modality,
    ).toBe("video");

    expect(
      classifyGeminiModel({
        name: "models/gemini-embedding-001",
        supportedActions: ["embedContent"],
      }),
    ).toBeNull();
    expect(
      classifyGeminiModel({
        name: "models/lyria-3.5",
        supportedActions: ["generateContent"],
      }),
    ).toBeNull();

    expect(sizeToGeminiAspectRatio("1280*720")).toBe("16:9");
    expect(sizeToGeminiAspectRatio("720*1280")).toBe("9:16");
    expect(sizeToGeminiAspectRatio("1024*1024")).toBe("1:1");

    const wav = pcm16ToWav(new Uint8Array([1, 2, 3, 4]), 24000, 1, 16);
    expect(wav.byteLength).toBe(48);
    expect(Buffer.from(wav.slice(0, 4)).toString("ascii")).toBe("RIFF");
    expect(Buffer.from(wav.slice(8, 12)).toString("ascii")).toBe("WAVE");

    const gemini = createProvider(tmpDir, {
      name: "Google Gemini",
      kind: "gemini",
      preset: "gemini",
      apiKey: "AQ.Ab8RN6MediaTestKey1234567890",
    });

    updateAppAndRoleSettings(tmpDir, {
      roleProviders: {
        image: { providerId: gemini.id, modelId: "gemini-3.1-flash-image" },
        audio: { providerId: gemini.id, modelId: "gemini-3.8-flash-tts" },
        video: { providerId: gemini.id, modelId: "veo-3.0-generate-001" },
      },
    });

    const imgTarget = resolveMediaTarget("image");
    expect(imgTarget.providerKind).toBe("gemini");
    expect(imgTarget.modelId).toBe("gemini-3.1-flash-image");
    expect(imgTarget.capabilities.modality).toBe("image");

    const audioTarget = resolveMediaTarget("audio");
    expect(audioTarget.providerKind).toBe("gemini");
    expect(audioTarget.modelId).toBe("gemini-3.8-flash-tts");
    expect(audioTarget.capabilities.ttsCapable).toBe(true);

    const videoTarget = resolveMediaTarget("video");
    expect(videoTarget.providerKind).toBe("gemini");
    expect(videoTarget.modelId).toBe("veo-3.0-generate-001");
    expect(videoTarget.capabilities.modality).toBe("video");

    deleteProvider(tmpDir, gemini.id);
    expect(getConfig().roleProviders?.image).toBeUndefined();
    expect(getConfig().roleProviders?.audio).toBeUndefined();
    expect(getConfig().roleProviders?.video).toBeUndefined();
  });
});
