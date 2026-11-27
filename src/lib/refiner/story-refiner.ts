import { z } from "zod";
import {
  AUDIO_MODES,
  type AudioMode,
  ELEMENT_KINDS,
  type ElementKind,
  VIDEO_MODES,
  type VideoMode,
} from "@/db/schema";
import type { ChatCompletionFn, ChatMessage } from "@/lib/providers/openai-text";
import {
  audioDirective,
  buildPromptFramework,
} from "@/lib/refiner/prompt-framework";

export type { AudioMode, ElementKind, VideoMode };

/** Error thrown when story or prompt refinement cannot produce valid structured output. */
export class RefinerError extends Error {
  readonly detail?: string;

  constructor(message: string, detail?: string) {
    super(message);
    this.name = "RefinerError";
    this.detail = detail;
  }
}

function normalizeEnumInput(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export const RefinedElementSchema = z.object({
  kind: z.preprocess(normalizeEnumInput, z.enum(ELEMENT_KINDS)),
  name: z.string().trim().min(1),
  description: z.string().trim().default(""),
});

export const RefinedSceneSchema = z.object({
  title: z.string().trim().min(1),
  linkedElementNames: z
    .array(z.string())
    .default([])
    .transform((names) => names.map((name) => name.trim()).filter(Boolean)),
  visualPrompt: z.string().trim().min(1),
  cameraDirection: z.string().trim().default(""),
  audioMode: z.preprocess(normalizeEnumInput, z.enum(AUDIO_MODES)),
  audioScript: z.string().trim().default(""),
  duration: z
    .number()
    .finite()
    .transform((val) => Math.min(30, Math.max(2, Math.round(val)))),
  videoMode: z.preprocess(normalizeEnumInput, z.enum(VIDEO_MODES)),
});

export const RefinedStorySchema = z.object({
  refinedStory: z.string().trim().min(1),
  styleBible: z.string().trim().default(""),
  elements: z.array(RefinedElementSchema).default([]),
  scenes: z.array(RefinedSceneSchema).min(1),
});

export const PolishedPromptSchema = z.object({
  visualPrompt: z.string().trim().min(1),
  cameraDirection: z.string().trim().default(""),
  audioScript: z.string().trim().default(""),
});

export type RefinedElement = z.infer<typeof RefinedElementSchema>;
export type RefinedScene = z.infer<typeof RefinedSceneSchema>;
export type RefinedStory = z.infer<typeof RefinedStorySchema>;
export type PolishedPrompt = z.infer<typeof PolishedPromptSchema>;

export interface RefineStoryInput {
  roughIdea: string;
  styleBible?: string;
  targetSceneCount?: number;
  chat: ChatCompletionFn;
}

export interface PolishPromptContext {
  styleBible?: string;
  audioMode?: AudioMode;
  cameraDirection?: string;
}

export interface PolishPromptInput {
  text: string;
  context?: PolishPromptContext;
  chat: ChatCompletionFn;
}

export interface SavedElementRef {
  id: string;
  name: string;
}

export interface ResolvedSceneElements {
  sceneIndex: number;
  ids: string[];
  unknownNames: string[];
}

function stripOuterCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const outerFence = trimmed.match(
    /^```(?:[a-zA-Z0-9_-]+)?\s*\n?([\s\S]*?)\n?```$/,
  );
  if (outerFence) {
    return outerFence[1].trim();
  }
  return trimmed;
}

function parseJsonWithFenceFallback(
  raw: string,
): { ok: true; data: unknown } | { ok: false; error: string } {
  const stripped = stripOuterCodeFence(raw);
  try {
    return { ok: true, data: JSON.parse(stripped) };
  } catch (firstErr) {
    const embeddedFence = raw.match(
      /```(?:json)?\s*\n?([\s\S]*?)\n?```/i,
    );
    if (embeddedFence) {
      try {
        return { ok: true, data: JSON.parse(embeddedFence[1].trim()) };
      } catch {
        // Fall through to report the initial JSON parse error.
      }
    }
    const message =
      firstErr instanceof Error ? firstErr.message : "Malformed JSON";
    return { ok: false, error: `Invalid JSON: ${message}` };
  }
}

