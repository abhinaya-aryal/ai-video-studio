export interface ColorStop {
  hex: string;
  ratio: string;
}

/**
 * Color palettes for the built-in style presets. Wan 2.7 accepts 3-10 colors
 * whose ratios sum to 100%, which reinforces the Style Bible with concrete hues.
 */
export const STYLE_PALETTES: Record<string, ColorStop[]> = {
  "preset-cinematic": [
    { hex: "#0E2A33", ratio: "28.00%" },
    { hex: "#14505C", ratio: "22.00%" },
    { hex: "#E07A3F", ratio: "18.00%" },
    { hex: "#F2B56B", ratio: "12.00%" },
    { hex: "#2B2B2B", ratio: "12.00%" },
    { hex: "#D9D2C5", ratio: "8.00%" },
  ],
  "preset-anime": [
    { hex: "#1B3B6F", ratio: "24.00%" },
    { hex: "#3FA7D6", ratio: "20.00%" },
    { hex: "#F25F5C", ratio: "16.00%" },
    { hex: "#FFE066", ratio: "14.00%" },
    { hex: "#70C1B3", ratio: "14.00%" },
    { hex: "#F7F7FF", ratio: "12.00%" },
  ],
  "preset-documentary": [
    { hex: "#3E4A3D", ratio: "26.00%" },
    { hex: "#6B7A5A", ratio: "22.00%" },
    { hex: "#8C9A7B", ratio: "18.00%" },
    { hex: "#C2B59B", ratio: "14.00%" },
    { hex: "#5C5148", ratio: "12.00%" },
    { hex: "#E6E1D6", ratio: "8.00%" },
  ],
  "preset-product": [
    { hex: "#F4F4F4", ratio: "30.00%" },
    { hex: "#D9D9D9", ratio: "22.00%" },
    { hex: "#A6A6A6", ratio: "16.00%" },
    { hex: "#1C1C1C", ratio: "14.00%" },
    { hex: "#E8C547", ratio: "10.00%" },
    { hex: "#FFFFFF", ratio: "8.00%" },
  ],
  "preset-3d-mythic": [
    { hex: "#1F4D2E", ratio: "30.00%" },
    { hex: "#6B8E3D", ratio: "22.00%" },
    { hex: "#C9A24B", ratio: "18.00%" },
    { hex: "#E3B65A", ratio: "12.00%" },
    { hex: "#7A5A2E", ratio: "10.00%" },
    { hex: "#E8DCC0", ratio: "8.00%" },
  ],
};

export function paletteForPreset(
  presetId: string | null | undefined,
): ColorStop[] | undefined {
  if (!presetId) return undefined;
  return STYLE_PALETTES[presetId];
}