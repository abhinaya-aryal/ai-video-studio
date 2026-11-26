import { describe, expect, it, vi } from "vitest";
import type { ChatCompletionFn } from "@/lib/providers/openai-text";
import {
  RefinerError,
  polishPrompt,
  refineStoryAndScenes,
  resolveLinkedElementIds,
} from "@/lib/refiner/story-refiner";

function makeValidPayload(overrides: Record<string, unknown> = {}) {
  return {
    refinedStory:
      "At dusk on a rain-slicked rooftop, courier Kai activates a glowing beacon to guide an incoming airship.",
    styleBible:
      "Cyberpunk neo-noir, wet neon reflections, 35mm anamorphic lens, teal and amber palette",
    elements: [
      {
        kind: "character",
        name: "Kai",
        description: "Young courier in a weathered yellow rain jacket",
      },
      {
        kind: "prop",
        name: "Beacon",
        description: "Brass handheld signal lantern with cyan core",
      },
      {
        kind: "location",
        name: "Rooftop",
        description: "Rain-soaked skyscraper helipad overlooking neon city",
      },
    ],
    scenes: [
      {
        title: "Rooftop Arrival",
        linkedElementNames: ["Kai", "Beacon", "Rooftop"],
        visualPrompt:
          "Kai kneels on the wet rooftop holding the glowing Beacon as rain streaks across neon billboards.",
        cameraDirection: "Slow low-angle push-in",
        audioMode: "ambient_only",
        audioScript: "Heavy rain pattering on concrete and distant city hum.",
        duration: 5,
        videoMode: "omni_reference",
      },
      {
        title: "Signal Ignition",
        linkedElementNames: ["Kai", "Beacon"],
        visualPrompt:
          "Kai twists the Beacon dial, sending a vertical cyan beam up into the storm clouds.",
        cameraDirection: "Tight close-up tilting upward",
        audioMode: "dialogue",
        audioScript: "Kai: Hold position, I am lighting the pad now.",
        duration: 6,
        videoMode: "first_last_frame",
      },
    ],
    ...overrides,
  };
}

