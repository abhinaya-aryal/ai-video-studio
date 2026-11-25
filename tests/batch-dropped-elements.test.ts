import { describe, expect, it } from "vitest";
import { collectDroppedElementsByScene } from "@/lib/studio/dropped-elements";

describe("collectDroppedElementsByScene", () => {
  it("keeps scene ids with non-empty dropped element names", () => {
    expect(
      collectDroppedElementsByScene({
        "scene-1": ["Neon Alley", "Rooftop"],
        "scene-2": [],
        "scene-3": ["Kira"],
      }),
    ).toEqual({
      "scene-1": ["Neon Alley", "Rooftop"],
      "scene-3": ["Kira"],
    });
  });

  it("ignores malformed payloads and non-string entries", () => {
    expect(collectDroppedElementsByScene(null)).toEqual({});
    expect(collectDroppedElementsByScene("nope")).toEqual({});
    expect(collectDroppedElementsByScene(["Neon Alley"])).toEqual({});
    expect(
      collectDroppedElementsByScene({
        "scene-1": ["Neon Alley", 42, "", null],
        "scene-2": "not-an-array",
      }),
    ).toEqual({ "scene-1": ["Neon Alley"] });
  });
});