function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

function validateAgainstSchema<T>(
  raw: string,
  schema: z.ZodType<T>,
): { ok: true; data: T } | { ok: false; error: string } {
  const parsedJson = parseJsonWithFenceFallback(raw);
  if (!parsedJson.ok) {
    return parsedJson;
  }

  const result = schema.safeParse(parsedJson.data);
  if (!result.success) {
    return {
      ok: false,
      error: `Schema validation failed: ${formatZodIssues(result.error)}`,
    };
  }

  return { ok: true, data: result.data };
}

const MAX_REPAIR_ASSISTANT_CHARS = 6000;

async function runJsonWithRepair<T>({
  messages,
  schema,
  chat,
  taskLabel,
  maxTokens,
  temperature,
}: {
  messages: ChatMessage[];
  schema: z.ZodType<T>;
  chat: ChatCompletionFn;
  taskLabel: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<T> {
  const callOptions = {
    responseFormat: { type: "json_object" as const },
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
  };

  const firstRaw = await chat(messages, callOptions);
  const firstAttempt = validateAgainstSchema(firstRaw, schema);
  if (firstAttempt.ok) {
    return firstAttempt.data;
  }

  const trimmedRaw =
    firstRaw.length > MAX_REPAIR_ASSISTANT_CHARS
      ? `${firstRaw.slice(0, MAX_REPAIR_ASSISTANT_CHARS)}...[truncated]`
      : firstRaw;

  const repairMessages: ChatMessage[] = [
    ...messages,
    { role: "assistant", content: trimmedRaw },
    {
      role: "user",
      content: `Validation failed (${firstAttempt.error}). Fix all issues and return ONLY compact valid JSON matching the schema, no markdown fences.`,
    },
  ];

  const repairOptions = firstAttempt.error.startsWith("Invalid JSON:")
    ? {
        responseFormat: { type: "json_object" as const },
        ...(temperature !== undefined ? { temperature } : {}),
      }
    : callOptions;

  const secondRaw = await chat(repairMessages, repairOptions);
  const secondAttempt = validateAgainstSchema(secondRaw, schema);
  if (secondAttempt.ok) {
    return secondAttempt.data;
  }

  throw new RefinerError(
    `${taskLabel} failed after repair retry: ${secondAttempt.error}`,
    secondAttempt.error,
  );
}

/**
 * Refine a rough story concept into a coherent narrative, style bible, reusable
 * reference elements, and ordered storyboard scenes validated with Zod.
 */
export async function refineStoryAndScenes({
  roughIdea,
  styleBible,
  targetSceneCount,
  chat,
}: RefineStoryInput): Promise<RefinedStory> {
  const cleanIdea = roughIdea.trim();
  if (!cleanIdea) {
    throw new RefinerError("Rough idea must not be empty.");
  }

  const systemPrompt = [
    "You are a film director and storyboard architect for AI video production.",
    "Expand the rough idea into a compact valid JSON object (no markdown fences or pretty-printing) with exact keys:",
    '- "refinedStory": concise narrative synopsis',
    '- "styleBible": 1-2 crisp sentences naming visual register, lighting, lens, palette',
    `- "elements": [{ "kind": ${ELEMENT_KINDS.map((k) => `"${k}"`).join(" | ")}, "name": string, "description": string }]`,
    '- "scenes": non-empty [{ "title": string, "linkedElementNames": string[] (exact names from elements[]), "visualPrompt": string (style, lighting, location, action, visible text or "No text."), "cameraDirection": string (shot size + camera term), ' +
      `"audioMode": ${AUDIO_MODES.map((m) => `"${m}"`).join(" | ")}, ` +
      '"audioScript": string (matches audioMode; empty only when silent), "duration": integer 2..30, ' +
      `"videoMode": ${VIDEO_MODES.map((m) => `"${m}"`).join(" | ")} (prefer "omni_reference" when elements are linked, "text_to_video" when none are linked; use "first_last_frame" only for exact start-to-end transitions) }]`,
    "",
    buildPromptFramework(),
  ].join("\n");

  const userLines = [`Rough idea: ${cleanIdea}`];
  if (styleBible?.trim()) {
    userLines.push(`Requested style bible: ${styleBible.trim()}`);
  }
  if (targetSceneCount !== undefined) {
    userLines.push(
      `Target scene count: ${Math.max(1, Math.round(targetSceneCount))}`,
    );
  }

  return runJsonWithRepair({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userLines.join("\n") },
    ],
    schema: RefinedStorySchema,
    chat,
    taskLabel: "Story refinement",
    temperature: 0.6,
  });
}

