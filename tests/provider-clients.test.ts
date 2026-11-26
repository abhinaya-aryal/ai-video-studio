import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "@/lib/config";
import { mapProviderError } from "@/lib/providers/errors";
import {
  chatCompletion,
  testOpenAIConnection,
} from "@/lib/providers/openai-text";
import {
  generateImage,
  getTaskStatus,
  submitVideoTask,
  synthesizeSpeech,
  testQwenConnection,
} from "@/lib/providers/qwen-client";
import {
  prepareImageMedia,
  resetOssUnsupportedHostsForTests,
  uploadToDashScopeOss,
} from "@/lib/providers/qwen-oss";
import { getTextChat } from "@/lib/providers/text";

const tempDirs: string[] = [];

async function makeTempFile(
  filename: string,
  content: Buffer,
): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-video-studio-t4-"));
  tempDirs.push(dir);
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, content);
  return filePath;
}

function makeTestConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    dataDir: "/tmp/data",
    projectsDir: "/tmp/projects",
    qwen: {
      apiKey: "sk-sp-testkey1234",
      keyType: "token_plan",
      region: "ap-southeast-1",
    },
    textProvider: "qwen",
    jobs: {
      maxConcurrent: 2,
      pollIntervalMs: 10000,
    },
    ...overrides,
  };
}

