import type { VideoMode } from "@/db/schema";
import { MEDIA_TYPES, type MediaType, type ModelCapability } from "@/lib/providers/types";

export interface AttachedMediaCounts {
  firstFrame?: boolean | string | null;
  lastFrame?: boolean | string | null;
  refImages: number;
  refVideos: number;
  refAudios: number;
}

export interface MediaModeStateResult {
  disabledSlots: MediaType[];
  reasons: Record<string, string>;
  canSubmit: boolean;
}

const FRAME_SLOTS = new Set<MediaType>(["first_frame", "last_frame"]);
const REFERENCE_SLOTS = new Set<MediaType>([
  "reference_image",
  "reference_video",
  "reference_audio",
  "file",
  "link",
]);

function attachedCountForSlot(
  slot: MediaType,
  attached: AttachedMediaCounts,
): number {
  switch (slot) {
    case "first_frame":
      return attached.firstFrame ? 1 : 0;
    case "last_frame":
      return attached.lastFrame ? 1 : 0;
    case "reference_image":
      return attached.refImages;
    case "reference_video":
      return attached.refVideos;
    case "reference_audio":
      return attached.refAudios;
    case "file":
    case "link":
      return 0;
  }
}

/**
 * Single source of truth for which media slots are disabled in the UI,
 * the human-readable tooltip reason for each disabled slot, and whether
 * the current mode + media selection is valid to submit.
 */
export function mediaModeState(
  mode: VideoMode,
  cap: ModelCapability,
  attached: AttachedMediaCounts,
): MediaModeStateResult {
  const disabledSlots: MediaType[] = [];
  const reasons: Record<string, string> = {};

  const hasFrameAttached = Boolean(attached.firstFrame || attached.lastFrame);
  const hasRefAttached =
    attached.refImages > 0 ||
    attached.refVideos > 0 ||
    attached.refAudios > 0;

  for (const slot of MEDIA_TYPES) {
    if (!cap.allowedMediaTypes.includes(slot)) {
      disabledSlots.push(slot);
      reasons[slot] = `Model ${cap.modelId} does not support ${slot.replace(/_/g, " ")}.`;
      continue;
    }

    if (mode === "text_to_video") {
      disabledSlots.push(slot);
      reasons[slot] = "Text-to-video mode does not use input media.";
      continue;
    }

    if (mode === "first_last_frame" && REFERENCE_SLOTS.has(slot)) {
      disabledSlots.push(slot);
      reasons[slot] =
        "First/last frame mode cannot be combined with reference media.";
      continue;
    }

    if (mode === "omni_reference" && FRAME_SLOTS.has(slot)) {
      disabledSlots.push(slot);
      reasons[slot] =
        "Omni-reference mode cannot be combined with first/last frames.";
      continue;
    }

    if (hasFrameAttached && REFERENCE_SLOTS.has(slot)) {
      disabledSlots.push(slot);
      reasons[slot] =
        "First/last frames cannot be combined with reference media.";
      continue;
    }

    if (hasRefAttached && FRAME_SLOTS.has(slot)) {
      disabledSlots.push(slot);
      reasons[slot] =
        "Reference media cannot be combined with first/last frames.";
      continue;
    }

    const max = cap.maxCounts[slot];
    if (typeof max === "number" && attachedCountForSlot(slot, attached) >= max) {
      disabledSlots.push(slot);
      reasons[slot] = `Maximum of ${max} ${slot.replace(/_/g, " ")} reached.`;
      continue;
    }
  }

  let canSubmit = true;
  if (mode === "first_last_frame") {
    const supportsFirst = cap.allowedMediaTypes.includes("first_frame");
    canSubmit =
      supportsFirst &&
      Boolean(attached.firstFrame) &&
      !hasRefAttached;
  } else if (mode === "omni_reference") {
    const supportsAnyRef = cap.allowedMediaTypes.some((t) =>
      REFERENCE_SLOTS.has(t),
    );
    canSubmit = supportsAnyRef && !hasFrameAttached;
  } else {
    canSubmit = !hasFrameAttached && !hasRefAttached;
  }

  return { disabledSlots, reasons, canSubmit };
}
