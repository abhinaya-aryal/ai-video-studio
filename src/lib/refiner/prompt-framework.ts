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

/** Camera terms that change model output, with the effect each one produces. */
export const CAMERA_VOCABULARY = [
  ["Oner", "uncut continuous single take, no cuts or edits"],
  ["Locked off", "static camera, no movement at all"],
  ["Push in", "camera moves forward toward the subject"],
  ["Pull back", "camera moves backward, revealing more of the scene"],
  ["Dolly zoom", "camera moves opposite to the zoom, distorting depth"],
  ["Orbit", "camera circles around the subject"],
  ["Dutch angle", "camera tilts on the horizontal axis, creating unease"],
  ["POV", "camera represents a character's literal eye view"],
  ["Over the shoulder (OTS)", "camera behind one character, looking at another"],
  ["Rack focus", "focus shifts between foreground and background mid-clip"],
  ["Pan", "camera rotates horizontally on a fixed axis"],
  ["Tilt", "camera rotates vertically on a fixed axis"],
  ["Crane shot", "camera moves upward or arcs in a wide sweep"],
  ["Extreme close-up (ECU)", "fills the frame with a detail such as an eye or a hand"],
  ["Low angle", "camera sits below the subject, looking up"],
] as const;

const WEAK_EXAMPLE = '"A woman walking in a city at night."';
const STRONG_EXAMPLE =
  '"Medium tracking shot, camera follows at shoulder height. 1990s Hong Kong noir, desaturated blues. One streetlamp overhead, rain causing halos in the light. Narrow market street, vendors closing up. A woman in her 30s in a long coat walks fast, checking over her shoulder. No text. Audio: rain on canvas awnings, distant traffic."';

/**
 * Instructions shared by prompt polish and storyboard refinement. Both call
 * sites inject this text so a scene prompt always carries the same six
 * dimensions and technical camera language.
 */
export function buildPromptFramework(): string {
  const dimensions = PROMPT_DIMENSIONS.map(
    (dimension, index) => `${index + 1}. ${dimension.name}: ${dimension.rule}`,
  ).join("\n");

  const camera = CAMERA_VOCABULARY.map(
    ([term, effect]) => `- ${term}: ${effect}`,
  ).join("\n");

  return [
    "Build every prompt from these six dimensions, in this order:",
    dimensions,
    "",
    "Prompt rules:",
    "- Keep 4 to 6 core elements. Do not stack competing details.",
    "- Direct, not decorative. Write \"single practical lamp source\" instead of \"moody lighting\".",
    "- Ground the scene in coherent real-world physics and logic.",
    "- Never leave audio unspecified. Silent is a choice, not an omission.",
    "- Replace subjective labels with concrete technical references. Write \"Super-8 grain, warm amber grade, 1978\" instead of \"nostalgic\".",
    "- When editing an existing prompt, preserve every established detail and change only what the user asked to change.",
    "",
    "Camera vocabulary. Pair shot size with movement:",
    camera,
    "",
    `Weak: ${WEAK_EXAMPLE}`,
    `Strong: ${STRONG_EXAMPLE}`,
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