afterEach(async () => {
  resetOssUnsupportedHostsForTests();
  await Promise.all(
    tempDirs
      .splice(0, tempDirs.length)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("DashScope OSS upload and prepareImageMedia", () => {
  it("fetches upload policy and POSTs multipart FormData to upload_host, returning oss:// URI", async () => {
    const filePath = await makeTempFile(
      "hero-frame.png",
      Buffer.from("fake-png-bytes"),
    );

    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              policy: "encoded-policy",
              signature: "signed-value",
              upload_dir: "dashscope-instant/20261125/abc",
              upload_host: "https://dashscope-file-mgr.oss-cn-beijing.aliyuncs.com",
              oss_access_key_id: "LTAI_test",
              x_oss_object_acl: "private",
              x_oss_forbid_overwrite: "true",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(new Response("", { status: 200 }));

    const ossUrl = await uploadToDashScopeOss({
      baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/",
      apiKey: "sk-sp-secret",
      model: "wan3.0-video",
      filePath,
      fetchFn,
    });

    expect(ossUrl).toBe("oss://dashscope-instant/20261125/abc/hero-frame.png");
    expect(fetchFn).toHaveBeenCalledTimes(2);

    const [policyUrl, policyInit] = fetchFn.mock.calls[0];
    expect(policyUrl).toBe(
      "https://token-plan.ap-southeast-1.maas.aliyuncs.com/api/v1/uploads?action=getPolicy&model=wan3.0-video",
    );
    expect(policyInit?.method).toBe("GET");
    expect(new Headers(policyInit?.headers).get("authorization")).toBe(
      "Bearer sk-sp-secret",
    );

    const [uploadUrl, uploadInit] = fetchFn.mock.calls[1];
    expect(uploadUrl).toBe(
      "https://dashscope-file-mgr.oss-cn-beijing.aliyuncs.com",
    );
    expect(uploadInit?.method).toBe("POST");
    expect(new Headers(uploadInit?.headers).get("authorization")).toBeNull();
    expect(uploadInit?.body).toBeInstanceOf(FormData);

    const form = uploadInit?.body as FormData;
    expect(form.get("key")).toBe(
      "dashscope-instant/20261125/abc/hero-frame.png",
    );
    expect(form.get("OSSAccessKeyId")).toBe("LTAI_test");
    expect(form.get("policy")).toBe("encoded-policy");
    expect(form.get("Signature")).toBe("signed-value");
    expect(form.get("file")).toBeTruthy();

    // OSS requires `file` to be the final form field.
    const keys = Array.from(form.keys());
    expect(keys[keys.length - 1]).toBe("file");
  });

  it("returns data URI for <=2MB single image and oss:// for multi-image or >2MB", async () => {
    const smallPng = await makeTempFile("small.png", Buffer.alloc(1024, 0x41));
    const singleFetch = vi.fn<typeof fetch>();

    const dataUri = await prepareImageMedia({
      baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com",
      apiKey: "sk-sp-secret",
      model: "wan3.0-video",
      filePath: smallPng,
      imageCountInRequest: 1,
      fetchFn: singleFetch,
    });

    expect(dataUri.startsWith("data:image/png;base64,")).toBe(true);
    expect(singleFetch).not.toHaveBeenCalled();

    // When /api/v1/uploads returns 404 (Token Plan), multi-image requests fall
    // back to Base64 and cache the host so subsequent images skip the 404 probe.
    const notFoundFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("Not Found", { status: 404 }));
    const fallbackUri = await prepareImageMedia({
      baseUrl: "https://token-plan-404.ap-southeast-1.maas.aliyuncs.com",
      apiKey: "sk-sp-secret",
      model: "wan3.0-video",
      filePath: smallPng,
      imageCountInRequest: 2,
      fetchFn: notFoundFetch,
    });
    expect(fallbackUri.startsWith("data:image/png;base64,")).toBe(true);
    expect(notFoundFetch).toHaveBeenCalledTimes(1);

    const cachedFallbackUri = await prepareImageMedia({
      baseUrl: "https://token-plan-404.ap-southeast-1.maas.aliyuncs.com",
      apiKey: "sk-sp-secret",
      model: "wan3.0-video",
      filePath: smallPng,
      imageCountInRequest: 2,
      fetchFn: notFoundFetch,
    });
    expect(cachedFallbackUri.startsWith("data:image/png;base64,")).toBe(true);
    expect(notFoundFetch).toHaveBeenCalledTimes(1);

    // Real PNG images are compressed to smaller inline JPEG data URIs via sharp.
    const { default: sharp } = await import("sharp");
    const rawPixels = Buffer.alloc(512 * 512 * 3);
    for (let i = 0; i < rawPixels.length; i += 3) {
      rawPixels[i] = (i * 13) % 256;
      rawPixels[i + 1] = (i * 29) % 256;
      rawPixels[i + 2] = (i * 47) % 256;
    }
    const realPngBuffer = await sharp(rawPixels, {
      raw: { width: 512, height: 512, channels: 3 },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    const realPngPath = await makeTempFile("real.png", realPngBuffer);
    const compressedUri = await prepareImageMedia({
      baseUrl: "https://token-plan-404.ap-southeast-1.maas.aliyuncs.com",
      apiKey: "sk-sp-secret",
      model: "wan3.0-video",
      filePath: realPngPath,
      imageCountInRequest: 1,
      fetchFn: singleFetch,
    });
    expect(compressedUri.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(compressedUri.length).toBeLessThan(realPngBuffer.toString("base64").length);

    const multiFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              policy: "p",
              signature: "s",
              upload_dir: "dashscope-instant/multi",
              upload_host: "https://oss.example.com",
              oss_access_key_id: "id",
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response("", { status: 200 }));

    const multiOss = await prepareImageMedia({
      baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com",
      apiKey: "sk-sp-secret",
      model: "wan3.0-video",
      filePath: smallPng,
      imageCountInRequest: 3,
      fetchFn: multiFetch,
    });

    expect(multiOss).toBe("oss://dashscope-instant/multi/small.png");
    expect(multiFetch).toHaveBeenCalledTimes(2);

    const largePng = await makeTempFile(
      "large.png",
      Buffer.alloc(2 * 1024 * 1024 + 1, 0x42),
    );
    const largeFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              policy: "p",
              signature: "s",
              upload_dir: "dashscope-instant/large",
              upload_host: "https://oss.example.com",
              oss_access_key_id: "id",
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response("", { status: 200 }));

    const largeOss = await prepareImageMedia({
      baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com",
      apiKey: "sk-sp-secret",
      model: "wan3.0-video",
      filePath: largePng,
      imageCountInRequest: 1,
      fetchFn: largeFetch,
    });

    expect(largeOss).toBe("oss://dashscope-instant/large/large.png");
    expect(largeFetch).toHaveBeenCalledTimes(2);
  });
});

describe("QwenCloud client", () => {
  it("submitVideoTask sends X-DashScope-Async and conditional X-DashScope-OssResourceResolve", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        new Response(
          JSON.stringify({ output: { task_id: "task-vid-001" } }),
          { status: 200 },
        ),
      );

    const res1 = await submitVideoTask({
      baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com",
      apiKey: "sk-sp-secret",
      body: {
        model: "wan3.0-video",
        input: { prompt: "Rainy neon street" },
        parameters: {
          duration: 5,
          resolution: "720P",
          ratio: "16:9",
          audio: true,
        },
      },
      needsOssHeader: false,
      fetchFn,
    });

    expect(res1).toEqual({ taskId: "task-vid-001" });
    const headers1 = new Headers(fetchFn.mock.calls[0][1]?.headers);
    expect(headers1.get("x-dashscope-async")).toBe("enable");
    expect(headers1.get("x-dashscope-ossresourceresolve")).toBeNull();

    const res2 = await submitVideoTask({
      baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com",
      apiKey: "sk-sp-secret",
      body: {
        model: "wan3.0-video",
        input: {
          prompt: "Hero @Image 1",
          media: [{ type: "reference_image", url: "oss://bucket/hero.png" }],
        },
        parameters: {
          duration: 5,
          resolution: "720P",
          ratio: "16:9",
          audio: true,
        },
      },
      needsOssHeader: true,
      fetchFn,
    });

    expect(res2).toEqual({ taskId: "task-vid-001" });
    const headers2 = new Headers(fetchFn.mock.calls[1][1]?.headers);
    expect(headers2.get("x-dashscope-async")).toBe("enable");
    expect(headers2.get("x-dashscope-ossresourceresolve")).toBe("enable");
  });

  it("getTaskStatus normalizes SUCCEEDED video/image results and FAILED errors", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output: {
              task_status: "SUCCEEDED",
              video_url: "https://cdn.example.com/clip.mp4",
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output: {
              task_status: "FAILED",
              code: "DataInspectionFailed",
              message: "Content blocked",
            },
          }),
          { status: 200 },
        ),
      );

    const ok = await getTaskStatus({
      baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com",
      apiKey: "sk-sp-secret",
      taskId: "task-1",
      fetchFn,
    });
    expect(ok).toEqual({
      status: "SUCCEEDED",
      resultUrls: ["https://cdn.example.com/clip.mp4"],
    });

    const failed = await getTaskStatus({
      baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com",
      apiKey: "sk-sp-secret",
      taskId: "task-2",
      fetchFn,
    });
    expect(failed).toEqual({
      status: "FAILED",
      resultUrls: [],
      errorCode: "DataInspectionFailed",
      errorMessage: "Content blocked",
    });
  });

  it("gives provider requests an abort signal so a hung call cannot stall the runner", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        new Response(
          JSON.stringify({
            output: { task_id: "task-1", task_status: "RUNNING" },
          }),
          { status: 200 },
        ),
      );

    await submitVideoTask({
      baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com",
      apiKey: "sk-sp-secret",
      body: { model: "wan3.0-video", input: { prompt: "Rain" } },
      needsOssHeader: false,
      fetchFn,
    });
    await getTaskStatus({
      baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com",
      apiKey: "sk-sp-secret",
      taskId: "task-1",
      fetchFn,
    });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    for (const call of fetchFn.mock.calls) {
      expect(call[1]?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("generateImage handles both synchronous and async responses", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output: {
              choices: [
                {
                  message: {
                    content: [{ image: "https://cdn.example.com/img1.png" }],
                  },
                },
              ],
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output: {
              task_id: "img-task-99",
            },
          }),
          { status: 200 },
        ),
      );

    const syncRes = await generateImage({
      baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com",
      apiKey: "sk-sp-secret",
      model: "wan2.7-image-pro",
      prompt: "Cyberpunk character sheet",
      referenceImages: ["oss://dashscope-instant/ref.png"],
      fetchFn,
    });
    expect(syncRes).toEqual({
      kind: "sync",
      urls: ["https://cdn.example.com/img1.png"],
    });
    expect(fetchFn.mock.calls[0][0]).toBe(
      "https://token-plan.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/image-generation/generation",
    );
    expect(
      new Headers(fetchFn.mock.calls[0][1]?.headers).get("x-dashscope-async"),
    ).toBe("enable");
    expect(
      new Headers(fetchFn.mock.calls[0][1]?.headers).get(
        "x-dashscope-ossresourceresolve",
      ),
    ).toBe("enable");

    const asyncRes = await generateImage({
      baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com",
      apiKey: "sk-sp-secret",
      model: "wan2.7-image-pro",
      prompt: "Rainy alley",
      thinkingMode: false,
      seed: 123456,
      colorPalette: [
        { hex: "#1F4D2E", ratio: "60.00%" },
        { hex: "#C9A24B", ratio: "40.00%" },
      ],
      fetchFn,
    });
    expect(asyncRes).toEqual({
      kind: "async",
      taskId: "img-task-99",
    });

    const asyncBody = JSON.parse(
      fetchFn.mock.calls[1][1]?.body as string,
    ) as {
      parameters?: Record<string, unknown>;
    };
    expect(asyncBody.parameters?.thinking_mode).toBe(false);
    expect(asyncBody.parameters?.seed).toBe(123456);
    expect(asyncBody.parameters?.color_palette).toEqual([
      { hex: "#1F4D2E", ratio: "60.00%" },
      { hex: "#C9A24B", ratio: "40.00%" },
    ]);
  });

  it("synthesizeSpeech handles binary audio and JSON url responses", async () => {
    const audioBytes = new Uint8Array([0x49, 0x44, 0x33, 0x04]);
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(audioBytes, {
          status: 200,
          headers: { "content-type": "audio/mpeg" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output: {
              audio: {
                url: "https://cdn.example.com/tts.mp3",
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    const binary = await synthesizeSpeech({
      baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com",
      apiKey: "sk-sp-secret",
      model: "qwen-audio-3.0-tts-plus",
      text: "Welcome to Neo-Tokyo.",
      fetchFn,
    });
    expect(binary.kind).toBe("bytes");
    if (binary.kind === "bytes") {
      expect(binary.mime).toBe("audio/mpeg");
      expect(Array.from(binary.data)).toEqual([0x49, 0x44, 0x33, 0x04]);
    }

    const urlRes = await synthesizeSpeech({
      baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com",
      apiKey: "sk-sp-secret",
      model: "qwen-audio-3.0-tts-plus",
      text: "Welcome again.",
      fetchFn,
    });
    expect(urlRes).toEqual({
      kind: "url",
      url: "https://cdn.example.com/tts.mp3",
    });
  });

  it("testQwenConnection warns when sk-sp- key points to non-token-plan baseUrlOverride", async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const cfg = makeTestConfig({
      qwen: {
        apiKey: "sk-sp-testkey1234",
        keyType: "token_plan",
        region: "ap-southeast-1",
        baseUrlOverride: "https://dashscope-intl.aliyuncs.com",
      },
    });

    const result = await testQwenConnection(cfg, fetchFn);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("token-plan");
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("OpenAI-compatible text client and provider routing", () => {
  it("testOpenAIConnection falls back to chat completion with max_tokens: 1 when GET /models returns 404", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("Not Found", { status: 404 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "ok" } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    const res = await testOpenAIConnection({
      baseUrl: "https://openrouter.ai/api/v1/",
      apiKey: "or-key",
      model: "qwen/qwen-plus",
      fetchFn,
    });

    expect(res.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/models");
    expect(fetchFn.mock.calls[1][0]).toBe(
      "https://openrouter.ai/api/v1/chat/completions",
    );

    const payload = JSON.parse(String(fetchFn.mock.calls[1][1]?.body));
    expect(payload.max_tokens).toBe(1);
    expect(payload.model).toBe("qwen/qwen-plus");
  });

  it("chatCompletion returns assistant message content", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"title":"Neon Rain"}' } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const text = await chatCompletion({
      baseUrl: "http://localhost:11434/v1",
      model: "qwen2.5:14b",
      messages: [{ role: "user", content: "Refine story" }],
      fetchFn,
    });

    expect(text).toBe('{"title":"Neon Rain"}');
  });

  it("getTextChat picks Qwen compatible-mode or OpenAI-compat based on TEXT_PROVIDER", async () => {
    const qwenFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "from-qwen" } }] }),
        { status: 200 },
      ),
    );
    const qwenChat = getTextChat(makeTestConfig(), qwenFetch, {
      modelId: "qwen-plus",
    });
    const qwenReply = await qwenChat([{ role: "user", content: "hi" }]);
    expect(qwenReply).toBe("from-qwen");
    expect(qwenFetch.mock.calls[0][0]).toBe(
      "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
    );
    const qwenBody = JSON.parse(String(qwenFetch.mock.calls[0][1]?.body));
    expect(qwenBody.enable_thinking).toBe(false);

    const openaiFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "from-openai" } }] }),
        { status: 200 },
      ),
    );
    const openaiChat = getTextChat(
      makeTestConfig({
        textProvider: "openai_compat",
        openaiCompat: {
          baseUrl: "http://localhost:11434/v1",
          apiKey: "local-secret",
          model: "qwen2.5:14b",
        },
      }),
      openaiFetch,
    );
    const openaiReply = await openaiChat([{ role: "user", content: "hi" }]);
    expect(openaiReply).toBe("from-openai");
    expect(openaiFetch.mock.calls[0][0]).toBe(
      "http://localhost:11434/v1/chat/completions",
    );
    const openaiBody = JSON.parse(String(openaiFetch.mock.calls[0][1]?.body));
    expect("enable_thinking" in openaiBody).toBe(false);
  });
});

describe("mapProviderError", () => {
  it("maps DataInspectionFailed as non-retryable content moderation error", () => {
    const mapped = mapProviderError("DataInspectionFailed", 400);
    expect(mapped.code).toBe("DataInspectionFailed");
    expect(mapped.retryable).toBe(false);
    expect(mapped.userMessage.toLowerCase()).toContain("content moderation");
  });

  it("maps HTTP 429 as retryable throttling error", () => {
    const mapped = mapProviderError(undefined, 429);
    expect(mapped.retryable).toBe(true);
    expect(mapped.userMessage.length).toBeGreaterThan(0);
  });

  it("maps InvalidApiKey to message mentioning .env.local", () => {
    const mapped = mapProviderError("InvalidApiKey", 401);
    expect(mapped.code).toBe("InvalidApiKey");
    expect(mapped.retryable).toBe(false);
    expect(mapped.userMessage).toContain(".env.local");
  });
});
