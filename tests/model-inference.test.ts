import { describe, expect, it } from "vitest";
import { inferCapabilities, inferModel } from "@/lib/providers/model-inference";

describe("model inference", () => {
  it("maps known families", () => {
    expect(inferModel("wan3.0-video")).toMatchObject({
      modality: "video",
      family: "wan3",
    });
    expect(inferModel("wan2.7-r2v")).toMatchObject({
      modality: "video",
      family: "wan2.7",
    });
    expect(inferModel("qwen-image-3.0-pro")).toMatchObject({
      modality: "image",
      family: "qwen-image",
    });
    expect(inferModel("qwen-audio-3.0-tts-plus")).toMatchObject({
      modality: "audio",
      ttsCapable: true,
    });
    expect(inferModel("qwen-audio-3.0-asr-flash")).toMatchObject({
      modality: "audio",
      ttsCapable: false,
    });
    expect(inferModel("qwen-audio-3.0-realtime-plus")).toMatchObject({
      modality: "audio",
      ttsCapable: false,
    });
    expect(inferModel("qwen3.8-max")).toMatchObject({ modality: "text" });
    expect(inferModel("deepseek-v4-pro")).toMatchObject({ modality: "text" });
  });

  it("uses conservative rules for unknown video", () => {
    const cap = inferCapabilities("brand-new-video");
    expect(cap.modality).toBe("video");
    expect(cap.allowedMediaTypes).toEqual([]);
    expect(cap.durations).toEqual({ min: 2, max: 15, smart: false });
  });

  it("keeps built-in rules for known video", () => {
    const cap = inferCapabilities("wan3.0-video");
    expect(cap.allowedMediaTypes).toContain("reference_image");
    expect(cap.maxCounts.reference_image).toBe(10);
  });

  it("maps wan2.7 image ids to reference-image rules", () => {
    expect(inferCapabilities("wan2.7-image").maxReferenceImages).toBe(9);
  });

  it("gives unknown images a single reference slot", () => {
    const cap = inferCapabilities("mystery-image-v2");
    expect(cap.modality).toBe("image");
    expect(cap.maxReferenceImages).toBe(1);
  });
});