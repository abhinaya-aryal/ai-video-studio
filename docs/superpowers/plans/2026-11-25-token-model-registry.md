# Token-Driven Model Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace env-configured model defaults with a token-discovered registry, explicit role selections, Quality/Balanced/Economy Auto presets, capability inference, and token usage tracking.

**Architecture:** Extend the existing `custom_models` table into one registry for manual and discovered models. A sync route calls the provider metadata endpoint, inference assigns capabilities, and a single resolver maps roles to model IDs. Usage events capture provider token counts; nothing in the feature's own API calls bills tokens.

**Tech Stack:** Next.js App Router, Drizzle ORM with `better-sqlite3`, Zod, Vitest, Tailwind/shadcn UI.

**Spec:** `docs/superpowers/specs/2026-11-25-token-model-registry-design.md`

## Global Constraints

- Package manager: Bun. Never commit `package-lock.json`.
- Runtime stays Node. Next.js runs under Node, never `--bun`, because `better-sqlite3` is a native addon.
- Read env vars only through `getConfig()` in `src/lib/config.ts`.
- Token Plan keys (`sk-sp-`) route to `https://token-plan.{region}.maas.aliyuncs.com`.
- Every architecture, command, or env change updates `AGENTS.md`, `README.md`, and `.env.example` in the same commit.
- Nebula-only theme; never add `dark:` utilities.
- The models endpoint returns metadata only. Sync and usage endpoints must never invoke a model.
- No model default exists anywhere. Missing selection is a `409` error, never a fallback constant.

## Review Focus

- A user with a fresh database generating a clip before selecting a model must get a clear 409 and a disabled UI action, not a crash or a silent model.
- A token that lists zero models of a modality must still render the Models page, and Auto must report that no model fits rather than throwing.
- A provider response that omits `usage`, or returns a non-JSON body, must not fail a job or a usage query.
- A model ID containing characters such as dots, slashes, or uppercase must round-trip through sync, PATCH, and selection.
- Deleting a project or a manual model must not orphan a selection that later crashes resolution.

---

### Task 1: Schema and migration

**Files:**
- Modify: `src/db/schema.ts`, `src/db/index.ts`
- Create: `drizzle/0003_model_registry.sql` (name follows the generated output)
- Test: `tests/model-registry-schema.test.ts`

**Interfaces:**
- Produces: `MODEL_SLOTS = ["text_refine","text_polish","image","video","audio"]`, `AUTO_PRESETS = ["quality","balanced","economy"]`, tables `modelSelections`, `modelPreferences`, `usageEvents`, and extended `customModels` columns.

- [ ] **Step 1: Write the failing test**

```ts
// tests/model-registry-schema.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDbForTests, getDb, modelPreferences, modelSelections } from "@/db";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aivs-schema-"));
  process.env.DATA_DIR = tmp;
  process.env.PROJECTS_DIR = path.join(tmp, "projects");
});
afterEach(() => {
  closeDbForTests();
  delete process.env.DATA_DIR;
  delete process.env.PROJECTS_DIR;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("model registry schema", () => {
  it("creates selection and preference tables", () => {
    const db = getDb();
    db.insert(modelSelections)
      .values({ slot: "video", mode: "auto", modelId: null, updatedAt: Date.now() })
      .run();
    expect(db.select().from(modelSelections).all()).toHaveLength(1);
    db.insert(modelPreferences)
      .values({ id: 1, autoPreset: "balanced", updatedAt: Date.now() })
      .run();
    expect(db.select().from(modelPreferences).get()?.autoPreset).toBe("balanced");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/model-registry-schema.test.ts`
Expected: FAIL because `modelSelections` is not exported.

- [ ] **Step 3: Implement schema**

Add to `src/db/schema.ts`:

