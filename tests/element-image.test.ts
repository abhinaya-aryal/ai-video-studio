import { describe, expect, it } from "vitest";
import { buildElementImagePrompt } from "@/lib/studio/element-image";

const base = {
  name: "Sita",
  description: "A calm young woman with long dark hair.",
};

describe("buildElementImagePrompt", () => {
  it("asks for one canonical character image instead of a reference sheet", () => {
    const prompt = buildElementImagePrompt(
      { ...base, kind: "character" },
      "Warm painterly light",
    );

    expect(prompt).toContain('"Sita"');
    expect(prompt).toContain("A calm young woman with long dark hair.");
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

  it("uses a caller-provided prompt verbatim when present", () => {
    const prompt = buildElementImagePrompt(
      { ...base, kind: "character" },
      "Warm painterly light",
      "  Close-up portrait on blue paper.  ",
    );

    expect(prompt).toBe("Close-up portrait on blue paper.");
  });
});