describe("refineStoryAndScenes", () => {
  it("strips ```json fences and parses a valid response", async () => {
    const payload = makeValidPayload();
    const chat = vi.fn<ChatCompletionFn>(async () => {
      return `\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
    });

    const result = await refineStoryAndScenes({
      roughIdea: "A courier lights a rooftop beacon in the rain.",
      styleBible: "Teal and amber neo-noir",
      targetSceneCount: 2,
      chat,
    });

    expect(chat).toHaveBeenCalledTimes(1);
    expect(result.refinedStory).toBe(payload.refinedStory);
    expect(result.elements).toHaveLength(3);
    expect(result.scenes).toHaveLength(2);
    expect(result.scenes[0]?.audioMode).toBe("ambient_only");
    expect(result.scenes[1]?.videoMode).toBe("first_last_frame");

    const systemMessage = chat.mock.calls[0]?.[0].find(
      (m) => m.role === "system",
    );
    expect(systemMessage?.content).toContain("Shot framing and motion");
    expect(systemMessage?.content).toContain("Text and audio");
    expect(systemMessage?.content).toContain("Dolly zoom");
    expect(systemMessage?.content).toContain("No text.");

    const userMessage = chat.mock.calls[0]?.[0].find((m) => m.role === "user");
    expect(userMessage?.content).toContain("Teal and amber neo-noir");
    expect(userMessage?.content).toContain("2");
  });

  it("retries once with a repair prompt containing the zod error when first response fails validation", async () => {
    const invalidPayload = makeValidPayload({
      scenes: [
        {
          title: "Bad Scene",
          linkedElementNames: ["Kai"],
          visualPrompt: "Kai walks across the rooftop.",
          cameraDirection: "Tracking shot",
          audioMode: "orchestral_blast",
          audioScript: "",
          duration: 5,
          videoMode: "omni_reference",
        },
      ],
    });
    const validPayload = makeValidPayload();

    const chat = vi
      .fn<ChatCompletionFn>()
      .mockResolvedValueOnce(JSON.stringify(invalidPayload))
      .mockResolvedValueOnce(JSON.stringify(validPayload));

    const result = await refineStoryAndScenes({
      roughIdea: "Courier on a rooftop",
      chat,
    });

    expect(chat).toHaveBeenCalledTimes(2);
    expect(result.scenes).toHaveLength(2);

    const retryMessages = chat.mock.calls[1]?.[0] ?? [];
    const repairPrompt = retryMessages[retryMessages.length - 1]?.content ?? "";
    expect(repairPrompt).toContain("audioMode");
    expect(repairPrompt.toLowerCase()).toContain("invalid");
  });

  it("retries once when the first response is malformed JSON", async () => {
    const validPayload = makeValidPayload();

    const chat = vi
      .fn<ChatCompletionFn>()
      .mockResolvedValueOnce("{ broken json")
      .mockResolvedValueOnce(`\`\`\`\n${JSON.stringify(validPayload)}\n\`\`\``);

    const result = await refineStoryAndScenes({
      roughIdea: "Courier on a rooftop",
      chat,
    });

    expect(chat).toHaveBeenCalledTimes(2);
    expect(result.refinedStory).toBe(validPayload.refinedStory);

    const retryMessages = chat.mock.calls[1]?.[0] ?? [];
    const repairPrompt = retryMessages[retryMessages.length - 1]?.content ?? "";
    expect(repairPrompt.toLowerCase()).toContain("json");
  });

  it("throws RefinerError if both initial and repair responses are invalid", async () => {
    const chat = vi
      .fn<ChatCompletionFn>()
      .mockResolvedValueOnce("not json at all")
      .mockResolvedValueOnce(
        JSON.stringify(makeValidPayload({ scenes: [] })),
      );

    await expect(
      refineStoryAndScenes({
        roughIdea: "Courier on a rooftop",
        chat,
      }),
    ).rejects.toThrow(RefinerError);

    expect(chat).toHaveBeenCalledTimes(2);
  });

  it("throws RefinerError when roughIdea is empty", async () => {
    const chat = vi.fn<ChatCompletionFn>();

    await expect(
      refineStoryAndScenes({
        roughIdea: "   ",
        chat,
      }),
    ).rejects.toThrow(RefinerError);

    expect(chat).not.toHaveBeenCalled();
  });

  it("clamps scene duration to 2..30 and rejects unknown audioMode/videoMode/kind", async () => {
    const clampedPayload = makeValidPayload({
      scenes: [
        {
          title: "Too Short",
          linkedElementNames: [],
          visualPrompt: "Quick flash of lightning.",
          cameraDirection: "Static",
          audioMode: "silent",
          audioScript: "",
          duration: 0,
          videoMode: "text_to_video",
        },
        {
          title: "Too Long",
          linkedElementNames: ["Kai"],
          visualPrompt: "Long unbroken aerial reveal.",
          cameraDirection: "Slow crane up",
          audioMode: "narration",
          audioScript: "The city never sleeps.",
          duration: 90,
          videoMode: "omni_reference",
        },
      ],
    });

    const chatClamp = vi.fn<ChatCompletionFn>(async () =>
      JSON.stringify(clampedPayload),
    );
    const clamped = await refineStoryAndScenes({
      roughIdea: "Lightning and city reveal",
      chat: chatClamp,
    });

    expect(clamped.scenes[0]?.duration).toBe(2);
    expect(clamped.scenes[1]?.duration).toBe(30);

    const badModePayload = makeValidPayload({
      scenes: [
        {
          title: "Bad Audio",
          linkedElementNames: [],
          visualPrompt: "A quiet street.",
          cameraDirection: "Static",
          audioMode: "unknown_audio_mode",
          audioScript: "",
          duration: 5,
          videoMode: "text_to_video",
        },
      ],
    });

    const chatBad = vi
      .fn<ChatCompletionFn>()
      .mockResolvedValue(JSON.stringify(badModePayload));

    await expect(
      refineStoryAndScenes({
        roughIdea: "Quiet street",
        chat: chatBad,
      }),
    ).rejects.toThrow(RefinerError);

    const badVideoModePayload = makeValidPayload({
      scenes: [
        {
          title: "Bad Video Mode",
          linkedElementNames: [],
          visualPrompt: "A quiet street.",
          cameraDirection: "Static",
          audioMode: "silent",
          audioScript: "",
          duration: 5,
          videoMode: "hologram_3d",
        },
      ],
    });
    await expect(
      refineStoryAndScenes({
        roughIdea: "Quiet street",
        chat: vi.fn<ChatCompletionFn>().mockResolvedValue(JSON.stringify(badVideoModePayload)),
      }),
    ).rejects.toThrow(RefinerError);

    const badKindPayload = makeValidPayload({
      elements: [{ kind: "vehicle", name: "Airship", description: "Steampunk ship" }],
    });
    await expect(
      refineStoryAndScenes({
        roughIdea: "Airship docks",
        chat: vi.fn<ChatCompletionFn>().mockResolvedValue(JSON.stringify(badKindPayload)),
      }),
    ).rejects.toThrow(RefinerError);
  });
});

describe("polishPrompt", () => {
  it("polishes prompt text with context and strips fences", async () => {
    const chat = vi.fn<ChatCompletionFn>(async () =>
      [
        "```json",
        JSON.stringify({
          visualPrompt:
            "Rain-drenched neon alley with steam rising from vents as Kai adjusts his hood.",
          cameraDirection: "Medium tracking shot moving forward at eye level",
          audioScript: "Steady rainfall and distant muffled bass.",
        }),
        "```",
      ].join("\n"),
    );

    const polished = await polishPrompt({
      text: "kai walking in neon alley",
      context: {
        styleBible: "Noir cyberpunk",
        audioMode: "ambient_only",
        cameraDirection: "Tracking",
      },
      chat,
    });

    expect(chat).toHaveBeenCalledTimes(1);
    expect(polished.visualPrompt).toContain("neon alley");
    expect(polished.cameraDirection).toContain("tracking");
    expect(polished.audioScript).toContain("rainfall");

    const userMsg = chat.mock.calls[0]?.[0].find((m) => m.role === "user");
    expect(userMsg?.content).toContain("Noir cyberpunk");
    expect(userMsg?.content).toContain("ambient_only");

    const systemMsg = chat.mock.calls[0]?.[0].find((m) => m.role === "system");
    expect(systemMsg?.content).toContain("Shot framing and motion");
    expect(systemMsg?.content).toContain("Orbit");
    expect(systemMsg?.content).toContain("No text.");
  });

  it("turns a silent audio mode into an explicit no-audio directive", async () => {
    const chat = vi.fn<ChatCompletionFn>(async () =>
      JSON.stringify({
        visualPrompt: "Locked-off ECU of a cracked clay cup. No text.",
        cameraDirection: "Locked off, extreme close-up",
        audioScript: "Silent.",
      }),
    );

    const polished = await polishPrompt({
      text: "A cracked cup",
      context: { audioMode: "silent" },
      chat,
    });

    expect(polished.audioScript).toBe("Silent.");
    const systemMsg = chat.mock.calls[0]?.[0].find((m) => m.role === "system");
    expect(systemMsg?.content).toContain("Audio mode is silent");
  });

  it("retries once on invalid polish output and throws RefinerError on double failure", async () => {
    const chat = vi
      .fn<ChatCompletionFn>()
      .mockResolvedValueOnce(JSON.stringify({ visualPrompt: "" }))
      .mockResolvedValueOnce("{ invalid");

    await expect(
      polishPrompt({
        text: "A rooftop scene",
        context: {},
        chat,
      }),
    ).rejects.toThrow(RefinerError);

    expect(chat).toHaveBeenCalledTimes(2);
  });

  it("throws RefinerError when prompt text is empty", async () => {
    const chat = vi.fn<ChatCompletionFn>();

    await expect(
      polishPrompt({
        text: "   ",
        chat,
      }),
    ).rejects.toThrow(RefinerError);

    expect(chat).not.toHaveBeenCalled();
  });
});

describe("resolveLinkedElementIds", () => {
  it("resolves element names case-insensitively and reports unknown names", () => {
    const savedElements = [
      { id: "el_kai", name: "Kai" },
      { id: "el_beacon", name: "Beacon" },
      { id: "el_rooftop", name: "Rooftop" },
    ];

    const resolved = resolveLinkedElementIds(
      [
        { linkedElementNames: ["kai", "Ghost", "BEACON", "kai"] },
        { linkedElementNames: ["Rooftop", "Phantom"] },
      ],
      savedElements,
    );

    expect(resolved).toEqual([
      {
        sceneIndex: 0,
        ids: ["el_kai", "el_beacon"],
        unknownNames: ["Ghost"],
      },
      {
        sceneIndex: 1,
        ids: ["el_rooftop"],
        unknownNames: ["Phantom"],
      },
    ]);
  });
});