/**
 * Polish a raw scene or Quick Clip prompt into a cohesive visual prompt,
 * camera direction, and audio script using optional style and audio context.
 */
export async function polishPrompt({
  text,
  context = {},
  chat,
}: PolishPromptInput): Promise<PolishedPrompt> {
  const cleanText = text.trim();
  if (!cleanText) {
    throw new RefinerError("Prompt text must not be empty.");
  }

  const systemPrompt = [
    "You are an AI cinematography prompt engineer. Rewrite the draft into compact valid JSON (no markdown fences) with exact keys:",
    '- "visualPrompt": style, lighting, location, action, and visible text (or "No text.")',
    '- "cameraDirection": shot size + camera term from vocabulary',
    '- "audioScript": explicit audio directive for the selected audio mode',
    "",
    buildPromptFramework(),
    "",
    audioDirective(context.audioMode),
  ].join("\n");

  const userLines = [`Draft prompt: ${cleanText}`];
  if (context.styleBible?.trim()) {
    userLines.push(`Style bible: ${context.styleBible.trim()}`);
  }
  if (context.audioMode) {
    userLines.push(`Audio mode: ${context.audioMode}`);
  }
  if (context.cameraDirection?.trim()) {
    userLines.push(`Existing camera direction: ${context.cameraDirection.trim()}`);
  }

  return runJsonWithRepair({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userLines.join("\n") },
    ],
    schema: PolishedPromptSchema,
    chat,
    taskLabel: "Prompt polish",
    temperature: 0.4,
  });
}

/**
 * Resolve scene `linkedElementNames` against saved project elements using
 * case-insensitive name matching, reporting any unrecognized names per scene.
 */
export function resolveLinkedElementIds(
  scenes: ReadonlyArray<{ linkedElementNames: readonly string[] }>,
  savedElements: readonly SavedElementRef[],
): ResolvedSceneElements[] {
  const idByLowerName = new Map<string, string>();
  for (const el of savedElements) {
    const key = el.name.trim().toLowerCase();
    if (key && !idByLowerName.has(key)) {
      idByLowerName.set(key, el.id);
    }
  }

  return scenes.map((scene, sceneIndex) => {
    const ids: string[] = [];
    const unknownNames: string[] = [];
    const seenIds = new Set<string>();
    const seenUnknown = new Set<string>();

    for (const rawName of scene.linkedElementNames) {
      const trimmed = rawName.trim();
      if (!trimmed) continue;

      const lower = trimmed.toLowerCase();
      const matchedId = idByLowerName.get(lower);
      if (matchedId) {
        if (!seenIds.has(matchedId)) {
          seenIds.add(matchedId);
          ids.push(matchedId);
        }
      } else if (!seenUnknown.has(lower)) {
        seenUnknown.add(lower);
        unknownNames.push(trimmed);
      }
    }

    return {
      sceneIndex,
      ids,
      unknownNames,
    };
  });
}
