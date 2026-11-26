/** The six prompt dimensions every refined scene must cover. */
export const PROMPT_DIMENSIONS = [
  {
    name: "Shot framing and motion",
    rule: "Open with a shot size paired with a camera move, for example \"low-angle orbit\" or \"locked-off medium shot\".",
  },
  {
    name: "Style",
    rule: "Name a specific visual register and reference world. Replace generic \"cinematic\" with concrete references such as \"1990s Hong Kong noir, desaturated blues, 35mm grain\".",
  },
  {
    name: "Lighting",
    rule: "Name the light source and its quality, for example \"one warm practical streetlamp overhead\" or \"flat overcast daylight from the left\".",
  },
  {
    name: "Location",
    rule: "Use one concise phrase that leans on real-world knowledge, for example \"rain-slicked Tokyo alley, 11 PM\".",
  },
  {
    name: "Action",
    rule: "State the subject, the activity, and the key scene event with specificity.",
  },
  {
    name: "Text and audio",
    rule: "State visible text explicitly, or write \"No text.\" State the audio environment, music, narration, or spoken line.",
  },
] as const;

/** Shot sizes and framing scales. */
export const SHOT_SIZE_VOCABULARY = [
  "Extreme wide shot (EWS)",
  "Wide / Establishing shot (WS)",
  "Full shot (FS)",
  "Medium wide / Cowboy shot",
  "Medium shot (MS)",
  "Medium close-up (MCU)",
  "Close-up (CU)",
  "Extreme close-up (ECU)",
  "Two-shot",
  "Insert / Cutaway",
] as const;

/** Camera moves and angles that visibly shape video model output. */
export const CAMERA_VOCABULARY = [
  ["Oner", "uncut continuous single take, no cuts or edits"],
  ["Locked off", "static camera, no movement at all"],
  ["Push in", "camera moves forward toward the subject"],
  ["Pull back", "camera moves backward, revealing more of the scene"],
  ["Tracking shot", "camera glides alongside or behind a moving subject"],
  ["Dolly zoom", "camera moves opposite to the zoom, distorting depth"],
  ["Orbit", "camera circles around the subject"],
  ["Pan", "camera rotates horizontally on a fixed axis"],
  ["Whip pan", "rapid horizontal pan with motion blur"],
  ["Tilt", "camera rotates vertically on a fixed axis"],
  ["Crane / Jib", "camera sweeps upward, downward, or arcs overhead"],
  ["Pedestal", "camera rises or lowers vertically without tilting"],
  ["Steadicam", "smooth floating movement following action"],
  ["Handheld", "subtle organic camera shake for immediacy"],
  ["Crash zoom", "sudden rapid zoom into a detail or face"],
  ["Dutch angle", "camera tilts on the horizontal axis, creating unease"],
  ["POV", "camera represents a character's literal eye view"],
  ["Over the shoulder (OTS)", "camera behind one character, looking at another"],
  ["Rack focus", "focus shifts between foreground and background mid-clip"],
  ["Low angle", "camera sits below the subject, looking up"],
  ["High angle", "camera sits above the subject, looking down"],
  ["Bird's-eye / Overhead", "straight-down top view"],
  ["Worm's-eye", "ground-level extreme upward angle"],
] as const;

/** Optics, lens focal lengths, and focus textures. */
export const LENS_AND_FOCUS_VOCABULARY = [
  "Anamorphic",
  "24mm wide-angle",
  "35mm",
  "50mm natural",
  "85mm telephoto",
  "Macro",
  "Fisheye",
  "Shallow depth of field (bokeh)",
  "Deep focus",
  "Split diopter",
  "Soft halation",
  "35mm film grain",
] as const;

/** Concrete lighting setups and atmospheric qualities. */
export const LIGHTING_VOCABULARY = [
  "Golden hour",
  "Blue hour",
  "Chiaroscuro",
  "Rembrandt lighting",
  "Backlit / Silhouette",
  "Rim light",
  "Volumetric god rays",
  "Practical light source",
  "Neon spill",
  "Soft overcast",
  "Candlelight / Firelight",
  "Moonlit",
  "High-key",
  "Low-key noir",
  "Dappled foliage light",
] as const;

/** Composition, visual staging, and motion pacing cues. */
export const COMPOSITION_AND_PACING_VOCABULARY = [
  "Rule of thirds",
  "Symmetrical / One-point perspective",
  "Leading lines",
  "Foreground framing",
  "Negative space",
  "Slow motion",
  "Time-lapse",
  "Speed ramp",
  "Match cut",
] as const;

/** Audio design and soundscape cues. */
export const AUDIO_VOCABULARY = [
  "Room tone",
  "Foley",
  "Distant ambience",
  "Wind / Weather bed",
  "Diegetic sound",
  "Sub-bass drone",
  "Dry close-mic",
  "Reverberant space",
  "Off-screen voice",
  "Whispered delivery",
] as const;

const STRONG_EXAMPLE =
  '"Medium tracking shot, camera follows at shoulder height. 1990s Hong Kong noir, desaturated blues. One streetlamp overhead, rain causing halos in the light. Narrow market street, vendors closing up. A woman in her 30s in a long coat walks fast, checking over her shoulder. No text. Audio: rain on canvas awnings, distant traffic."';

/**
 * Instructions shared by prompt polish and storyboard refinement. Both call
 * sites inject this text so a scene prompt always carries the same six
 * dimensions and full cinematography vocabulary without verbose padding.
 */
export function buildPromptFramework(): string {
  const dimensions = PROMPT_DIMENSIONS.map(
    (dimension, index) => `${index + 1}. ${dimension.name}: ${dimension.rule}`,
  ).join("\n");

  const cameraTerms = CAMERA_VOCABULARY.map(([term]) => term).join(", ");

  return [
    "Cover these six dimensions in order:",
    dimensions,
    "",
    "Rules: 4-6 core elements; concrete technical language (not vague labels like 'cinematic' or 'moody'); coherent real-world physics; never omit audio; preserve existing details when editing.",
    `Shot sizes: ${SHOT_SIZE_VOCABULARY.join(", ")}.`,
    `Camera & angles (pair shot size + movement): ${cameraTerms}.`,
    `Lens & focus: ${LENS_AND_FOCUS_VOCABULARY.join(", ")}.`,
    `Lighting: ${LIGHTING_VOCABULARY.join(", ")}.`,
    `Composition & pacing: ${COMPOSITION_AND_PACING_VOCABULARY.join(", ")}.`,
    `Audio cues: ${AUDIO_VOCABULARY.join(", ")}.`,
    `Example: ${STRONG_EXAMPLE}`,
  ].join("\n");
}

/** Audio instruction for a specific audio mode. */
export function audioDirective(
  mode: "ambient_only" | "narration" | "dialogue" | "silent" | undefined,
): string {
  switch (mode) {
    case "silent":
      return 'Audio mode is silent. Set audioScript to "Silent." and add no music, dialogue, or ambience.';
    case "narration":
      return "Audio mode is narration. Write the voice-over line and its delivery, then name the room tone underneath.";
    case "dialogue":
      return "Audio mode is dialogue. Write the exact spoken line and delivery, then name the ambience underneath.";
    case "ambient_only":
      return "Audio mode is ambient_only. Name the acoustic environment and one foreground sound. No music or dialogue.";
    default:
      return "Infer the audio from the draft, then state it explicitly.";
  }
}