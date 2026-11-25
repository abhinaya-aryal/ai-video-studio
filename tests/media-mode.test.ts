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

  it("ignores linked reference media in modes that do not send it", () => {
    const cap = getModelCapabilities("wan3.0-video");
    const withLinkedElements = {
      firstFrame: true,
      lastFrame: false,
      refImages: 2,
      refVideos: 0,
      refAudios: 0,
    };

    const textState = mediaModeState(
      "text_to_video",
      cap,
      withLinkedElements,
    );
    expect(textState.canSubmit).toBe(true);

    const frameState = mediaModeState(
      "first_last_frame",
      cap,
      withLinkedElements,
    );
    expect(frameState.canSubmit).toBe(true);
    expect(frameState.reasons.first_frame ?? "").not.toContain(
      "cannot be combined",
    );

    const omniState = mediaModeState(
      "omni_reference",
      cap,
      withLinkedElements,
    );
    expect(omniState.canSubmit).toBe(true);

    const noFirstFrame = mediaModeState("first_last_frame", cap, {
      ...withLinkedElements,
      firstFrame: false,
    });
    expect(noFirstFrame.canSubmit).toBe(false);
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
