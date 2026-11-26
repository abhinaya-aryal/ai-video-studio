import type { ElementKind, ReferenceElement } from "@/db/schema";

type ElementImageInput = Pick<ReferenceElement, "kind" | "name" | "description">;

const MAX_STORY_CONTEXT_CHARS = 400;

const KIND_SUBJECT: Record<ElementKind, string> = {
  character:
    "Single character image, one person only, front-facing, neutral expression, relaxed neutral pose, full body visible",
  prop: "Single clear image of the object, one prop only, centered and fully visible",
  location:
    "Single establishing shot of the location, wide view, no people, no text overlays",
};

/**
 * Condense the project's story text into a compact single-line context snippet
 * suitable for grounding element image generation without overwhelming the subject.
 */
export function extractStoryContext(
  story?: string | null,
  maxChars = MAX_STORY_CONTEXT_CHARS,
): string {
  const normalized = (story ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxChars) return normalized;

  const slice = normalized.slice(0, maxChars);
  const sentenceEnd = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf("? "),
  );
  if (sentenceEnd >= Math.floor(maxChars * 0.5)) {
    return slice.slice(0, sentenceEnd + 1).trim();
  }

  const wordEnd = slice.lastIndexOf(" ");
  const cut = wordEnd > 0 ? slice.slice(0, wordEnd) : slice;
  return `${cut.trimEnd()}...`;
}

/**
 * Build the default prompt for an element's canonical image, including concise
 * story context and the project Style Bible. Characters, props, and locations
 * each get one clean reference image instead of a multi-view sheet, so the
 * video model can align expressions and motion on its own.
 */
export function buildElementImagePrompt(
  element: ElementImageInput,
  styleBible: string,
  storyContext?: string | null,
): string {
  const story = extractStoryContext(storyContext);

  return [
    `${KIND_SUBJECT[element.kind]} for ${element.kind} "${element.name}".`,
    element.description.trim(),
    story ? `Story context: ${story}` : "",
    styleBible.trim() ? `Style: ${styleBible.trim()}` : "",
    "Plain neutral background, consistent design, high detail, one image only, no collage or panel layout.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Return the user's edited prompt verbatim when provided, or fall back to the
 * default canonical prompt built from the element, style bible, and story context.
 */
export function resolveElementImagePrompt(
  element: ElementImageInput,
  styleBible: string,
  storyContext?: string | null,
  customPrompt?: string | null,
): string {
  const trimmed = customPrompt?.trim();
  if (trimmed) {
    return trimmed;
  }
  return buildElementImagePrompt(element, styleBible, storyContext);
}