import { describe, expect, it } from "vitest";
import {
  getModelCapabilities,
  listModelCapabilities,
} from "@/lib/providers/catalog";
import {
  checkQwenKeyUrl,
  resolveQwenBaseUrl,
} from "@/lib/providers/qwen-endpoints";
import {
  type CustomModelRow,
  type ElementRef,
  UnknownModelError,
  WanValidationError,
} from "@/lib/providers/types";
import {
  buildVideoSynthesisPayload,
  compileScenePrompt,
  selectReferenceElements,
} from "@/lib/providers/wan-payload";

describe("Qwen endpoint routing & key/URL validation", () => {
  it("routes Token Plan keys to the token-plan host and warns on mismatch", () => {
    expect(
      resolveQwenBaseUrl({
        keyType: "token_plan",
        region: "ap-southeast-1",
      }),
    ).toBe("https://token-plan.ap-southeast-1.maas.aliyuncs.com");

    expect(
      resolveQwenBaseUrl({
        keyType: "token_plan",
        region: "cn-beijing",
      }),
    ).toBe("https://token-plan.cn-beijing.maas.aliyuncs.com");

    expect(
      resolveQwenBaseUrl({
        keyType: "standard",
        apiKey: "sk-sp-abc123",
        region: "ap-southeast-1",
      }),
    ).toBe("https://token-plan.ap-southeast-1.maas.aliyuncs.com");

    const mismatch = checkQwenKeyUrl(
      "sk-sp-x",
      "https://dashscope.aliyuncs.com",
    );
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) {
      expect(mismatch.warning.toLowerCase()).toContain("token-plan");
    }

    expect(
      checkQwenKeyUrl(
        "sk-sp-x",
        "https://token-plan.ap-southeast-1.maas.aliyuncs.com",
      ),
    ).toEqual({ ok: true });
  });

  it("routes Standard keys with workspaceId, regional fallback, and baseUrlOverride", () => {
    const withWorkspace = resolveQwenBaseUrl({
      keyType: "standard",
      region: "ap-southeast-1",
      workspaceId: "ws-12345",
    });
    expect(withWorkspace).toBe(
      "https://ws-12345.ap-southeast-1.maas.aliyuncs.com",
    );

    expect(
      resolveQwenBaseUrl({
        keyType: "standard",
        region: "ap-southeast-1",
      }),
    ).toBe("https://dashscope-intl.aliyuncs.com");

    expect(
      resolveQwenBaseUrl({
        keyType: "standard",
        region: "cn-beijing",
      }),
    ).toBe("https://dashscope.aliyuncs.com");

    expect(
      resolveQwenBaseUrl({
        keyType: "token_plan",
        region: "ap-southeast-1",
        baseUrlOverride: " https://custom-proxy.example.com/v1/// ",
      }),
    ).toBe("https://custom-proxy.example.com/v1");

    const standardOnTokenPlan = checkQwenKeyUrl(
      "sk-standard-123",
      "https://token-plan.ap-southeast-1.maas.aliyuncs.com",
    );
    expect(standardOnTokenPlan.ok).toBe(false);
  });
});

describe("Model capability catalog", () => {
  it("exposes verified capabilities for Wan 3.0, Wan 2.7, and image models", () => {
    const wan3 = getModelCapabilities("wan3.0-video");
    expect(wan3.family).toBe("wan3");
    expect(wan3.maxCounts.reference_image).toBe(10);
    expect(wan3.maxCounts.reference_video).toBe(5);
    expect(wan3.maxCounts.reference_audio).toBe(5);
    expect(wan3.durations).toEqual({ min: 2, max: 30, smart: true });
    expect(wan3.resolutions).toEqual(["480P", "720P", "1080P"]);
    expect(wan3.nativeAudio).toBe(true);

    const wan27T2v = getModelCapabilities("wan2.7-t2v");
    expect(wan27T2v.family).toBe("wan2.7");
    expect(wan27T2v.allowedMediaTypes).toEqual([]);

    const wan27I2v = getModelCapabilities("wan2.7-i2v");
    expect(wan27I2v.allowedMediaTypes).toEqual(["first_frame", "last_frame"]);

    const wan27R2v = getModelCapabilities("wan2.7-r2v");
    expect(wan27R2v.allowedMediaTypes).toEqual([
      "reference_image",
      "reference_video",
      "reference_audio",
    ]);

    const wanImgPro = getModelCapabilities("wan2.7-image-pro");
    expect(wanImgPro.modality).toBe("image");
    expect(wanImgPro.maxReferenceImages).toBe(9);

    const qwenImg = getModelCapabilities("qwen-image-3.0");
    expect(qwenImg.modality).toBe("image");
    expect(qwenImg.maxReferenceImages).toBe(3);
  });

  it("throws UnknownModelError for unknown model IDs and resolves custom models when provided", () => {
    expect(() => getModelCapabilities("my-new-wan")).toThrowError(
      UnknownModelError,
    );

    const customRows: CustomModelRow[] = [
      {
        id: "cm-1",
        modelId: "my-new-wan",
        displayName: "My New Wan",
        modality: "video",
        family: "wan3",
        capabilitiesJson: JSON.stringify({
          allowedMediaTypes: ["first_frame", "last_frame", "reference_image"],
          maxCounts: { first_frame: 1, last_frame: 1, reference_image: 6 },
          durations: { min: 2, max: 20, smart: true },
          resolutions: ["720P", "1080P"],
          nativeAudio: true,
        }),
        source: "manual",
        providerCreatedAt: null,
        lastSeenAt: null,
        available: 1,
        ignored: 0,
        capabilitiesEdited: 0,
      },
    ];

    const cap = getModelCapabilities("my-new-wan", customRows);
    expect(cap.modelId).toBe("my-new-wan");
    expect(cap.family).toBe("wan3");
    expect(cap.maxCounts.reference_image).toBe(6);
    expect(cap.durations).toEqual({ min: 2, max: 20, smart: true });

    const all = listModelCapabilities(customRows);
    expect(all.some((item) => item.modelId === "my-new-wan")).toBe(true);
  });
});

