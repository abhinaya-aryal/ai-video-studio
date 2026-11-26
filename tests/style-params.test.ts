import { describe, expect, it } from "vitest";
import { stableSeed } from "@/lib/studio/seed";
import {
  STYLE_PALETTES,
  paletteForPreset,
} from "@/lib/studio/style-palette";

describe("stableSeed", () => {
  it("returns a deterministic in-range seed", () => {
    const first = stableSeed("element", "proj-1", "elem-1");
    const second = stableSeed("element", "proj-1", "elem-1");
    const other = stableSeed("element", "proj-1", "elem-2");

    expect(first).toBe(second);
    expect(first).not.toBe(other);
    expect(Number.isInteger(first)).toBe(true);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(2147483647);
  });
});

describe("style palettes", () => {
  it("defines a valid 3-10 color palette for every built-in preset", () => {
    for (const [presetId, palette] of Object.entries(STYLE_PALETTES)) {
      expect(palette.length, presetId).toBeGreaterThanOrEqual(3);
      expect(palette.length, presetId).toBeLessThanOrEqual(10);

      const total = palette.reduce(
        (sum, stop) => sum + Number.parseFloat(stop.ratio),
        0,
      );
      expect(total, presetId).toBeCloseTo(100, 2);

      for (const stop of palette) {
        expect(stop.hex, presetId).toMatch(/^#[0-9A-Fa-f]{6}$/);
        expect(stop.ratio, presetId).toMatch(/^\d{1,3}\.\d{2}%$/);
      }
    }
  });

  it("returns the palette for a built-in preset and undefined otherwise", () => {
    expect(paletteForPreset("preset-3d-mythic")).toEqual(
      STYLE_PALETTES["preset-3d-mythic"],
    );
    expect(paletteForPreset("preset-custom")).toBeUndefined();
    expect(paletteForPreset(null)).toBeUndefined();
  });
});