```ts
export const MODEL_SLOTS = [
  "text_refine",
  "text_polish",
  "image",
  "video",
  "audio",
] as const;
export type ModelSlot = (typeof MODEL_SLOTS)[number];

export const AUTO_PRESETS = ["quality", "balanced", "economy"] as const;
export type AutoPreset = (typeof AUTO_PRESETS)[number];

export const MODEL_SOURCES = ["manual", "discovered"] as const;
export type ModelSource = (typeof MODEL_SOURCES)[number];

export const modelSelections = sqliteTable("model_selections", {
  slot: text("slot", { enum: MODEL_SLOTS }).primaryKey(),
  mode: text("mode", { enum: ["auto", "manual"] }).notNull(),
  modelId: text("model_id"),
  updatedAt: integer("updated_at").notNull().$defaultFn(() => Date.now()),
});

export const modelPreferences = sqliteTable("model_preferences", {
  id: integer("id").primaryKey(),
  autoPreset: text("auto_preset", { enum: AUTO_PRESETS })
    .notNull()
    .default("balanced"),
  updatedAt: integer("updated_at").notNull().$defaultFn(() => Date.now()),
});

export const usageEvents = sqliteTable(
  "usage_events",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id"),
    projectId: text("project_id"),
    modality: text("modality").notNull(),
    modelId: text("model_id").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    units: integer("units"),
    createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
  },
  (table) => [
    index("idx_usage_events_created_at").on(table.createdAt),
    index("idx_usage_events_project_id").on(table.projectId),
  ],
);
```

Extend `customModels` with:

```ts
source: text("source", { enum: MODEL_SOURCES }).notNull().default("manual"),
providerCreatedAt: integer("provider_created_at"),
lastSeenAt: integer("last_seen_at"),
available: integer("available").notNull().default(1),
ignored: integer("ignored").notNull().default(0),
capabilitiesEdited: integer("capabilities_edited").notNull().default(0),
```

Change `projects.defaultVideoModel` to `text("default_video_model")` with no `.default(...)` and no `.notNull()`.

- [ ] **Step 4: Generate and inspect the migration**

Run: `bun run db:generate`
Expected: a new `drizzle/0003_*.sql`. Read it and confirm it creates the three tables, adds the six columns, and rebuilds `projects` without a NOT NULL/default on `default_video_model`.

- [ ] **Step 5: Run tests**

Run: `bunx vitest run tests/model-registry-schema.test.ts tests/db-and-storage.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts drizzle tests/model-registry-schema.test.ts
git commit -m "feat: add model registry and usage schema"
```

---

### Task 2: Capability inference

**Files:**
- Create: `src/lib/providers/model-inference.ts`
- Modify: `src/lib/providers/catalog.ts` (export templates and add `ttsCapable`)
- Test: `tests/model-inference.test.ts`

**Interfaces:**
- Produces: `inferModel(modelId: string): { modality: ModelModality; family: ModelFamily; ttsCapable: boolean }` and `inferCapabilities(modelId: string): ModelCapability`, where `ModelCapability` gains `ttsCapable: boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/model-inference.test.ts
import { describe, expect, it } from "vitest";
import { inferModel, inferCapabilities } from "@/lib/providers/model-inference";

describe("model inference", () => {
  it("maps known families", () => {
    expect(inferModel("wan3.0-video")).toMatchObject({ modality: "video", family: "wan3" });
    expect(inferModel("wan2.7-r2v")).toMatchObject({ modality: "video", family: "wan2.7" });
    expect(inferModel("qwen-image-3.0-pro")).toMatchObject({ modality: "image", family: "qwen-image" });
    expect(inferModel("qwen-audio-3.0-tts-plus")).toMatchObject({ modality: "audio", ttsCapable: true });
    expect(inferModel("qwen-audio-3.0-asr-flash")).toMatchObject({ modality: "audio", ttsCapable: false });
    expect(inferModel("qwen3.8-max")).toMatchObject({ modality: "text" });
  });

  it("uses conservative rules for unknown video", () => {
    const cap = inferCapabilities("brand-new-video");
    expect(cap.modality).toBe("video");
    expect(cap.allowedMediaTypes).toEqual([]);
    expect(cap.durations).toEqual({ min: 2, max: 15, smart: false });
  });

  it("maps wan2.7 image ids to reference-image rules", () => {
    expect(inferCapabilities("wan2.7-image").maxReferenceImages).toBe(9);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/model-inference.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Export `BUILTIN_CAPABILITIES`, `WAN3_VIDEO_TEMPLATE`, `WAN27_IMAGE_TEMPLATE`, and `defaultTemplateFor` from `catalog.ts`. Add `ttsCapable?: boolean` to `CustomCapabilitiesPatchSchema`, defaulting to `true` for TTS IDs and `false` for ASR/realtime. Implement:

```ts
const AUDIO_NON_TTS = /(asr|realtime)/;

