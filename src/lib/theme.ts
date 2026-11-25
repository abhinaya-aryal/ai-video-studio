export const THEMES = [
  { id: "nebula", label: "Nebula", scheme: "dark" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

export const DEFAULT_THEME: ThemeId = "nebula";
