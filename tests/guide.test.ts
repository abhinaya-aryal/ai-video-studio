import { describe, expect, it } from "vitest";
import { GUIDE_STEPS, type GuideGroup } from "@/lib/guide";

const EXPECTED_IDS = [
  "welcome",
  "setup",
  "provider-status",
  "models",
  "projects",
  "stage-1",
  "style-presets",
  "elements",
  "scenes",
  "element-sheets",
  "keyframes",
  "voiceover",
  "stage-3",
  "media-modes",
  "export",
  "quick-clip",
  "settings",
  "jobs",
  "data",
];

const GROUPS: GuideGroup[] = ["Start here", "Build", "Ship", "Reference"];

describe("in-site guide", () => {
  it("covers the documented workflow in order", () => {
    expect(GUIDE_STEPS.map((step) => step.id)).toEqual(EXPECTED_IDS);
  });

  it("groups every step into one of the manual sections", () => {
    const firstSeen = GUIDE_STEPS.map((step) => step.group).filter(
      (group, index, all) => all.indexOf(group) === index,
    );
    expect(firstSeen).toEqual(GROUPS);
    for (const step of GUIDE_STEPS) {
      expect(GROUPS).toContain(step.group);
    }
  });

  it("uses unique, slug-shaped step ids", () => {
    const ids = GUIDE_STEPS.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it("gives every step enough content to teach the workflow", () => {
    for (const step of GUIDE_STEPS) {
      expect(step.title.trim().length).toBeGreaterThan(0);
      expect(step.summary.trim().length).toBeGreaterThan(20);
      expect(step.where.trim().length).toBeGreaterThan(0);
      expect(step.bullets.length).toBeGreaterThanOrEqual(2);
      for (const bullet of step.bullets) {
        expect(bullet.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("documents the controls and fields of each step", () => {
    for (const step of GUIDE_STEPS) {
      expect(step.details.length).toBeGreaterThanOrEqual(2);
      for (const detail of step.details) {
        expect(detail.label.trim().length).toBeGreaterThan(0);
        expect(detail.text.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("links each step to an in-app page with a call to action", () => {
    for (const step of GUIDE_STEPS) {
      expect(step.href).toMatch(/^\//);
      expect(step.cta.trim().length).toBeGreaterThan(0);
    }
  });

  it("leaves no setting, mode, status, or export artifact undocumented", () => {
    const manual = JSON.stringify(GUIDE_STEPS);
    const required = [
      ".env.local",
      "QWEN_API_KEY",
      "QWEN_KEY_TYPE",
      "QWEN_REGION",
      "QWEN_WORKSPACE_ID",
      "QWEN_BASE_URL",
      "TEXT_PROVIDER",
      "OPENAI_COMPAT_BASE_URL",
      "OPENAI_COMPAT_MODEL",
      "OPENAI_COMPAT_API_KEY",
      "MAX_CONCURRENT_JOBS",
      "JOB_POLL_INTERVAL_MS",
      "DATA_DIR",
      "PROJECTS_DIR",
      "MODEL_NOT_SELECTED",
      "MODEL_UNAVAILABLE",
      "text_refine",
      "text_polish",
      "Economy",
      "Balanced",
      "text_to_video",
      "first_last_frame",
      "omni_reference",
      "ambient_only",
      "narration",
      "dialogue",
      "silent",
      "first_frame",
      "last_frame",
      "reference_image",
      "reference_video",
      "reference_audio",
      "QUEUED",
      "PENDING",
      "RUNNING",
      "DOWNLOADING",
      "READY",
      "FAILED",
      "character",
      "prop",
      "location",
      "Cinematic",
      "Anime",
      "Documentary",
      "Product",
      "Epic Hindu Mythology 3D",
      "export_kdenlive",
      "project.kdenlive",
      "story.md",
      "@Image",
      "X-DashScope-OssResourceResolve",
      "studio.db",
      "?",
    ];
    for (const keyword of required) {
      expect(manual).toContain(keyword);
    }
  });
});