export function inferModel(modelId: string) {
  const id = modelId.toLowerCase();
  if (id === "wan3.0-video" || id === "wan3.0-video-prime") {
    return { modality: "video" as const, family: "wan3" as const, ttsCapable: false };
  }
  if (/^wan2\.7-(r2v|i2v|t2v)/.test(id)) {
    return { modality: "video" as const, family: "wan2.7" as const, ttsCapable: false };
  }
  if (id.startsWith("wan") && id.includes("image")) {
    return { modality: "image" as const, family: "wan2.7" as const, ttsCapable: false };
  }
  if (id.startsWith("qwen-image")) {
    return { modality: "image" as const, family: "qwen-image" as const, ttsCapable: false };
  }
  if (id.includes("audio")) {
    return {
      modality: "audio" as const,
      family: "qwen-tts" as const,
      ttsCapable: !AUDIO_NON_TTS.test(id),
    };
  }
  if (/video/.test(id)) {
    return { modality: "video" as const, family: "wan3" as const, ttsCapable: false };
  }
  return { modality: "text" as const, family: "text" as const, ttsCapable: false };
}
```

`inferCapabilities` builds from the family template and, for unknown video, returns `allowedMediaTypes: []` and `durations: { min: 2, max: 15, smart: false }`.

- [ ] **Step 4: Run tests**

Run: `bunx vitest run tests/model-inference.test.ts tests/provider-clients.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/providers/model-inference.ts src/lib/providers/catalog.ts tests/model-inference.test.ts
git commit -m "feat: infer capabilities for discovered models"
```

---

### Task 3: Cost tiers and Auto resolution

**Files:**
- Create: `src/lib/providers/model-selection.ts`
- Test: `tests/model-selection.test.ts`

**Interfaces:**
- Produces: `resolveSlotModel(db, slot, opts?): { modelId: string; source: "manual"|"auto"; reason: string }`, `resolveAllSlots(db)`, `costTier(modelId): "high"|"mid"|"low"`, `ModelSelectionError` with `code`, `slot`.
- Consumes: `MODEL_SLOTS`, `AUTO_PRESETS`, `modelSelections`, `modelPreferences`, `customModels`, `inferCapabilities`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/model-selection.test.ts
import { describe, expect, it } from "vitest";
import { costTier, pickAutoModel, ModelSelectionError } from "@/lib/providers/model-selection";
import type { CustomModelRow } from "@/lib/providers/types";

function row(partial: Partial<CustomModelRow>): CustomModelRow {
  return {
    id: partial.modelId ?? "id",
    modelId: "x",
    displayName: "x",
    modality: "text",
    family: "text",
    capabilitiesJson: "{}",
    source: "discovered",
    providerCreatedAt: 1,
    lastSeenAt: 1,
    available: 1,
    ignored: 0,
    capabilitiesEdited: 0,
    ...partial,
  } as CustomModelRow;
}

describe("cost tiers", () => {
  it("classifies ids", () => {
    expect(costTier("qwen4-max")).toBe("high");
    expect(costTier("qwen3.6-flash")).toBe("low");
    expect(costTier("qwen-plus")).toBe("mid");
  });
});

describe("auto pick", () => {
  const rows = [
    row({ modelId: "qwen3.8-max", providerCreatedAt: 3 }),
    row({ modelId: "qwen3.6-flash", providerCreatedAt: 1 }),
  ];

  it("balanced picks a strong refine model and a cheap polish model", () => {
    expect(pickAutoModel(rows, "text_refine", "balanced")).toBe("qwen3.8-max");
    expect(pickAutoModel(rows, "text_polish", "balanced")).toBe("qwen3.6-flash");
  });

  it("quality picks the high tier for polish", () => {
    expect(pickAutoModel(rows, "text_polish", "quality")).toBe("qwen3.8-max");
  });

  it("throws when nothing fits", () => {
    expect(() => pickAutoModel([], "video", "balanced")).toThrow(ModelSelectionError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/model-selection.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
const HIGH = /(prime|max|pro|-r2v)/i;
const LOW = /(flash|turbo|air)/i;
const OVERRIDES: Record<string, "high"|"mid"|"low"> = {
  "wan3.0-video": "high",
  "wan2.7-image-pro": "mid",
};

export function costTier(modelId: string) {
  return OVERRIDES[modelId] ?? (HIGH.test(modelId) ? "high" : LOW.test(modelId) ? "low" : "mid");
}
```

`pickAutoModel(rows, slot, preset)` filters `available === 1 && ignored === 0`, maps modality by slot (`text_refine`/`text_polish` → `text`, others direct), filters TTS capability for `audio`, ranks by the preset table in the spec, then `providerCreatedAt ?? 0` descending. It throws `new ModelSelectionError("MODEL_NOT_SELECTED", slot, "No model fits ...")` when the filtered list is empty.

