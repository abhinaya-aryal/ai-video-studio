import { describe, expect, it } from "vitest";
import type { Project, ReferenceElement, Scene } from "@/db/schema";
import { getModelCapabilities } from "@/lib/providers/catalog";
import { buildSceneVideoRequest } from "@/lib/studio/scene-request";

function makeProject(overrides: Partial<Project> = {}): Project {
  const now = Date.now();
  return {
    id: "proj-1",
    slug: "test-project",
    title: "Test Project",
    roughIdea: "A test idea",
    refinedStory: "A refined story",
    styleBible: "Anamorphic cinematic lighting",
    stylePresetId: null,
    aspectRatio: "16:9",
    resolution: "720P",
    defaultVideoModel: "wan3.0-video",
    isHidden: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeElement(
  id: string,
  kind: ReferenceElement["kind"],
  name: string,
): ReferenceElement {
  const now = Date.now();
  return {
    id,
    projectId: "proj-1",
    kind,
    name,
    description: `${name} description`,
    activeImagePath: `test-project/elements/${id}.png`,
    createdAt: now,
    updatedAt: now,
  };
}

function makeScene(overrides: Partial<Scene> = {}): Scene {
  const now = Date.now();
  return {
    id: "scene-1",
    projectId: "proj-1",
    orderIndex: 0,
    slug: "01-opening",
    title: "Opening Shot",
    visualPrompt: "@Image 1 walks through the neon alley.",
    cameraDirection: "Slow dolly in",
    audioMode: "ambient_only",
    audioScript: "Rain on pavement",
    duration: 5,
    videoMode: "omni_reference",
    linkedElementIdsJson: "[]",
    activeKeyframeFirstAssetId: null,
    activeKeyframeLastAssetId: null,
    activeVideoAssetId: null,
    activeAudioAssetId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("buildSceneVideoRequest", () => {
  const wan3Cap = getModelCapabilities("wan3.0-video");

  it("caps omni_reference mode at 10 reference_image items in kind priority order and tags @Image 1", async () => {
    const elements: ReferenceElement[] = [
      makeElement("loc-1", "location", "Neon Alley"),
      makeElement("loc-2", "location", "Rooftop"),
      makeElement("loc-3", "location", "Subway"),
      makeElement("loc-4", "location", "Diner"),
      makeElement("prop-1", "prop", "Laser Key"),
      makeElement("prop-2", "prop", "Holo Map"),
      makeElement("prop-3", "prop", "Umbrella"),
      makeElement("prop-4", "prop", "Jacket"),
      makeElement("char-1", "character", "Kira"),
      makeElement("char-2", "character", "Vex"),
      makeElement("char-3", "character", "Mina"),
      makeElement("char-4", "character", "Soren"),
    ];

    const scene = makeScene({
      videoMode: "omni_reference",
      linkedElementIdsJson: JSON.stringify(elements.map((e) => e.id)),
    });
    const project = makeProject();

    const preparedPaths: string[] = [];
    const { payload, droppedElements } = await buildSceneVideoRequest(
      scene,
      elements,
      project,
      wan3Cap,
      {
        prepareImage: async (filePath) => {
          preparedPaths.push(filePath);
          return `oss://bucket/${preparedPaths.length}.png`;
        },
      },
    );

    expect(droppedElements).toHaveLength(2);
    expect(droppedElements).toEqual(["Subway", "Diner"]);

    const body = payload.body as {
      input: { prompt: string; media?: Array<{ type: string; url: string }> };
    };
    expect(body.input.media).toHaveLength(10);
    expect(body.input.media?.every((m) => m.type === "reference_image")).toBe(
      true,
    );
    expect(body.input.prompt).toContain("@Image 1");
    expect(body.input.prompt).toContain("@Image 10");
    // Characters come first (4), then props (4), then first 2 locations
    expect(preparedPaths[0]).toContain("char-1.png");
    expect(preparedPaths[4]).toContain("prop-1.png");
    expect(preparedPaths[8]).toContain("loc-1.png");
    expect(preparedPaths[9]).toContain("loc-2.png");
  });

  it("uses keyframe assets only in first_last_frame mode even when elements are linked", async () => {
    const elements = [
      makeElement("char-1", "character", "Kira"),
      makeElement("loc-1", "location", "Neon Alley"),
    ];
    const scene = makeScene({
      videoMode: "first_last_frame",
      linkedElementIdsJson: JSON.stringify(["char-1", "loc-1"]),
      activeKeyframeFirstAssetId: "asset-kf-1",
      activeKeyframeLastAssetId: "asset-kf-2",
    });
    const project = makeProject();

    const { payload, droppedElements } = await buildSceneVideoRequest(
      scene,
      elements,
      project,
      wan3Cap,
      {
        getAssetFilePath: (assetId) =>
          assetId === "asset-kf-1"
            ? "test-project/scenes/01/kf_first.png"
            : "test-project/scenes/01/kf_last.png",
        prepareImage: async (filePath) => `oss://bucket/${filePath}`,
      },
    );

    expect(droppedElements).toEqual([]);
    const body = payload.body as {
      input: { media?: Array<{ type: string; url: string }> };
    };
    expect(body.input.media).toHaveLength(2);
    expect(body.input.media?.[0].type).toBe("first_frame");
    expect(body.input.media?.[1].type).toBe("last_frame");
    expect(
      body.input.media?.some((m) => m.type === "reference_image"),
    ).toBe(false);
  });

  it("throws a helpful Stage 2 keyframe error when first_last_frame mode has no keyframe asset", async () => {
    const scene = makeScene({
      videoMode: "first_last_frame",
      activeKeyframeFirstAssetId: null,
      activeKeyframeLastAssetId: null,
    });
    const project = makeProject();

    await expect(
      buildSceneVideoRequest(scene, [], project, wan3Cap, {
        prepareImage: async (p) => p,
      }),
    ).rejects.toThrow(/Stage 2/i);
  });
});