describe("Wan request validation and payload building", () => {
  it("enforces Wan 3.0 mutual exclusion and per-type reference limits", () => {
    const cap = getModelCapabilities("wan3.0-video");

    expect(() =>
      buildVideoSynthesisPayload(
        {
          modelId: "wan3.0-video",
          prompt: "A cyberpunk chase",
          audio: true,
          media: [
            { type: "first_frame", url: "data:image/png;base64,AAA" },
            { type: "reference_image", url: "data:image/png;base64,BBB" },
          ],
          duration: 5,
          resolution: "720P",
          ratio: "16:9",
        },
        cap,
      ),
    ).toThrowError(WanValidationError);

    const elevenImages = Array.from({ length: 11 }, (_, idx) => ({
      type: "reference_image" as const,
      url: `oss://bucket/img-${idx}.png`,
    }));
    expect(() =>
      buildVideoSynthesisPayload(
        {
          modelId: "wan3.0-video",
          prompt: "Too many images",
          audio: true,
          media: elevenImages,
          duration: 5,
          resolution: "720P",
          ratio: "16:9",
        },
        cap,
      ),
    ).toThrowError(WanValidationError);

    const sixVideos = Array.from({ length: 6 }, (_, idx) => ({
      type: "reference_video" as const,
      url: `oss://bucket/vid-${idx}.mp4`,
    }));
    expect(() =>
      buildVideoSynthesisPayload(
        {
          modelId: "wan3.0-video",
          prompt: "Too many videos",
          audio: true,
          media: sixVideos,
          duration: 5,
          resolution: "720P",
          ratio: "16:9",
        },
        cap,
      ),
    ).toThrowError(WanValidationError);

    const sixAudios = Array.from({ length: 6 }, (_, idx) => ({
      type: "reference_audio" as const,
      url: `oss://bucket/aud-${idx}.mp3`,
    }));
    expect(() =>
      buildVideoSynthesisPayload(
        {
          modelId: "wan3.0-video",
          prompt: "Too many audios",
          audio: true,
          media: sixAudios,
          duration: 5,
          resolution: "720P",
          ratio: "16:9",
        },
        cap,
      ),
    ).toThrowError(WanValidationError);
  });

  it("sets needsOssHeader true only when media contains oss:// URLs", () => {
    const cap = getModelCapabilities("wan3.0-video");

    const withOss = buildVideoSynthesisPayload(
      {
        modelId: "wan3.0-video",
        prompt: "Neon alley",
        audio: true,
        media: [
          { type: "reference_image", url: "oss://dashscope-tmp/dir/kai.png" },
        ],
        duration: 5,
        resolution: "720P",
        ratio: "16:9",
      },
      cap,
    );
    expect(withOss.needsOssHeader).toBe(true);
    expect(withOss.body).toEqual({
      model: "wan3.0-video",
      input: {
        prompt: "Neon alley",
        media: [
          { type: "reference_image", url: "oss://dashscope-tmp/dir/kai.png" },
        ],
      },
      parameters: {
        duration: 5,
        resolution: "720P",
        ratio: "16:9",
        audio: true,
      },
    });

    const withDataUri = buildVideoSynthesisPayload(
      {
        modelId: "wan3.0-video",
        prompt: "Neon alley",
        audio: false,
        media: [{ type: "first_frame", url: "data:image/png;base64,iVBORw0K" }],
        duration: -1,
        resolution: "1080P",
        ratio: "16:9",
        promptExtend: true,
      },
      cap,
    );
    expect(withDataUri.needsOssHeader).toBe(false);
    expect(withDataUri.body).toEqual({
      model: "wan3.0-video",
      input: {
        prompt: "Neon alley",
        media: [{ type: "first_frame", url: "data:image/png;base64,iVBORw0K" }],
      },
      parameters: {
        duration: -1,
        resolution: "1080P",
        ratio: "16:9",
        audio: false,
        prompt_extend: true,
      },
    });
  });

  it("rejects media not allowed by the selected model ID", () => {
    const t2vCap = getModelCapabilities("wan2.7-t2v");

    expect(() =>
      buildVideoSynthesisPayload(
        {
          modelId: "wan2.7-t2v",
          prompt: "Text only shot",
          audio: true,
          media: [{ type: "first_frame", url: "data:image/png;base64,AAA" }],
          duration: 5,
          resolution: "720P",
          ratio: "16:9",
        },
        t2vCap,
      ),
    ).toThrowError(WanValidationError);
  });
});