`resolveSlotModel` reads `model_selections` and `model_preferences`. Manual mode checks the row exists, is available, and matches the slot modality. Auto calls `pickAutoModel`. Both return a reason string.

- [ ] **Step 4: Run tests**

Run: `bunx vitest run tests/model-selection.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/providers/model-selection.ts tests/model-selection.test.ts
git commit -m "feat: add cost tiers and auto model resolution"
```

---

### Task 4: Usage recording

**Files:**
- Create: `src/lib/usage/record.ts`
- Modify: `src/lib/providers/openai-text.ts` (optional `onUsage` option)
- Test: `tests/usage-record.test.ts`

**Interfaces:**
- Produces: `recordUsage(db, input)`, `extractChatUsage(json)`, `recordChatUsage(collector, meta)`.
- `ChatCompletionOptions` gains `onUsage?: (usage: { promptTokens: number; completionTokens: number; totalTokens: number }) => void`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/usage-record.test.ts
import { describe, expect, it } from "vitest";
import { extractChatUsage } from "@/lib/usage/record";

describe("usage extraction", () => {
  it("reads openai usage fields", () => {
    expect(extractChatUsage({ usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 } }))
      .toEqual({ inputTokens: 10, outputTokens: 4, totalTokens: 14 });
  });
  it("returns null when usage is absent or malformed", () => {
    expect(extractChatUsage({})).toBeNull();
    expect(extractChatUsage({ usage: { prompt_tokens: "x" } })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/usage-record.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`extractChatUsage` validates integers and returns null otherwise. `recordUsage` inserts a `usage_events` row inside a try/catch and returns void; it never throws. `chatCompletion` calls `options.onUsage` after parsing JSON when usage exists. The refiner and polish callers pass a collector that records with `projectId`, `jobId: null`, `modality: "text"`.

- [ ] **Step 4: Run tests**

Run: `bunx vitest run tests/usage-record.test.ts tests/provider-clients.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/usage/record.ts src/lib/providers/openai-text.ts tests/usage-record.test.ts
git commit -m "feat: record provider token usage"
```

---

### Task 5: Sync route

**Files:**
- Create: `src/lib/providers/model-sync.ts`, `src/app/api/settings/models/sync/route.ts`
- Test: `tests/model-sync.test.ts`

**Interfaces:**
- Produces: `syncProviderModels({ fetchFn }): Promise<{ added; updated; unavailable; total; lastSyncedAt }>`.
- Consumes: `resolveQwenBaseUrl`, `getConfig`, `inferModel`, `inferCapabilities`, `customModels`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/model-sync.test.ts
import { describe, expect, it, vi } from "vitest";
import { syncProviderModels } from "@/lib/providers/model-sync";

it("upserts discovered models and marks missing ones unavailable", async () => {
  process.env.QWEN_API_KEY = "sk-test";
  const fetchFn = vi.fn(async () => new Response(JSON.stringify({
    data: [{ id: "wan3.0-video", created: 10 }, { id: "qwen3.8-max", created: 11 }],
  }), { status: 200 }));
  const result = await syncProviderModels({ fetchFn });
  expect(result.added).toBe(2);
  expect(result.total).toBe(2);
  expect(fetchFn).toHaveBeenCalledOnce();
});
```

Use the temp DB setup from Task 1. Assert a second sync with one ID marks the other `available = 0` and does not delete it.

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/model-sync.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`syncProviderModels` builds `${base}/compatible-mode/v1/models`, throws `API_KEY_MISSING` when the key is empty, parses `data`, and upserts by `model_id`. It never writes `capabilitiesJson` when `capabilitiesEdited = 1`, never changes `source` on manual rows, and sets `available = 0` only for discovered rows missing from the response. The route wraps it with `handleRouteError` and maps `API_KEY_MISSING` to 409.

- [ ] **Step 4: Run tests**

Run: `bunx vitest run tests/model-sync.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/providers/model-sync.ts src/app/api/settings/models/sync/route.ts tests/model-sync.test.ts
git commit -m "feat: sync models from the token"
```

---

### Task 6: Selection and preference routes

**Files:**
- Create: `src/app/api/settings/models/selections/route.ts`, `src/app/api/settings/models/preferences/route.ts`, `src/app/api/settings/models/[id]/route.ts`
- Modify: `src/app/api/settings/models/route.ts`
- Test: `tests/model-settings-routes.test.ts`

**Interfaces:**
- Consumes: `MODEL_SLOTS`, `AUTO_PRESETS`, `resolveAllSlots`, `customModels`.
- Produces: GET additions (`selections`, `resolved`, `autoPreset`), PUT selections, PUT preferences, PATCH/DELETE by row ID.

- [ ] **Step 1: Write the failing test**

```ts
// tests/model-settings-routes.test.ts
import { describe, expect, it } from "vitest";
import { PUT as putSelections } from "@/app/api/settings/models/selections/route";
import { PUT as putPreferences } from "@/app/api/settings/models/preferences/route";

it("rejects a manual selection of an unavailable model", async () => {
  const res = await putSelections(new Request("http://test/api/settings/models/selections", {
    method: "PUT",
    body: JSON.stringify({ updates: [{ slot: "video", mode: "manual", modelId: "missing" }] }),
  }));
  expect(res.status).toBe(409);
});

it("accepts a preset change", async () => {
  const res = await putPreferences(new Request("http://test/api/settings/models/preferences", {
    method: "PUT",
    body: JSON.stringify({ autoPreset: "economy" }),
  }));
  expect(res.status).toBe(200);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run tests/model-settings-routes.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

Follow the existing route pattern: `parseJsonBody` with Zod, `apiOk`, `handleRouteError`, `RouteError`. Selections validate slot enum, `manual` requires `modelId`, and reject unavailable or wrong-modality models with 409/422. Preferences upsert row `id = 1`. PATCH updates `displayName`, `ignored`, or `capabilities` (setting `capabilitiesEdited = 1`); `resetCapabilities` re-runs inference and clears the flag. DELETE removes manual rows and sets `ignored = 1` for discovered rows.

- [ ] **Step 4: Run tests**

Run: `bunx vitest run tests/model-settings-routes.test.ts tests/api-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/settings/models tests/model-settings-routes.test.ts
git commit -m "feat: add model selection and preference routes"
```

---

### Task 7: Usage API

**Files:**
- Create: `src/app/api/settings/usage/route.ts`
- Test: `tests/usage-route.test.ts`

**Interfaces:**
- Produces: `GET /api/settings/usage?range=today|7d|30d&projectId=` returning totals, `byModality`, `topModels`, `byProject`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/usage-route.test.ts
import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/settings/usage/route";

it("returns zero totals without a provider call", async () => {
  const res = await GET(new Request("http://test/api/settings/usage?range=7d"));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.totals.totalTokens).toBe(0);
  expect(Array.isArray(json.byModality)).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/usage-route.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Query `usage_events` with `gte(createdAt, cutoff)`, optional `eq(projectId)`. Aggregate with SQL or in JS. Join project titles for `byProject`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/usage-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/settings/usage/route.ts tests/usage-route.test.ts
git commit -m "feat: add local usage reporting"
```

---

### Task 8: Wire the resolver and remove env models

**Files:**
- Modify: `src/lib/config.ts`, `src/lib/providers/text.ts`, `src/lib/providers/qwen-client.ts`, `src/lib/refiner/story-refiner.ts`, `src/app/api/refine/route.ts`, `src/app/api/polish/route.ts`, `src/app/api/generate/*`, `src/app/api/projects/route.ts`, `src/app/api/settings/status/route.ts`, `src/db/index.ts`
- Test: `tests/config.test.ts`, `tests/model-resolution-routes.test.ts`

**Interfaces:**
- Consumes: `resolveSlotModel`, `getDb`.
- Produces: no `qwen.models`; `resolveSlotModel` used by every generation entry point.

- [ ] **Step 1: Write the failing test**

```ts
// tests/model-resolution-routes.test.ts
import { describe, expect, it } from "vitest";
import { resolveSlotModel } from "@/lib/providers/model-selection";
import { getDb } from "@/db";

it("fails with MODEL_NOT_SELECTED when no selection exists", () => {
  expect(() => resolveSlotModel(getDb(), "video")).toThrowError(/MODEL_NOT_SELECTED|No model/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/model-resolution-routes.test.ts`
Expected: FAIL on the current resolver signature or missing behavior.

- [ ] **Step 3: Implement**

Remove the four model fields from `EnvSchema`, `getConfig()` input, and `AppConfig.qwen.models`. Replace call sites:

- `text.ts`: `resolveSlotModel(getDb(), "text_refine")` for the default, or accept a role option.
- `refine/route.ts` and `story-refiner.ts`: pass `text_refine` and a usage collector.
- `polish/route.ts`: pass `text_polish`.
- `element-sheet` and `keyframe`: `image`.
- `tts`: `audio`.
- `video` and `batch`: `video`, with the project override applied first.
- `projects/route.ts`: store `null` when no model is provided.
- `db/index.ts`: quick-clips project inserts without `defaultVideoModel`.
- `status/route.ts`: return `resolved` roles instead of `qwen.models`.

Every route maps `ModelSelectionError` to 409/422 via the shared error handler.

- [ ] **Step 4: Run the full suite**

Run: `bun run test`
Expected: PASS after updating `tests/config.test.ts` to drop model assertions.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat: resolve models from selections instead of env"
```

---

### Task 9: Models page

**Files:**
- Modify: `src/app/settings/models/page.tsx`, `src/components/NavSidebar.tsx`

**Interfaces:**
- Consumes: `GET/PUT` routes from Tasks 5 and 6.

- [ ] **Step 1: Build the page sections**

Header with Sync and last-synced time. Auto card with preset segmented control and "Use Auto for all". Five role rows. Grouped model table with source, tier, availability, ignored badges, and a capability editor dialog. Usage card consuming Task 7.

- [ ] **Step 2: Add the sidebar label change**

Change `Custom Models` to `Models` and its description to "Token models, defaults, and usage."

- [ ] **Step 3: Verify manually**

Run `bun run lint` and open `/settings/models`. Confirm Sync populates the table, each role select persists after reload, and preset changes update the resolved combo.

- [ ] **Step 4: Commit**

```bash
git add src/app/settings/models/page.tsx src/components/NavSidebar.tsx
git commit -m "feat: build token model settings page"
```

---

### Task 10: Gate generation surfaces

**Files:**
- Modify: `src/app/page.tsx`, `src/app/quick-clip/page.tsx`, `src/app/settings/providers/page.tsx`, `src/components/studio/Stage2Elements.tsx`, `Stage3Video.tsx`, `ExportPanel.tsx`, `src/app/api/projects/route.ts`

- [ ] **Step 1: Dashboard banner**

Show unresolved roles with a link to `/settings/models` and a Sync action when the registry is empty. New Project's video model starts empty and reads "Inherit global selection".

- [ ] **Step 2: Quick Clip and stages**

Quick Clip model select starts empty. Disable submit, generate, and voiceover actions when their role is unresolved, with a tooltip pointing to Settings. Stage 3 uses project override then the video role. Export panel shows project lifetime tokens from the usage API.

- [ ] **Step 3: Provider Status**

Replace the two default-model rows with role, mode, resolved ID, and source. Add the Usage card.

- [ ] **Step 4: Verify manually and lint**

Run `bun run lint`. Capture the four surfaces with the browser and confirm disabled states and copy.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "feat: gate generation on explicit model selection"
```

---

### Task 11: Docs and env cleanup

**Files:**
- Modify: `README.md`, `AGENTS.md`, `.env`, `.env.example`, `src/lib/guide.ts`
- Test: `tests/guide.test.ts`, `tests/setup-docs.test.ts`

- [ ] **Step 1: Update tests first**

Remove the four model keys from the guide coverage list and add assertions that the README documents the Models page, Auto presets, and usage. Add an assertion that the README no longer mentions `QWEN_VIDEO_MODEL`.

- [ ] **Step 2: Update docs**

Delete the four model rows from the env table. Add a "Models" section: sync, no defaults, roles, presets, cost tiers, usage, and the note that only generation spends tokens. Update the guide steps that mention env defaults and add a step for the Models page. Remove the four lines from `.env` and `.env.example`. Update the AGENTS architecture map with the new files.

- [ ] **Step 3: Run tests**

Run: `bun run test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add README.md AGENTS.md .env.example src/lib/guide.ts tests
git commit -m "docs: document token model registry and remove model env vars"
```

---

### Task 12: Final verification

- [ ] **Step 1: Run the full suite**

```bash
bun run lint
bun run test
bun run build
```

Expected: all pass.

- [ ] **Step 2: Fresh database pass**

Move `data/studio.db` aside, start the dev server, and walk the manual checklist from the spec. Confirm the models sync adds no usage rows and generation does.

- [ ] **Step 3: Restore and report**

Restore the database if the pass created throwaway projects, and summarize the verification output with file paths.