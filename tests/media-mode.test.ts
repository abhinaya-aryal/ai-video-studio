import { describe, expect, it } from "vitest";
import { getModelCapabilities } from "@/lib/providers/catalog";
import { mediaModeState } from "@/lib/studio/media-mode";

describe("mediaModeState", () => {
  it("disables reference slots in first_last_frame mode with a 'cannot be combined' reason", () => {
    const cap = getModelCapabilities("wan3.0-video");
    const state = mediaModeState("first_last_frame", cap, {
      firstFrame: false,
      lastFrame: false,
      refImages: 0,
      refVideos: 0,
      refAudios: 0,
    });

    expect(state.disabledSlots).toContain("reference_image");
    expect(state.disabledSlots).toContain("reference_video");
    expect(state.disabledSlots).toContain("reference_audio");
    expect(state.reasons.reference_image.toLowerCase()).toContain(
      "cannot be combined",
    );
    expect(state.reasons.reference_video.toLowerCase()).toContain(
      "cannot be combined",
    );
    expect(state.reasons.reference_audio.toLowerCase()).toContain(
      "cannot be combined",
    );
    expect(state.disabledSlots).not.toContain("first_frame");
    expect(state.disabledSlots).not.toContain("last_frame");
  });

  it("disables reference_image when 10 reference images are attached", () => {
    const cap = getModelCapabilities("wan3.0-video");
    const state = mediaModeState("omni_reference", cap, {
      refImages: 10,
      refVideos: 0,
      refAudios: 0,
    });

    expect(state.disabledSlots).toContain("reference_image");
    expect(state.reasons.reference_image).toBeTruthy();
    expect(state.disabledSlots).not.toContain("reference_video");
    expect(state.disabledSlots).not.toContain("reference_audio");
    expect(state.canSubmit).toBe(true);
  });

  it("disables frame slots for wan2.7-t2v based on model capability", () => {
    const cap = getModelCapabilities("wan2.7-t2v");
    const state = mediaModeState("first_last_frame", cap, {
      refImages: 0,
      refVideos: 0,
      refAudios: 0,
    });

    expect(state.disabledSlots).toContain("first_frame");
    expect(state.disabledSlots).toContain("last_frame");
    expect(state.reasons.first_frame).toBeTruthy();
    expect(state.reasons.last_frame).toBeTruthy();
    expect(state.canSubmit).toBe(false);
  });
});
