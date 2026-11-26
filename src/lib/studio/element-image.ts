import type { ElementKind, ReferenceElement } from "@/db";

type ElementImageInput = Pick<ReferenceElement, "kind" | "name" | "description">;

const KIND_SUBJECT: Record<ElementKind, string> = {
  character:
    "Single character image, one person only, front-facing, neutral expression, relaxed neutral pose, full body visible",
  prop: "Single clear image of the object, one prop only, centered and fully visible",
  location:
    "Single establishing shot of the location, wide view, no people, no text overlays",
};

/**
 * Build the prompt for an element's canonical image. Characters, props, and
 * locations each get one clean reference image instead of a multi-view sheet,
 * so the video model can align expressions and motion on its own.
 */
export function buildElementImagePrompt(
  element: ElementImageInput,
  styleBible: string,
  promptOverride?: string,
): string {
  const direction = promptOverride?.trim();

  return [
    `${KIND_SUBJECT[element.kind]} for ${element.kind} "${element.name}".`,
    element.description.trim(),
    styleBible.trim() ? `Style: ${styleBible.trim()}` : "",
    "Plain neutral background, consistent design, high detail, one image only, no collage or panel layout.",
    direction ? `Additional direction: ${direction}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}