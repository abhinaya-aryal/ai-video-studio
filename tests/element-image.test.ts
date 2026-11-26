import { describe, expect, it } from "vitest";
import {
  buildElementImagePrompt,
  extractStoryContext,
  resolveElementImagePrompt,
} from "@/lib/studio/element-image";

const base = {
  name: "Sita",
  description: "A calm young woman with long dark hair.",
};

describe("buildElementImagePrompt", () => {
  it("asks for one canonical character image instead of a reference sheet", () => {
    const prompt = buildElementImagePrompt(
      { ...base, kind: "character" },
      "Warm painterly light",
      "In ancient Ayodhya, Sita prepares for a journey into the forest.",
    );

    expect(prompt).toContain('"Sita"');
    expect(prompt).toContain("A calm young woman with long dark hair.");
    expect(prompt).toContain(
      "Story context: In ancient Ayodhya, Sita prepares for a journey into the forest.",
    );
    expect(prompt).toContain("Warm painterly light");
    expect(prompt.toLowerCase()).toContain("single");
    expect(prompt.toLowerCase()).not.toContain("reference sheet");
    expect(prompt.toLowerCase()).not.toContain("expression sheet");
    expect(prompt.toLowerCase()).not.toContain("multiple views");
  });

  it("asks for one clear object image for props", () => {
    const prompt = buildElementImagePrompt(
      { kind: "prop", name: "Golden Deer", description: "Ornate golden deer." },
      "",
    );

    expect(prompt).toContain('"Golden Deer"');
    expect(prompt.toLowerCase()).toContain("single");
    expect(prompt.toLowerCase()).toContain("object");
    expect(prompt.toLowerCase()).not.toContain("story context:");
    expect(prompt.toLowerCase()).not.toContain("reference sheet");
  });

  it("asks for one establishing image for locations", () => {
    const prompt = buildElementImagePrompt(
      { kind: "location", name: "Ayodhya", description: "A riverside city." },
      "",
    );

    expect(prompt).toContain('"Ayodhya"');
    expect(prompt.toLowerCase()).toContain("establishing");
    expect(prompt.toLowerCase()).not.toContain("reference sheet");
  });
});

describe("extractStoryContext", () => {
  it("normalizes whitespace and truncates long stories cleanly", () => {
    const longStory =
      "Sentence one establishes the ancient kingdom and its sunlit palace. " +
      "Sentence two introduces the looming exile into the dense forest. " +
      "Sentence three adds extra plot details that go far beyond the concise context limit for image generation.";

    const excerpt = extractStoryContext(longStory, 140);
    expect(excerpt).toBe(
      "Sentence one establishes the ancient kingdom and its sunlit palace. Sentence two introduces the looming exile into the dense forest.",
    );
  });

  it("falls back to word-boundary ellipsis when no sentence boundary fits", () => {
    const excerpt = extractStoryContext(
      "A continuous clause without punctuation that keeps going past the limit",
      32,
    );
    expect(excerpt).toBe("A continuous clause without...");
  });
});

describe("resolveElementImagePrompt", () => {
  it("uses a caller-edited prompt verbatim without wrapping it", () => {
    const prompt = resolveElementImagePrompt(
      { ...base, kind: "character" },
      "Warm painterly light",
      "A story about exile.",
      "  Close-up portrait on blue paper.  ",
    );

    expect(prompt).toBe("Close-up portrait on blue paper.");
  });

  it("falls back to the default prompt with story context when custom prompt is empty", () => {
    const prompt = resolveElementImagePrompt(
      { ...base, kind: "character" },
      "Warm painterly light",
      "A story about exile.",
      "   ",
    );

    expect(prompt).toContain("Single character image");
    expect(prompt).toContain("Story context: A story about exile.");
    expect(prompt).toContain("Style: Warm painterly light");
  });
});