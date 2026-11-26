import { describe, expect, it } from "vitest";
import { stableSeed } from "@/lib/studio/seed";

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