describe("Prompt compilation & reference element capping", () => {
  it("handles audio modes and tagged element references in compileScenePrompt", () => {
    const silent = compileScenePrompt({
      visualPrompt: "Rain falls on neon pavement.",
      audioMode: "silent",
      audioScript: 'Kai: "Should not appear"',
    });
    expect(silent.audio).toBe(false);
    expect(silent.prompt).not.toContain("Should not appear");
    expect(silent.prompt.toLowerCase()).not.toContain("dialogue");

    const dialogue = compileScenePrompt({
      visualPrompt: "Kai draws his blade.",
      cameraDirection: "Slow dolly in",
      audioMode: "dialogue",
      audioScript: 'Kai: "Run!"',
      styleBible: "Cyberpunk noir, high contrast",
      taggedElements: [{ tag: "@Image 1", name: "Kai", kind: "character" }],
    });
    expect(dialogue.audio).toBe(true);
    expect(dialogue.prompt).toContain('Kai: "Run!"');
    expect(dialogue.prompt).toContain("@Image 1");
    expect(dialogue.prompt).toContain("Slow dolly in");
    expect(dialogue.prompt).toContain("Cyberpunk noir, high contrast");

    const ambient = compileScenePrompt({
      visualPrompt: "Empty subway platform.",
      audioMode: "ambient_only",
    });
    expect(ambient.audio).toBe(true);

    const narration = compileScenePrompt({
      visualPrompt: "Skyline at dawn.",
      audioMode: "narration",
      audioScript: "The city never truly slept.",
    });
    expect(narration.audio).toBe(true);
    expect(narration.prompt).toContain("The city never truly slept.");
  });

  it("matches tagged element references on token boundaries so @Image 10 does not hide @Image 1", () => {
    const compiled = compileScenePrompt({
      visualPrompt: "@Image 10 illuminates the rain-soaked alley.",
      audioMode: "silent",
      taggedElements: [
        { tag: "@Image 1", name: "Kai", kind: "character" },
        { tag: "@Image 10", name: "Neon Sign", kind: "location" },
      ],
    });

    expect(compiled.prompt).toMatch(/@Image 1(?!\d)/);
    expect(compiled.prompt.match(/@Image 10\b/g)).toHaveLength(1);
    expect(compiled.prompt).toContain("@Image 1 (Kai, character)");
    expect(compiled.prompt).not.toContain("@Image 10 (Neon Sign, location)");
  });

  it("caps reference elements prioritizing characters, then props, then locations", () => {
    const characters: ElementRef[] = Array.from({ length: 8 }, (_, i) => ({
      id: `char-${i + 1}`,
      kind: "character",
      name: `Character ${i + 1}`,
    }));
    const props: ElementRef[] = Array.from({ length: 3 }, (_, i) => ({
      id: `prop-${i + 1}`,
      kind: "prop",
      name: `Prop ${i + 1}`,
    }));
    const locations: ElementRef[] = Array.from({ length: 2 }, (_, i) => ({
      id: `loc-${i + 1}`,
      kind: "location",
      name: `Location ${i + 1}`,
    }));

    // Mix input order to also verify kind-priority sorting preserves link order within each kind.
    const mixed: ElementRef[] = [
      ...locations,
      ...props,
      ...characters,
    ];

    const { kept, dropped } = selectReferenceElements(mixed, 10);

    expect(kept).toHaveLength(10);
    expect(kept.filter((el) => el.kind === "character")).toHaveLength(8);
    expect(kept.filter((el) => el.kind === "prop")).toHaveLength(2);
    expect(kept.filter((el) => el.kind === "location")).toHaveLength(0);
    expect(kept.map((el) => el.id)).toEqual([
      "char-1",
      "char-2",
      "char-3",
      "char-4",
      "char-5",
      "char-6",
      "char-7",
      "char-8",
      "prop-1",
      "prop-2",
    ]);

    expect(dropped).toHaveLength(3);
    expect(dropped.filter((el) => el.kind === "prop")).toHaveLength(1);
    expect(dropped.filter((el) => el.kind === "location")).toHaveLength(2);
    expect(dropped.map((el) => el.id)).toEqual(["prop-3", "loc-1", "loc-2"]);
  });
});
